import type { ChatMessage, ToolCall } from '../types';
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

// The full file content from a read tool call, or null if the read can't
// serve as a baseline: partial (offset/limit) or truncated. pi's read returns
// raw file content and appends a bracketed notice only when it didn't cover
// the whole file (see pi-coding-agent's core/tools/read.ts).
function fullReadContent(tool: ToolCall): string | null {
  if (tool.args?.offset !== undefined || tool.args?.limit !== undefined) return null;
  const out = tool.output;
  if (out === undefined) return null;
  if (/\n\n\[Showing lines \d+-\d+ of \d+[^\]]*\]$/.test(out)) return null;
  if (/^\[Line \d+ is /.test(out)) return null;
  if (out.startsWith('Read image file [')) return null;
  return out;
}

// Reconstruct what this session changed on disk from its edit/write tool
// calls (only successful ones — failed or interrupted calls didn't change
// anything). Scoping is per-session by construction: other sessions' edits
// never appear in this session's messages.
//
// Agents also use write to *update* files, so the walk keeps a last-known
// content per path (seeded by full reads, replayed through edits and writes);
// a write over a known baseline diffs old vs new content instead of counting
// every line as added. Without a baseline (never read in-session, or changed
// behind our back by bash) a write still shows as all-added.
export function computeSessionDiffs(messages: ChatMessage[]): SessionDiffs {
  const turnOf: number[] = [];
  const session = emptyDiffSummary();
  const turns = new Map<number, DiffSummary>();
  const lastKnown = new Map<string, string>();
  let turn = 0;

  for (const m of messages) {
    if (m.role === 'user') turn++;
    turnOf.push(turn);
    if (m.role !== 'assistant' || !m.tools) continue;

    for (const tool of m.tools) {
      if (tool.status !== 'success') continue;
      const path = String(tool.args?.path ?? '');
      if (!path) continue;

      if (tool.name === 'read') {
        const content = fullReadContent(tool);
        if (content !== null) lastKnown.set(path, content);
        continue;
      }

      let blocks: DiffBlock[];
      if (tool.name === 'edit') {
        const edits = getEdits(tool.args);
        blocks = edits.map((e) => blockFromTexts(e.oldText, e.newText));
        // Replay the edits onto the baseline (pi's edit replaces one unique
        // occurrence). A miss means the baseline is stale — drop it rather
        // than diff future writes against wrong content.
        const known = lastKnown.get(path);
        if (known !== undefined) {
          let updated: string | undefined = known;
          for (const e of edits) {
            if (updated !== undefined && updated.includes(e.oldText)) {
              updated = updated.replace(e.oldText, e.newText);
            } else {
              updated = undefined;
            }
          }
          if (updated !== undefined) lastKnown.set(path, updated);
          else lastKnown.delete(path);
        }
      } else if (tool.name === 'write') {
        const content = String(tool.args?.content ?? '');
        const known = lastKnown.get(path);
        blocks = [blockFromTexts(known ?? '', content)];
        lastKnown.set(path, content);
      } else {
        continue;
      }
      // A write that re-emits identical content (or a no-op edit) isn't a
      // change; keeping it would add a +0 -0 file entry.
      blocks = blocks.filter((b) => b.oldText !== b.newText);
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
