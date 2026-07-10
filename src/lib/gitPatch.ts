export type GitRepositoryInfo = {
  branch: string;
  detached: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
};

export type GitCommit = {
  hash: string;
  shortHash: string;
  author: string;
  authoredAt: string;
  subject: string;
};

export type GitDivergence = {
  upstream: string | null;
  unpushed: GitCommit[];
  unpulled: GitCommit[];
};

export type GitFile = {
  path: string;
  index: string;
  workingTree: string;
  unstagedPatch: string;
  stagedPatch: string;
  isUntracked: boolean;
};

export type GitDiffLine = {
  type: 'context' | 'add' | 'del' | 'meta';
  text: string;
  oldLine?: number;
  newLine?: number;
  raw: string;
};

export type GitHunk = {
  header: string;
  lines: GitDiffLine[];
  rawLines: string[];
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
};

export type GitFilePatch = { headers: string[]; hunks: GitHunk[] };

export type GitHunkView = {
  oldText: string;
  newText: string;
  oldActions: Array<{ line: number; patchLineIndex: number; sourceLine?: number; text: string }>;
  newActions: Array<{ line: number; patchLineIndex: number; sourceLine?: number; text: string }>;
};

export function parseGitPatch(patch: string): GitFilePatch {
  const headers: string[] = [];
  const hunks: GitHunk[] = [];
  let hunk: GitHunk | undefined;
  let oldLine = 0;
  let newLine = 0;

  for (const line of patch.split('\n')) {
    const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (match) {
      hunk = {
        header: line,
        lines: [],
        rawLines: [],
        oldStart: Number(match[1]),
        oldCount: Number(match[2] || 1),
        newStart: Number(match[3]),
        newCount: Number(match[4] || 1),
      };
      oldLine = hunk.oldStart;
      newLine = hunk.newStart;
      hunks.push(hunk);
      continue;
    }
    if (!hunk) {
      if (line) headers.push(line);
      continue;
    }
    hunk.rawLines.push(line);
    if (line.startsWith('+')) {
      hunk.lines.push({ type: 'add', text: line.slice(1), newLine, raw: line });
      newLine++;
    } else if (line.startsWith('-')) {
      hunk.lines.push({ type: 'del', text: line.slice(1), oldLine, raw: line });
      oldLine++;
    } else if (line.startsWith(' ')) {
      hunk.lines.push({ type: 'context', text: line.slice(1), oldLine, newLine, raw: line });
      oldLine++;
      newLine++;
    } else {
      hunk.lines.push({ type: 'meta', text: line, raw: line });
    }
  }
  return { headers, hunks };
}

export function makeHunkPatch(patch: string, hunk: GitHunk) {
  return [...parseGitPatch(patch).headers, hunk.header, ...hunk.rawLines].join('\n');
}

function normalizePartialHeaders(headers: string[]) {
  const newPath = headers.find((header) => header.startsWith('+++ b/'))?.slice(6);
  const oldPath = headers.find((header) => header.startsWith('--- a/'))?.slice(6);
  return headers
    .filter((header) => !header.startsWith('new file mode') && !header.startsWith('deleted file mode'))
    .map((header) => {
      if (header === '--- /dev/null' && newPath) return `--- a/${newPath}`;
      if (header === '+++ /dev/null' && oldPath) return `+++ b/${oldPath}`;
      return header;
    });
}

export function makeLinePatch(patch: string, hunk: GitHunk, index: number, reverse: boolean) {
  const selected = hunk.lines[index];
  if (!selected || (selected.type !== 'add' && selected.type !== 'del')) return '';
  const presentType = reverse ? 'add' : 'del';
  let oldStart: number | undefined;
  let newStart: number | undefined;
  let oldCount = 0;
  let newCount = 0;
  const body: string[] = [];

  for (const line of hunk.lines) {
    if (line.type === 'meta') continue;
    if (line !== selected && line.type !== 'context' && line.type !== presentType) continue;
    const raw = line !== selected && line.type === presentType ? ` ${line.text}` : line.raw;
    if (oldStart == null) oldStart = line.oldLine ?? selected.oldLine ?? hunk.oldStart;
    if (newStart == null) newStart = line.newLine ?? selected.newLine ?? hunk.newStart;
    body.push(raw);
    if (raw[0] !== '+') oldCount++;
    if (raw[0] !== '-') newCount++;
  }

  if (oldStart == null || newStart == null || body.length === 0) return '';
  const parsed = parseGitPatch(patch);
  const headers = body.some((line) => line.startsWith(' '))
    ? normalizePartialHeaders(parsed.headers)
    : parsed.headers;
  return [...headers, `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, ...body].join('\n');
}

export function gitPatchStats(patch: string) {
  let added = 0;
  let deleted = 0;
  for (const hunk of parseGitPatch(patch).hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'add') added++;
      else if (line.type === 'del') deleted++;
    }
  }
  return { added, deleted };
}

export function gitHunkView(hunk: GitHunk): GitHunkView {
  const oldLines: string[] = [];
  const newLines: string[] = [];
  const oldActions: GitHunkView['oldActions'] = [];
  const newActions: GitHunkView['newActions'] = [];
  hunk.lines.forEach((line, patchLineIndex) => {
    if (line.type === 'context') {
      oldLines.push(line.text);
      newLines.push(line.text);
    } else if (line.type === 'del') {
      oldLines.push(line.text);
      oldActions.push({ line: oldLines.length, patchLineIndex, sourceLine: line.oldLine, text: line.text });
    } else if (line.type === 'add') {
      newLines.push(line.text);
      newActions.push({ line: newLines.length, patchLineIndex, sourceLine: line.newLine, text: line.text });
    }
  });
  return { oldText: oldLines.join('\n'), newText: newLines.join('\n'), oldActions, newActions };
}

export function gitStatusLabel(file: GitFile, staged: boolean) {
  if (!staged && file.isUntracked) return { code: '?', title: 'Untracked' };
  const code = (staged ? file.index : file.workingTree).trim() || 'M';
  const titles: Record<string, string> = {
    A: 'Added', M: 'Modified', D: 'Deleted', R: 'Renamed', C: 'Copied',
    T: 'Type changed', U: 'Merge conflict', '?': 'Untracked',
  };
  return { code, title: titles[code] ?? `Git status: ${code}` };
}

export function splitGitFilePath(filePath: string) {
  const slash = filePath.lastIndexOf('/');
  return slash < 0
    ? { name: filePath, directory: '' }
    : { name: filePath.slice(slash + 1), directory: filePath.slice(0, slash) };
}
