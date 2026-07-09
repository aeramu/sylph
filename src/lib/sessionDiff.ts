import type { ChatMessage, ToolCall } from '../types';
import { getEdits } from './toolFormat';
import { diffLines } from './diff';

// One change to a file. Usually a single net block per file (content at scope
// start vs scope end); falls back to one block per edit/write when the file's
// full content was never known in-session.
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

// The raw old/new text of one edit or write, kept so a file whose full
// content is unknown can still show its individual changes.
type Mutation = { oldText: string; newText: string };

// Changes to one file within one scope (a turn, or the whole session),
// accumulated until the scope is flushed.
type PendingFile = {
  // Full file content before the scope's first mutation; undefined when the
  // file was never fully known (edited without an in-session read).
  start: string | undefined;
  mutations: Mutation[];
};

function recordMutations(
  pending: Map<string, PendingFile>,
  path: string,
  start: string | undefined,
  mutations: Mutation[],
) {
  let p = pending.get(path);
  if (!p) {
    p = { start, mutations: [] };
    pending.set(path, p);
  }
  p.mutations.push(...mutations);
}

// Turn a scope's pending changes into diff blocks. When both the start and
// end content are known, the file nets to a single block — edits that cancel
// out within the scope disappear. Otherwise fall back to the chronological
// per-mutation blocks.
function flushPending(
  pending: Map<string, PendingFile>,
  lastKnown: Map<string, string>,
  summary: DiffSummary,
) {
  for (const [path, p] of pending) {
    const end = lastKnown.get(path);
    if (p.start !== undefined && end !== undefined) {
      if (p.start !== end) addBlock(summary, path, blockFromTexts(p.start, end));
    } else {
      for (const mut of p.mutations) {
        if (mut.oldText !== mut.newText) addBlock(summary, path, blockFromTexts(mut.oldText, mut.newText));
      }
    }
  }
}

// Reconstruct what this session changed on disk from its edit/write tool
// calls (only successful ones — failed or interrupted calls didn't change
// anything). Scoping is per-session by construction: other sessions' edits
// never appear in this session's messages.
//
// Diffs are *net* per scope: the session summary diffs each file's first
// known content against its final content, and each turn's summary diffs the
// file across that turn, so re-edits and reverts don't inflate the counts
// (a turn that undoes an earlier turn shows changes in both turn views but
// nets to nothing in the session view).
//
// Netting needs full file content, so the walk keeps a last-known content
// per path, seeded by full reads and writes and replayed through edits.
// Without it (never read in-session, or dropped after a stale edit replay)
// the file falls back to chronological per-mutation blocks, and a write
// still shows as all-added.
export function computeSessionDiffs(messages: ChatMessage[]): SessionDiffs {
  const turnOf: number[] = [];
  const session = emptyDiffSummary();
  const turns = new Map<number, DiffSummary>();
  const lastKnown = new Map<string, string>();
  const sessionPending = new Map<string, PendingFile>();
  let turnPending = new Map<string, PendingFile>();
  let turn = 0;

  const flushTurn = () => {
    if (turnPending.size === 0) return;
    const summary = emptyDiffSummary();
    flushPending(turnPending, lastKnown, summary);
    if (summary.files.length > 0) turns.set(turn, summary);
    turnPending = new Map();
  };

  for (const m of messages) {
    if (m.role === 'user') {
      flushTurn();
      turn++;
    }
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

      // Content before this tool call, for seeding the scope baselines.
      let start: string | undefined;
      let mutations: Mutation[];
      if (tool.name === 'edit') {
        start = lastKnown.get(path);
        mutations = getEdits(tool.args);
        // Replay the edits onto the baseline (pi's edit replaces one unique
        // occurrence). A miss means the baseline is stale — drop it rather
        // than diff future changes against wrong content. The function
        // replacement keeps `$&`-style patterns in newText literal.
        if (start !== undefined) {
          let updated: string | undefined = start;
          for (const e of mutations) {
            if (updated !== undefined && updated.includes(e.oldText)) {
              updated = updated.replace(e.oldText, () => e.newText);
            } else {
              updated = undefined;
            }
          }
          if (updated !== undefined) lastKnown.set(path, updated);
          else lastKnown.delete(path);
        }
      } else if (tool.name === 'write') {
        const content = String(tool.args?.content ?? '');
        // A write defines the whole file, so even without a prior baseline
        // the old side is known-enough: treat it as empty (all-added).
        start = lastKnown.get(path) ?? '';
        mutations = [{ oldText: start, newText: content }];
        lastKnown.set(path, content);
      } else {
        continue;
      }

      recordMutations(sessionPending, path, start, mutations);
      recordMutations(turnPending, path, start, mutations);
    }
  }

  flushTurn();
  flushPending(sessionPending, lastKnown, session);
  return { turnOf, session, turns };
}
