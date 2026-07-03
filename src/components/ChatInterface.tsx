import { createSignal, createEffect, createMemo, For, Show, onCleanup, onMount } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import CustomSelect from './CustomSelect';
import UiRequestModal, { type UiRequest } from './UiRequestModal';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  isThinking?: boolean;
  images?: { url: string; mimeType: string }[];
  isStreaming?: boolean;
  tools?: { id?: string; name: string; status: 'running' | 'success' | 'error'; output?: string; resultMsgId?: string; args?: Record<string, any> }[];
}

interface Attachment {
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

const TEXT_FILE_EXTENSIONS = [
  '.txt', '.md', '.markdown', '.json', '.js', '.jsx', '.ts', '.tsx',
  '.py', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp',
  '.css', '.html', '.xml', '.yml', '.yaml', '.toml', '.ini', '.cfg',
  '.sh', '.bash', '.zsh', '.sql', '.csv', '.log', '.env', '.vue', '.svelte',
];
const MAX_TEXT_FILE_BYTES = 512 * 1024;
const ACCEPT_ATTR = 'image/*,' + TEXT_FILE_EXTENSIONS.join(',');

function isTextFile(file: File): boolean {
  if (file.type.startsWith('text/')) return true;
  const dot = file.name.lastIndexOf('.');
  if (dot < 0) return false;
  return TEXT_FILE_EXTENSIONS.includes(file.name.slice(dot).toLowerCase());
}

function readFile(file: File): Promise<Attachment | null> {
  return new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2);
    const base = { id, name: file.name, mimeType: file.type || 'application/octet-stream', size: file.size };

    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const commaIdx = dataUrl.indexOf(',');
        resolve({ ...base, kind: 'image', data: commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl, previewUrl: dataUrl });
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    } else if (isTextFile(file) && file.size <= MAX_TEXT_FILE_BYTES) {
      const reader = new FileReader();
      reader.onload = () => resolve({ ...base, kind: 'file', text: reader.result as string });
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    } else {
      resolve(null);
    }
  });
}

// Strip ANSI terminal escape sequences (colors, cursor moves, etc.). Models
// sometimes emit reasoning/output that quotes colorized terminal text; the
// browser can't interpret those codes, so they'd otherwise show as literal
// garbage like "[38;2;128;128;128m".
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE = /[][[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-PR-TZcf-nqry=><]/g;
function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE, '');
}

// Whether a message has anything worth rendering. Aborted/steered turns can
// leave empty assistant messages in history; rendering them as blank bubbles
// injects phantom vertical gaps, so skip them (but always keep streaming ones
// so the live indicator still shows).
function hasRenderableContent(m: ChatMessage): boolean {
  return (
    m.role === 'user' ||
    !!m.isStreaming ||
    !!m.isThinking ||
    !!m.content?.trim() ||
    !!m.thinking?.trim() ||
    (m.tools?.length ?? 0) > 0 ||
    (m.images?.length ?? 0) > 0
  );
}

