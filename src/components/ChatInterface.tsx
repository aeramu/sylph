import { createSignal, createEffect, For, Show, onCleanup, onMount } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import type { Attachment, ChatMessage, CommandInfo, ExtWidget, ModelOption, ResourceInfo, Toast } from '../types';
import { applyAgentEvent } from '../lib/chatEvents';
import { hasRenderableContent, mapHistoryToMessages } from '../lib/messages';
import CustomSelect from './CustomSelect';
import Composer, { type ComposerApi } from './Composer';
import MessageBubble from './MessageBubble';
import ResourcesModal from './ResourcesModal';
import UiRequestModal, { type UiRequest } from './UiRequestModal';

export default function ChatInterface(props: { activeSessionId?: string, activeProjectId?: string, onSelectProject?: (id: string) => void, onSessionCreated: (id: string, projectId?: string) => void, onTurnComplete?: () => void }) {
  const [messages, setMessages] = createStore<ChatMessage[]>([]);
  const [isProcessing, setIsProcessing] = createSignal(false);
  const [isConnected, setIsConnected] = createSignal(false);
  const [showModal, setShowModal] = createSignal<'skill' | 'extension' | null>(null);
  const [lightboxUrl, setLightboxUrl] = createSignal<string | null>(null);
  const [commandsList, setCommandsList] = createSignal<CommandInfo[]>([]);
  const [resourcesList, setResourcesList] = createSignal<ResourceInfo[]>([]);
  const [projects, setProjects] = createSignal<any[]>([]);
  const [models, setModels] = createSignal<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = createSignal('');
  const [uiRequest, setUiRequest] = createSignal<UiRequest | null>(null);
  const [toasts, setToasts] = createSignal<Toast[]>([]);
  const [statusEntries, setStatusEntries] = createStore<Record<string, string>>({});
  const [widgets, setWidgets] = createSignal<Record<string, ExtWidget>>({});

  let composerApi: ComposerApi | undefined;

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
      setMessages(mapHistoryToMessages(data.messages || []));
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
    applyAgentEvent(messages, setMessages, event, {
      setProcessing: setIsProcessing,
      onTurnComplete: props.onTurnComplete,
    });
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
        composerApi?.setText(data.text || '');
        break;
      case 'pasteToEditor':
        composerApi?.pasteText(data.text || '');
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
    requestAnimationFrame(() => composerApi?.focus());
  };

  const handleSubmit = async (userMessage: string, pendingAttachments: Attachment[]) => {
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

      <Show when={showModal()} keyed>
        {(kind) => (
          <ResourcesModal kind={kind} resources={resourcesList()} onClose={() => setShowModal(null)} />
        )}
      </Show>

      <Show when={lightboxUrl()}>
        <div class="lightbox-overlay" onClick={() => setLightboxUrl(null)}>
          <img src={lightboxUrl()!} class="lightbox-image" alt="attachment" />
        </div>
      </Show>

      <div class="messages-area">
        <For each={messages}>
          {(msg) => (
            <Show when={hasRenderableContent(msg)}>
              <MessageBubble msg={msg} onImageClick={setLightboxUrl} />
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
            {([, widget]) => (
              <div class={`ext-widget ext-widget-${widget.placement || 'aboveEditor'}`}>
                <For each={widget.lines}>{(line) => <div class="ext-widget-line">{line}</div>}</For>
              </div>
            )}
          </For>
        </Show>
        <Show when={uiRequest()} keyed>
          {(req) => <UiRequestModal request={req} onRespond={handleUiRespond} />}
        </Show>
        {/* Hidden (not unmounted) while a UI request is active so draft text
            and attachments survive permission prompts. */}
        <div style={uiRequest() ? 'display: none;' : ''}>
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
          <Composer
            isConnected={isConnected()}
            isProcessing={isProcessing()}
            disabled={!!uiRequest()}
            commands={commandsList()}
            models={models()}
            selectedModel={selectedModel()}
            onSelectModel={selectModel}
            onSubmit={handleSubmit}
            onStop={handleStop}
            api={(api) => { composerApi = api; }}
          />
        </div>
      </div>
    </div>
  );
}
