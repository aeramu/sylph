// Short summary for the tool header, e.g. "edit src/App.tsx", "bash npm run build".
export function toolSummary(name: string, args?: Record<string, any>): string {
  if (!args) return '';
  switch (name) {
    case 'bash':
      return String(args.command || '').slice(0, 80);
    case 'read':
    case 'write':
      return String(args.path || '');
    case 'edit':
      return String(args.path || '');
    case 'grep':
      return [args.pattern && `"${args.pattern}"`, args.path].filter(Boolean).join(' ');
    case 'find':
      return [args.pattern || args.glob, args.path].filter(Boolean).join(' ');
    case 'ls':
      return String(args.path || '');
    default: {
      const firstStr = Object.values(args).find((v): v is string => typeof v === 'string');
      return firstStr ? firstStr.slice(0, 80) : '';
    }
  }
}

// Formatted multi-line representation of the tool arguments for the expanded view.
export function formatToolArgs(name: string, args?: Record<string, any>): { label: string; lines: string[] }[] {
  if (!args) return [];
  switch (name) {
    case 'bash':
      return [{ label: 'Command', lines: [String(args.command || '')] }];
    case 'read': {
      const parts = [{ label: 'Path', lines: [String(args.path || '')] }];
      if (args.offset || args.limit) {
        parts.push({ label: 'Range', lines: [`${args.offset || 1}-${(args.offset || 1) + (args.limit || 0) - 1}`] });
      }
      return parts;
    }
    case 'write':
      return [
        { label: 'Path', lines: [String(args.path || '')] },
        { label: 'Content', lines: [String(args.content || '')] },
      ];
    case 'edit':
      return [
        { label: 'Path', lines: [String(args.path || '')] },
      ];
    case 'grep': {
      const parts = [{ label: 'Pattern', lines: [String(args.pattern || '')] }];
      if (args.path) parts.push({ label: 'Path', lines: [String(args.path)] });
      if (args.glob) parts.push({ label: 'Glob', lines: [String(args.glob)] });
      return parts;
    }
    case 'find': {
      const parts = [{ label: 'Pattern', lines: [String(args.pattern || args.glob || '')] }];
      if (args.path) parts.push({ label: 'Path', lines: [String(args.path)] });
      return parts;
    }
    case 'ls':
      return [{ label: 'Path', lines: [String(args.path || '.')] }];
    default:
      return [{ label: 'Args', lines: [JSON.stringify(args, null, 2)] }];
  }
}

// Normalize the edit tool's arguments into a list of { oldText, newText } pairs.
// Handles the array form, the legacy flat form, and edits sent as a JSON string.
export function getEdits(args?: Record<string, any>): { oldText: string; newText: string }[] {
  if (!args) return [];
  let edits = args.edits;
  if (typeof edits === 'string') {
    try { edits = JSON.parse(edits); } catch { edits = undefined; }
  }
  if (Array.isArray(edits)) {
    return edits.map((e: any) => ({ oldText: String(e?.oldText ?? ''), newText: String(e?.newText ?? '') }));
  }
  if (typeof args.oldText === 'string' || typeof args.newText === 'string') {
    return [{ oldText: String(args.oldText ?? ''), newText: String(args.newText ?? '') }];
  }
  return [];
}
