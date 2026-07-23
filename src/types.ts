export interface ToolCall {
  id?: string;
  name: string;
  status: 'running' | 'success' | 'error';
  output?: string;
  resultMsgId?: string;
  args?: Record<string, any>;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'notification';
  content: string;
  rawContent?: string;
  structuredThinking?: string;
  structuredThinkingActive?: boolean;
  // For role 'notification': controls styling ('info' | 'warning' | 'error').
  notifyType?: string;
  thinking?: string;
  isThinking?: boolean;
  images?: { url: string; mimeType: string }[];
  isStreaming?: boolean;
  errorMessage?: string;
  tools?: ToolCall[];
}

export interface Attachment {
  id: string;
  kind: 'image' | 'file';
  name: string;
  mimeType: string;
  size: number;
  // image
  data?: string;       // base64 (no data: prefix)
  previewUrl?: string; // data URL for <img>
  // text file
  text?: string;
}

export interface ReviewCommentAttachment {
  id: string;
  surface: 'artifact' | 'git';
  path: string;
  comment: string;
  quote: string;
  lineStart?: number;
  lineEnd?: number;
  side?: 'old' | 'new';
  changeSet?: 'staged' | 'unstaged';
}

export interface CommandInfo {
  name: string;
  source: string;
  description?: string;
}

export interface FileMentionInfo {
  name: string;
  path: string;
  kind: 'file' | 'directory';
}

export interface ResourceInfo {
  name: string;
  description?: string;
}

export interface ProjectDirectoryInfo {
  id: string;
  name: string;
  path: string;
}

export interface ProjectInfo {
  id: string;
  name: string;
  /** First directory path (legacy-compatible convenience field). */
  path: string;
  directories: ProjectDirectoryInfo[];
}

// Live state of a session shown in the sidebar: mid-turn, blocked on a user
// dialog (question / permission prompt), or ended with an error. Absence
// means idle.
export type SessionStatus = 'working' | 'needsInput' | 'error';

// A session created in this app instance that the server session list may
// not include yet (it's still on its first turn). The sidebar shows these
// so a fresh chat doesn't vanish when another session becomes active.
export interface DraftSession {
  id: string;
  workspaceKind?: 'directories' | 'scratch';
  projectId?: string;
  directoryId?: string;
  branch?: string;
  worktree?: boolean;
  firstMessage: string;
  createdAt: string;
}

export interface ModelOption {
  value: string;
  label: string;
  provider?: string;
  searchText?: string;
  reasoning?: boolean;
  thinkingLevels?: ThinkingLevel[];
}

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ThinkingLevelOption {
  value: ThinkingLevel;
  label: string;
}

export const THINKING_LEVELS: ThinkingLevelOption[] = [
  { value: 'off', label: 'Off' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'XHigh' },
  { value: 'max', label: 'Max' },
];

// Context-window snapshot computed server-side (see getContextInfo in
// server/runtime/index.ts). tokens/percent are null right after compaction, before
// the next assistant response re-establishes real usage.
export interface ContextInfo {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
  // chars/4 estimates — the model-reported number is `tokens`.
  systemPromptTokens: number;
  toolTokens: number;
  stats?: {
    userMessages: number;
    assistantMessages: number;
    toolCalls: number;
    totalMessages: number;
    tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
    cost: number;
  };
}

export interface ExtWidget {
  lines: string[];
  placement?: string;
}
