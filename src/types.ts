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
  role: 'user' | 'assistant';
  content: string;
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

export interface CommandInfo {
  name: string;
  source: string;
  description?: string;
}

export interface ResourceInfo {
  name: string;
  source: string;
  description?: string;
}

export interface ProjectInfo {
  id: string;
  name: string;
  path: string;
}

export interface ModelOption {
  value: string;
  label: string;
}

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

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
];

export interface Toast {
  id: string;
  message: string;
  type: string;
}

export interface ExtWidget {
  lines: string[];
  placement?: string;
}