// Short summary for the tool header, e.g. "edit src/App.tsx", "bash npm run build".
function toolSummary(name: string, args?: Record<string, any>): string {
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
function formatToolArgs(name: string, args?: Record<string, any>): { label: string; lines: string[] }[] {
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
function getEdits(args?: Record<string, any>): { oldText: string; newText: string }[] {
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

type DiffRow = { old?: string; new?: string; type: 'same' | 'add' | 'del' };

// Line-level LCS diff producing aligned rows for a side-by-side view.
function diffLines(oldText: string, newText: string): DiffRow[] {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  const m = a.length, n = b.length;

  // Guard against pathological O(m*n) blowups on huge edits.
  if (m * n > 200000) {
    return [
      ...a.map((line): DiffRow => ({ old: line, type: 'del' })),
      ...b.map((line): DiffRow => ({ new: line, type: 'add' })),
    ];
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const rows: DiffRow[] = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { rows.push({ old: a[i], new: b[j], type: 'same' }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { rows.push({ old: a[i], type: 'del' }); i++; }
    else { rows.push({ new: b[j], type: 'add' }); j++; }
  }
  while (i < m) { rows.push({ old: a[i], type: 'del' }); i++; }
  while (j < n) { rows.push({ new: b[j], type: 'add' }); j++; }
  return rows;
}

function DiffView(props: { oldText: string; newText: string }) {
  const rows = diffLines(props.oldText, props.newText);
  return (
    <div class="diff-view">
      <For each={rows}>
        {(row) => (
          <div class="diff-row">
            <div class={`diff-cell diff-old ${row.type === 'del' ? 'removed' : ''}`}>{row.old ?? ''}</div>
            <div class={`diff-cell diff-new ${row.type === 'add' ? 'added' : ''}`}>{row.new ?? ''}</div>
          </div>
        )}
      </For>
    </div>
  );
}

export default function ChatInterface(props: { activeSessionId?: string, activeProjectId?: string, onSelectProject?: (id: string) => void, onSessionCreated: (id: string, projectId?: string) => void, onTurnComplete?: () => void }) {
  const [attachments, setAttachments] = createSignal<Attachment[]>([]);
  const [isDragOver, setIsDragOver] = createSignal(false);
  let fileInputRef: HTMLInputElement | undefined;
  let textareaRef: HTMLTextAreaElement | undefined;
  let dragCounter = 0;

  const addFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    const read = await Promise.all(files.map(readFile));
    const valid = read.filter((a): a is Attachment => !!a);
    if (valid.length) setAttachments((prev) => [...prev, ...valid]);
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const handleFileInput = (e: Event) => {
    const input = e.target as HTMLInputElement;
    if (input.files?.length) addFiles(input.files);
    input.value = '';
  };

  const handlePaste = (e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of items) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    dragCounter = 0;
    setIsDragOver(false);
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  };

  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer?.types?.includes('Files')) {
      dragCounter++;
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    dragCounter = Math.max(0, dragCounter - 1);
    if (dragCounter === 0) setIsDragOver(false);
  };
  const [messages, setMessages] = createStore<ChatMessage[]>([]);
  const [input, setInput] = createSignal('');
  const [isProcessing, setIsProcessing] = createSignal(false);
  const [isConnected, setIsConnected] = createSignal(false);
  const [showModal, setShowModal] = createSignal<'skill' | 'extension' | null>(null);
  const [lightboxUrl, setLightboxUrl] = createSignal<string | null>(null);
  const [commandsList, setCommandsList] = createSignal<{name: string, source: string, description?: string}[]>([]);
  const [resourcesList, setResourcesList] = createSignal<{name: string, source: string, description?: string}[]>([]);
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [projects, setProjects] = createSignal<any[]>([]);
  const [models, setModels] = createSignal<{value: string, label: string}[]>([]);
  const [selectedModel, setSelectedModel] = createSignal('');
  const [uiRequest, setUiRequest] = createSignal<UiRequest | null>(null);
  const [toasts, setToasts] = createSignal<{id: string; message: string; type: string}[]>([]);
  const [statusEntries, setStatusEntries] = createStore<Record<string, string>>({});
  const [widgets, setWidgets] = createSignal<Record<string, {lines: string[]; placement?: string}>>({});

  // Session id promised by the /api/chat response but not yet committed as
  // active. The HTTP response is the single authoritative source of the id;
  // SSE events for an uncommitted session are buffered until it commits.
  let pendingSessionId: string | null = null;
  let pendingEventBuffer: any[] = [];
  // Guards fetchHistory against stale responses when switching sessions fast.
  let historyRequestSeq = 0;

  const fetchProjects = () => {
    fetch(`/api/projects`).then(res => res.json()).then(data => {
      setProjects(data.projects || []);
    });
  };

  const fetchModels = () => {
    fetch('/api/models').then(res => res.json()).then(data => {
      if (data.models && data.models.length > 0) {
        const mapped = data.models.map((m: any) => ({ value: m.id, label: m.name }));
        setModels(mapped);

        let saved: string | null = null;
        try { saved = localStorage.getItem('sylph.selectedModel'); } catch {}
        const initial = (saved && mapped.find((m: any) => m.value === saved))
          || mapped.find((m: any) => m.label.toLowerCase().includes('flash'))
          || mapped[0];
        if (initial) setSelectedModel(initial.value);
      }
    }).catch(console.error);
  };

  const filteredCommands = createMemo(() => {
    const text = input();
    const match = text.match(/^\/([^\s]*)$/);
    if (!match) return null;

    const query = match[1].toLowerCase();
    const matches = commandsList().filter(cmd =>
      cmd.name.toLowerCase().includes(query)
    );

    return matches.length > 0 ? matches : null;
  });

  createEffect(() => {
    // Reset selected index when filtered list changes
    filteredCommands();
    setSelectedIndex(0);
  });
  
  const selectModel = (id: string) => {
    setSelectedModel(id);
    try { localStorage.setItem('sylph.selectedModel', id); } catch {}
  };

  let messagesEndRef: HTMLDivElement | undefined;
  let eventSource: EventSource | null = null;
  
  const scrollToBottom = () => {
    messagesEndRef?.scrollIntoView({ behavior: 'smooth' });
  };
  
  createEffect(() => {
    messages.length; // Trigger effect on message count change
    scrollToBottom();
  });

  onMount(() => {
    fetchProjects();
    fetchModels();
    fetchCommands();
    fetchResources();
    connectSSE();
  });

  createEffect(() => {
    const id = props.activeSessionId; // track
    if (id && pendingSessionId === id) {
      // We just committed a session we created; it's already streaming, so
      // replay buffered events instead of wiping and reloading history.
      pendingSessionId = null;
      const buffered = pendingEventBuffer;
      pendingEventBuffer = [];
      for (const e of buffered) applyEvent(e);
      return;
    }
    setMessages([]);
    setUiRequest(null);
    setToasts([]);
    setWidgets({});
    setStatusEntries(produce((s) => { for (const k of Object.keys(s)) delete s[k]; }));
    fetchHistory();
  });

  const fetchCommands = async () => {
    try {
      const res = await fetch('/api/commands');
      if (res.ok) {
        const data = await res.json();
        setCommandsList(data.commands || []);
      }
    } catch (e) {
      console.error('Failed to fetch commands', e);
    }
  };

  const fetchResources = async () => {
    try {
      const res = await fetch('/api/resources');
      if (res.ok) {
        const data = await res.json();
        setResourcesList(data.resources || []);
      }
    } catch (e) {
      console.error('Failed to fetch resources', e);
    }
  };
  
  const fetchHistory = async () => {
    if (!props.activeSessionId) {
      setMessages([]);
      return;
    }
    const seq = ++historyRequestSeq;
    try {
      const res = await fetch(`/api/history?sessionId=${props.activeSessionId}`);
      const data = await res.json();
      if (seq !== historyRequestSeq) return; // a newer request superseded this one

      const mapped: ChatMessage[] = [];
      let currentAssistantMessage: ChatMessage | null = null;

      for (const m of (data.messages || [])) {
        if (m.role === 'user') {
          let contentStr = '';
          const images: { url: string; mimeType: string }[] = [];
          if (typeof m.content === 'string') {
            contentStr = m.content;
          } else if (Array.isArray(m.content)) {
            m.content.forEach((c: any) => {
              if (c.type === 'text') {
                contentStr += c.text || '';
              } else if (c.type === 'image' && c.data) {
                images.push({ url: `data:${c.mimeType};base64,${c.data}`, mimeType: c.mimeType });
              }
            });
          }
          
          mapped.push({
            id: m.id || Math.random().toString(),
            role: 'user',
            content: contentStr,
            images: images.length ? images : undefined,
          });
          currentAssistantMessage = null;
        } else if (m.role === 'assistant') {
          let contentStr = '';
          let thinkingStr = '';
          const tools: any[] = [];

          if (typeof m.content === 'string') {
            contentStr = m.content;
          } else if (Array.isArray(m.content)) {
            m.content.forEach((c: any) => {
              if (c.type === 'text') {
                contentStr += c.text;
              } else if (c.type === 'thinking') {
                thinkingStr += c.thinking || '';
              } else if (c.type === 'toolCall') {
                tools.push({
                  id: c.id,
                  name: c.name,
                  status: 'running', 
                  output: '',
                  args: c.arguments,
                });
              }
            });
          }
          
          const msg: ChatMessage = {
            id: m.id || Math.random().toString(),
            role: 'assistant',
            content: contentStr,
            thinking: thinkingStr || undefined,
            tools
          };
          mapped.push(msg);
          currentAssistantMessage = msg;
        } else if (m.role === 'toolResult' && currentAssistantMessage && currentAssistantMessage.tools) {
          const tool = currentAssistantMessage.tools.find(t => t.id === m.toolCallId);
          if (tool) {
            let resultStr = '';
            if (typeof m.content === 'string') {
              resultStr = m.content;
            } else if (Array.isArray(m.content)) {
              resultStr = m.content.filter((c: any) => c.type === 'text').map((c: any) => c.text || '').join('');
            }
            tool.output = resultStr;
            tool.status = m.isError ? 'error' : 'success';
          }
        }
      }

      // Tools with no recorded result were interrupted; don't leave them
      // spinning as "running" forever.
      for (const m of mapped) {
        m.tools?.forEach(t => {
          if (t.status === 'running') t.status = 'error';
        });
      }

      setMessages(mapped);
    } catch (err) {
      console.error('Failed to load history:', err);
    }
  };
  
  onCleanup(() => {
    if (eventSource) {
      eventSource.close();
    }
  });

  const connectSSE = () => {
    eventSource = new EventSource('/api/stream');
    
    eventSource.onopen = () => {
      console.log('SSE connection opened');
    };
    
    eventSource.onerror = (err) => {
      console.error('SSE error', err);
      setIsConnected(false);
    };

    eventSource.onmessage = (e) => {
      const data = JSON.parse(e.data);
      
      if (data.type === 'connection_established') {
        setIsConnected(true);
        return;
      }
      
      if (data.type === 'extension_ui_request') {
        if (props.activeSessionId && data.sessionId !== props.activeSessionId) return;
        handleUiMethod(data);
        return;
      }
      
      handleAgentEvent(data);
    };
  };

  const applyEvent = (event: any) => {
    const lastIdx = messages.length - 1;

    if (event.type === 'message_start') {
      const msgId = event.message?.id || event.message?.responseId || Date.now().toString();
      
      if (event.message.role === 'assistant') {
        setMessages(messages.length, { id: msgId, role: 'assistant', content: '', isStreaming: true });
      } else if (event.message.role === 'toolResult') {
        const toolCallId = event.message.toolCallId;
        let initialOutput = '';
        
        if (typeof event.message.content === 'string') {
          initialOutput = event.message.content;
        } else if (Array.isArray(event.message.content)) {
          initialOutput = event.message.content.filter((c: any) => c.type === 'text').map((c: any) => c.text || '').join('');
        }

        setMessages(
          m => m.role === 'assistant' && !!m.tools?.some(t => t.id === toolCallId), 
          'tools', 
          t => t.id === toolCallId,
          tool => ({ 
            ...tool, 
            resultMsgId: msgId, 
            status: (event.message.isError ? 'error' : 'success') as 'error' | 'success', 
            output: initialOutput || tool.output 
          })
        );
      }
    } else if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'thinking_start') {
      // Thinking only streams on the active assistant message (never tool results).
      if (lastIdx >= 0 && messages[lastIdx].role === 'assistant') {
        setMessages(lastIdx, 'isThinking', true);
      }
    } else if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'thinking_delta') {
      if (lastIdx >= 0 && messages[lastIdx].role === 'assistant') {
        setMessages(lastIdx, 'thinking', (t) => (t || '') + event.assistantMessageEvent.delta);
      }
    } else if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'thinking_end') {
      if (lastIdx >= 0 && messages[lastIdx].role === 'assistant') {
        setMessages(lastIdx, 'isThinking', false);
      }
    } else if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
      const msgId = event.message?.id || event.message?.responseId;
      
      const isToolResult = msgId 
        ? messages.some(m => m.tools?.some(t => t.resultMsgId === msgId))
        : (event.message?.role === 'toolResult' || !!event.message?.toolCallId);

      if (isToolResult) {
        const toolCallId = event.message?.toolCallId;
        if (toolCallId) {
          setMessages(
            m => m.role === 'assistant' && !!m.tools?.some(t => t.id === toolCallId),
            'tools',
            t => t.id === toolCallId,
            tool => ({ ...tool, output: (tool.output || '') + event.assistantMessageEvent.delta })
          );
        } else if (msgId) {
          setMessages(
            m => m.role === 'assistant' && !!m.tools?.some(t => t.resultMsgId === msgId),
            'tools',
            t => t.resultMsgId === msgId,
            tool => ({ ...tool, output: (tool.output || '') + event.assistantMessageEvent.delta })
          );
        }
      } else {
        if (lastIdx >= 0 && messages[lastIdx].role === 'assistant') {
          setMessages(lastIdx, 'content', (c) => (c || '') + event.assistantMessageEvent.delta);
        }
      }
    } else if (event.type === 'message_end') {
      setMessages(m => m.isStreaming === true, 'isStreaming', false);
      setMessages(m => m.isThinking === true, 'isThinking', false);
    } else if (event.type === 'agent_start') {
      setIsProcessing(true);
    } else if (event.type === 'agent_end') {
      setIsProcessing(false);
      setMessages(m => m.isStreaming === true, 'isStreaming', false);
      setMessages(m => m.isThinking === true, 'isThinking', false);
      // All message_end persistence has already run before agent_end, so the
      // session file on disk now has real metadata (first message, count).
      if (props.onTurnComplete) props.onTurnComplete();
    } else if (event.type === 'tool_execution_start') {
      if (lastIdx >= 0 && messages[lastIdx].role === 'assistant') {
        const toolName = event.toolName || event.name || (event.toolCall && event.toolCall.name) || 'tool';
        setMessages(lastIdx, 'tools', (t) => [...(t || []), { 
          id: event.toolCallId, 
          name: toolName, 
          status: 'running' as const,
          args: event.args,
        }]);
      }
    } else if (event.type === 'tool_execution_update') {
      if (lastIdx >= 0 && messages[lastIdx].role === 'assistant') {
        setMessages(lastIdx, 'tools', (tools) =>
          tools ? tools.map((t) => t.id === event.toolCallId ? { ...t, output: (t.output || '') + (event.delta || '') } : t) : []
        );
      }
    } else if (event.type === 'tool_execution_end') {
      if (lastIdx >= 0 && messages[lastIdx].role === 'assistant') {
        setMessages(lastIdx, 'tools', (tools) =>
          tools ? tools.map((t) => t.id === event.toolCallId ? { ...t, status: event.isError ? 'error' : 'success' } : t) : []
        );
      }
    }
  };

  // Gate live events by the committed session. Events for a not-yet-committed
  // new session are buffered until the /api/chat response promises its id.
  const handleAgentEvent = (event: any) => {
    if (event.sessionId) {
      if (props.activeSessionId) {
        if (event.sessionId !== props.activeSessionId) return;
      } else {
        pendingEventBuffer.push(event);
        return;
      }
    }
    applyEvent(event);
  };

  const showToast = (message: string, type: string = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  };

  const handleUiMethod = (data: any) => {
    switch (data.method) {
      case 'select':
      case 'confirm':
      case 'input':
      case 'editor':
        setUiRequest(data);
        break;
      case 'notify':
        showToast(data.message, data.notifyType || 'info');
        break;
      case 'setStatus':
        if (data.statusText === undefined || data.statusText === null) {
          setStatusEntries(produce((s) => { delete s[data.statusKey]; }));
        } else {
          setStatusEntries(data.statusKey, data.statusText);
        }
        break;
      case 'setWidget':
        setWidgets((prev) => {
          const next = { ...prev };
          if (!data.widgetLines) {
            delete next[data.widgetKey];
          } else {
            next[data.widgetKey] = { lines: data.widgetLines, placement: data.widgetPlacement };
          }
          return next;
        });
        break;
      case 'setTitle':
        if (data.title) document.title = data.title;
        break;
      case 'setEditorText':
        if (textareaRef) textareaRef.value = data.text || '';
        setInput(data.text || '');
        break;
      case 'pasteToEditor':
        if (textareaRef) {
          const cur = textareaRef.value;
          const pos = textareaRef.selectionStart;
          const pasted = cur.slice(0, pos) + (data.text || '') + cur.slice(textareaRef.selectionEnd);
          textareaRef.value = pasted;
          setInput(pasted);
          textareaRef.focus();
        }
        break;
      case 'setWorkingMessage':
      case 'setWorkingVisible':
      case 'setWorkingIndicator':
      case 'setHiddenThinkingLabel':
      case 'setToolsExpanded':
        // These affect streaming/UX presentation; no visual surface needed yet.
        break;
      default:
        break;
    }
  };

  const handleUiRespond = async (response: any) => {
    setUiRequest(null);
    try {
      await fetch('/api/ui-response', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(response),
      });
    } catch (err) {
      console.error('Failed to send UI response:', err);
    }
    // Reclaim focus to the composer once the blocking request is dismissed.
    requestAnimationFrame(() => textareaRef?.focus());
  };

  const handleSubmit = async (e?: Event) => {
    e?.preventDefault();
    if (!input().trim() && attachments().length === 0) return;

    const userMessage = input();
    const pendingAttachments = attachments();
    setInput('');
    setAttachments([]);

    // Attach real image previews to the optimistic bubble; text files stay
    // inlined in the prompt text (not shown as separate UI elements).
    const messageImages = pendingAttachments
      .filter(a => a.kind === 'image' && a.previewUrl)
      .map(a => ({ url: a.previewUrl!, mimeType: a.mimeType }));

    setMessages(messages.length, {
      id: Date.now().toString(),
      role: 'user',
      content: userMessage,
      images: messageImages.length ? messageImages : undefined,
    });

    // Images go through the SDK's images option; text files are inlined into
    // the prompt so the model receives their contents.
    const images = pendingAttachments
      .filter(a => a.kind === 'image' && a.data)
      .map(a => ({ type: 'image' as const, data: a.data!, mimeType: a.mimeType }));
    const fileTexts = pendingAttachments.filter(a => a.kind === 'file' && a.text);
    let promptText = userMessage;
    if (fileTexts.length) {
      const inlined = fileTexts.map(f => `<file name="${f.name}">\n${f.text}\n</file>`).join('\n\n');
      promptText = promptText ? `${promptText}\n\n${inlined}` : inlined;
    }

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          prompt: promptText,
          sessionId: props.activeSessionId,
          project_id: props.activeProjectId,
          modelId: selectedModel() || undefined,
          images: images.length ? images : undefined,
        }),
      });
      const data = await res.json();
      if (data.sessionId && data.sessionId !== props.activeSessionId) {
        pendingSessionId = data.sessionId;
        props.onSessionCreated(data.sessionId, data.projectId);
      }
    } catch (err) {
      console.error('Failed to send message:', err);
      setIsProcessing(false);
    }
  };

  const handleStop = async () => {
    if (!props.activeSessionId) return;
    try {
      await fetch(`/api/chat/${props.activeSessionId}/abort`, {
        method: 'POST'
      });
    } catch (err) {
      console.error('Failed to abort:', err);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const commands = filteredCommands();
    
    if (commands) {
      // In a drop-up, ArrowUp moves visually UP (away from input) -> higher index
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % commands.length);
        return;
      } 
      // ArrowDown moves visually DOWN (towards input) -> lower index
      else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + commands.length) % commands.length);
        return;
      } else if (e.key === 'Enter') {
        e.preventDefault();
        applyCommand(commands[selectedIndex()]);
        return;
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setInput('');
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const applyCommand = (cmd: { name: string }) => {
    // Replace the initial slash word with the completed command
    const text = input();
    const replaced = text.replace(/^\/\S*/, `/${cmd.name} `);
    setInput(replaced);
    setSelectedIndex(0);
  };

  const renderMarkdown = (content: string) => {
    if (!content) return '';
    
    // Process <thinking> and <think> tags into collapsible <details>
    let processed = stripAnsi(content);
    const openCount = (processed.match(/<thinking>|<think>/g) || []).length;
    const closeCount = (processed.match(/<\/thinking>|<\/think>/g) || []).length;
    
    processed = processed
      .replace(/<thinking>|<think>/g, '<details class="thinking-block" open><summary>Thinking process</summary><div class="thinking-content">\n\n')
      .replace(/<\/thinking>|<\/think>/g, '\n\n</div></details>');
      
    if (openCount > closeCount) {
      processed += '\n\n</div></details>';
    }

    try {
      const rawHtml = marked.parse(processed, { async: false }) as string;
      // Note: deliberately NOT allowing iframe or style attributes — model
      // output is untrusted and those defeat the point of sanitizing.
      return DOMPurify.sanitize(rawHtml, {
        USE_PROFILES: { html: true, svg: true },
        ADD_ATTR: ['class', 'target', 'viewBox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'id', 'name', 'type', 'checked', 'disabled'],
        ADD_TAGS: ['svg', 'path', 'g', 'circle', 'rect', 'line', 'polygon', 'polyline', 'defs', 'clipPath', 'text', 'details', 'summary', 'input', 'kbd', 'del']
      });
    } catch {
      return content;
    }
  };

  // Collapsible reasoning panel. Auto-expands while the model is actively
  // thinking, then collapses once the answer text begins streaming.
  const ThinkingSection = (p: { text: string; active: boolean }) => {
    const [expanded, setExpanded] = createSignal(p.active);
    let wasActive = p.active;
    createEffect(() => {
      // Collapse automatically on the active -> done transition, but leave the
      // user's manual toggle alone otherwise.
      if (wasActive && !p.active) setExpanded(false);
      wasActive = p.active;
    });
    return (
      <div class={`thinking-block ${p.active ? 'active' : ''}`}>
        <div class="thinking-summary" onClick={() => setExpanded(!expanded())}>
          <span class="thinking-summary-label">{p.active ? 'Thinking…' : 'Thought'}</span>
          <svg class={`thinking-chevron ${expanded() ? 'expanded' : ''}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </div>
        <Show when={expanded()}>
          <div class={`thinking-content ${p.active ? 'active' : ''}`} innerHTML={renderMarkdown(p.text)} />
        </Show>
      </div>
    );
  };

  return (
    <div class={`chat-container ${messages.length === 0 ? 'empty-mode' : ''}`}>
      <div class="system-status">
        <div>{isConnected() ? '🟢 Agent Connected' : '🔴 Agent Disconnected'}</div>
        <div class="ext-status-entries">
          <For each={Object.entries(statusEntries)}>
            {([key, text]) => <span class="ext-status-entry" title={key}>{text}</span>}
          </For>
        </div>
        <div style="display: flex; gap: 0.5rem;">
          <button 
            class="system-status-btn"
            onClick={() => setShowModal('skill')}
          >
            🤹 Skills
          </button>
          <button 
            class="system-status-btn"
            onClick={() => setShowModal('extension')}
          >
            🧩 Extensions
          </button>
        </div>
      </div>

      <Show when={toasts().length > 0}>
        <div class="toast-container">
          <For each={toasts()}>
            {(toast) => (
              <div class={`toast toast-${toast.type}`}>{toast.message}</div>
            )}
          </For>
        </div>
      </Show>

      {showModal() && (
        <div class="skills-modal-overlay">
          <div class="skills-modal">
            <div class="skills-modal-header">
              <h2 class="skills-modal-title">
                {showModal() === 'skill' ? 'Skills' : 'Extensions'}
              </h2>
              <button onClick={() => setShowModal(null)} class="skills-modal-close">✕</button>
            </div>
            <div class="skills-modal-body">
              {resourcesList().filter(r => r.source === showModal()).length === 0 ? (
                <div class="skills-modal-empty">No {showModal()}s loaded.</div>
              ) : (
                <div class="skills-list">
                  <For each={resourcesList().filter(r => r.source === showModal())}>
                    {(res) => (
                      <div class="skill-card">
                        <div class="skill-card-header">
                          <span class="skill-card-name">{res.name}</span>
                          <span class="skill-card-source">{res.source}</span>
                        </div>
                        {res.description && <div class="skill-card-desc">{res.description}</div>}
                      </div>
                    )}
                  </For>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      
      <Show when={lightboxUrl()}>
        <div class="lightbox-overlay" onClick={() => setLightboxUrl(null)}>
          <img src={lightboxUrl()!} class="lightbox-image" alt="attachment" />
        </div>
      </Show>
      
      <div class="messages-area">
        <For each={messages}>
          {(msg) => (
            <Show when={hasRenderableContent(msg)}>
            <div class={`message ${msg.role}`}>
              <div class="message-bubble">
                {msg.images && msg.images.length > 0 && (
                  <div class="message-images">
                    <For each={msg.images}>
                      {(img) => (
                        <img src={img.url} class="message-image" alt="attachment" onClick={() => setLightboxUrl(img.url)} />
                      )}
                    </For>
                  </div>
                )}
                <Show when={msg.role === 'assistant' && (msg.thinking || msg.isThinking)}>
                  <ThinkingSection text={msg.thinking || ''} active={!!msg.isThinking} />
                </Show>
                <div
                  class="message-content"
                  innerHTML={renderMarkdown(msg.content)}
                />
                
                {msg.tools && msg.tools.length > 0 && (
                  <div class="tool-executions">
                    <For each={msg.tools}>
                      {(tool) => {
                        // Running tools stay expanded; finished ones auto-collapse.
                        const [expanded, setExpanded] = createSignal(tool.status === 'running');
                        const summary = toolSummary(tool.name, tool.args);
                        const argSections = formatToolArgs(tool.name, tool.args);
                        return (
                          <div class="tool-execution">
                            <div
                              class={`tool-header ${tool.status} ${expanded() ? 'expanded' : ''}`}
                              onClick={() => setExpanded(!expanded())}
                            >
                              <span class="tool-name">{tool.name}</span>
                              {summary && <span class="tool-summary">{summary}</span>}
                              {(argSections.length > 0 || tool.output) && (
                                <svg class="tool-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                  <polyline points="6 9 12 15 18 9"></polyline>
                                </svg>
                              )}
                            </div>
                            <Show when={expanded()}>
                              {argSections.length > 0 && (
                                <div class="tool-call">
                                  <For each={argSections}>
                                    {(section) => (
                                      <div class={`tool-call-section ${section.label.toLowerCase()}`}>
                                        <div class="tool-call-label">{section.label}</div>
                                        <pre class="tool-call-value">{section.lines.join('\n')}</pre>
                                      </div>
                                    )}
                                  </For>
                                </div>
                              )}
                              {tool.name === 'edit' && (
                                <div class="tool-diffs">
                                  <For each={getEdits(tool.args)}>
                                    {(ed) => <DiffView oldText={ed.oldText} newText={ed.newText} />}
                                  </For>
                                </div>
                              )}
                              {tool.output && (
                                <div class="tool-body">
                                  {stripAnsi(tool.output)}
                                </div>
                              )}
                            </Show>
                          </div>
                        );
                      }}
                    </For>
                  </div>
                )}
                
                {msg.isStreaming && (
                  <div class="thinking-indicator">
                    <div class="thinking-dot"></div>
                    <div class="thinking-dot"></div>
                    <div class="thinking-dot"></div>
                  </div>
                )}
              </div>
            </div>
            </Show>
          )}
        </For>

        {isProcessing() && !messages.find(m => m.isStreaming) && (
          <div class="message assistant">
            <div class="message-bubble">
              <div class="thinking-indicator">
                <div class="thinking-dot"></div>
                <div class="thinking-dot"></div>
                <div class="thinking-dot"></div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div class="input-wrapper">
        <Show when={Object.keys(widgets()).length > 0}>
          <For each={Object.entries(widgets())}>
            {([key, widget]) => (
              <div class={`ext-widget ext-widget-${widget.placement || 'aboveEditor'}`}>
                <For each={widget.lines}>{(line) => <div class="ext-widget-line">{line}</div>}</For>
              </div>
            )}
          </For>
        </Show>
        <Show when={uiRequest()} keyed>
          {(req) => <UiRequestModal request={req} onRespond={handleUiRespond} />}
        </Show>
        <Show when={!uiRequest()}>
        {messages.length === 0 && (
          <div class="top-project-row">
            <CustomSelect 
              triggerClass="project-selector" 
              value={props.activeProjectId || ''} 
              onChange={(val) => {
                if (props.onSelectProject) props.onSelectProject(val);
              }}
              options={projects().map(p => ({ value: p.id, label: p.name, icon: 'folder' }))}
              placeholder="Select a Project"
              position="bottom"
            />
          </div>
        )}
        <div class={`input-area relative ${isDragOver() ? 'drag-over' : ''}`} onDrop={handleDrop} onDragOver={(e) => e.preventDefault()} onDragEnter={handleDragEnter} onDragLeave={handleDragLeave}>
          <Show when={attachments().length > 0}>
            <div class="attachment-previews">
              <For each={attachments()}>
                {(att) => (
                  <div class={`attachment-chip ${att.kind === 'image' ? 'is-image' : 'is-file'}`}>
                    <Show when={att.kind === 'image' && att.previewUrl} fallback={
                      <span class="attachment-file-icon">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                          <polyline points="14 2 14 8 20 8"></polyline>
                        </svg>
                      </span>
                    }>
                      <img src={att.previewUrl} alt={att.name} class="attachment-thumb" />
                    </Show>
                    <span class="attachment-chip-name" title={att.name}>{att.name}</span>
                    <button class="attachment-chip-remove" onClick={() => removeAttachment(att.id)} title="Remove">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                      </svg>
                    </button>
                  </div>
                )}
              </For>
            </div>
          </Show>
          {filteredCommands() && (
            <div class="autocomplete-popup">
              <div class="autocomplete-header">
                Slash Commands
              </div>
              <div class="autocomplete-list">
                <For each={[...filteredCommands()!].reverse()}>
                  {(cmd, index) => {
                    const originalIndex = () => filteredCommands()!.length - 1 - index();
                    return (
                      <div 
                        class={`autocomplete-item ${originalIndex() === selectedIndex() ? 'selected' : ''}`}
                        onClick={() => applyCommand(cmd)}
                      >
                        <div class="autocomplete-item-title">
                          <span class="autocomplete-item-name">/{cmd.name}</span>
                          <span class="autocomplete-item-source">{cmd.source}</span>
                        </div>
                        {cmd.description && <span class="autocomplete-item-desc">{cmd.description}</span>}
                      </div>
                    );
                  }}
                </For>
              </div>
            </div>
          )}
          <textarea
            ref={textareaRef}
            class="input-field"
            placeholder="Ask anything, @ to mention, / for actions"
            value={input()}
            onInput={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            rows={1}
            disabled={!isConnected() || !!uiRequest()}
          />
          <div class="input-toolbar">
            <div class="input-toolbar-left">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ACCEPT_ATTR}
                style="display: none;"
                onChange={handleFileInput}
              />
              <button class="input-toolbar-btn" title="Add image or file" disabled={!!uiRequest()} onClick={() => fileInputRef?.click()}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
              </button>
              <CustomSelect
                triggerClass="model-selector"
                value={selectedModel()}
                onChange={(val) => selectModel(val)}
                options={models()}
                placeholder="Default model"
                position="top"
              />
            </div>
            
            <Show when={isProcessing()}>
              <button 
                class="stop-button" 
                onClick={() => handleStop()}
                title="Stop generation"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                </svg>
              </button>
            </Show>
            <Show when={!isProcessing()}>
              <button 
                class="send-button" 
                onClick={() => handleSubmit()}
                disabled={!!uiRequest() || (!input().trim() && attachments().length === 0) || !isConnected()}
                title={uiRequest() ? "Respond to the request first" : "Send message"}
                style={(!input().trim() && attachments().length === 0) ? "background: transparent; box-shadow: none; color: var(--text-secondary);" : ""}
              >
                <Show when={!input().trim() && attachments().length === 0}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                    <line x1="12" y1="19" x2="12" y2="22"></line>
                  </svg>
                </Show>
                <Show when={input().trim() || attachments().length > 0}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13"></line>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                  </svg>
                </Show>
              </button>
            </Show>
          </div>
        </div>
        </Show>
      </div>
    </div>
  );
}
