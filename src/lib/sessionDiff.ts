import type { ChatMessage } from '../types';
import { getEdits } from './toolFormat';
import { diffLines } from './diff';

// One contiguous change to a file, taken from a single edit/write tool call.
export interface DiffBlock {
  oldText: string;
  newText: string;
  added: number;
  deleted: number;
}

export interface FileDiff {
  path: string;
  added: number;
  deleted: number;
  // Chronological: the order the agent made the changes.
  blocks: DiffBlock[];
}

export interface DiffSummary {
  files: FileDiff[];
  added: number;
  deleted: number;
}

export interface SessionDiffs {
  // 1-based turn number per message index. A turn starts at each user message
  // (0 only for messages preceding the first user message).
  turnOf: number[];
  session: DiffSummary;
  turns: Map<number, DiffSummary>;
}

export function emptyDiffSummary(): DiffSummary {
  return { files: [], added: 0, deleted: 0 };
}

function addBlock(summary: DiffSummary, path: string, block: DiffBlock) {
  let file = summary.files.find((f) => f.path === path);
  if (!file) {
    file = { path, added: 0, deleted: 0, blocks: [] };
    summary.files.push(file);
  }
  file.blocks.push(block);
  file.added += block.added;
  file.deleted += block.deleted;
  summary.added += block.added;
  summary.deleted += block.deleted;
}

function blockFromTexts(oldText: string, newText: string): DiffBlock {
  let added = 0;
  let deleted = 0;
  for (const row of diffLines(oldText, newText)) {
    if (row.type === 'add') added++;
    else if (row.type === 'del') deleted++;
  }
  return { oldText, newText, added, deleted };
}

// Reconstruct what this session changed on disk from its edit/write tool
// calls (only successful ones — failed or interrupted calls didn't change
// anything). Scoping is per-session by construction: other sessions' edits
// never appear in this session's messages. A write over an existing file
// counts all its lines as added — the previous content isn't recorded.
export function computeSessionDiffs(messages: ChatMessage[]): SessionDiffs {
  const turnOf: number[] = [];
  const session = emptyDiffSummary();
  const turns = new Map<number, DiffSummary>();
  let turn = 0;

  for (const m of messages) {
    if (m.role === 'user') turn++;
    turnOf.push(turn);
    if (m.role !== 'assistant' || !m.tools) continue;

    for (const tool of m.tools) {
      if (tool.status !== 'success') continue;
      const path = String(tool.args?.path ?? '');
      if (!path) continue;

      let blocks: DiffBlock[];
      if (tool.name === 'edit') {
        blocks = getEdits(tool.args).map((e) => blockFromTexts(e.oldText, e.newText));
      } else if (tool.name === 'write') {
        blocks = [blockFromTexts('', String(tool.args?.content ?? ''))];
      } else {
        continue;
      }
      if (blocks.length === 0) continue;

      let turnSummary = turns.get(turn);
      if (!turnSummary) {
        turnSummary = emptyDiffSummary();
        turns.set(turn, turnSummary);
      }
      for (const block of blocks) {
        addBlock(session, path, block);
        addBlock(turnSummary, path, block);
      }
    }
  }

  return { turnOf, session, turns };
}
