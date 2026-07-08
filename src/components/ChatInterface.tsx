import { createSignal, createEffect, For, Show, onCleanup, onMount } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import type { Attachment, ChatMessage, CommandInfo, ContextInfo, ExtWidget, ModelOption, ThinkingLevel } from '../types';
import { THINKING_LEVELS } from '../types';
import { applyAgentEvent } from '../lib/chatEvents';
import { trackSessionEvent, setSessionStatus, sessionStatuses } from '../lib/sessionStatus';
import { hasRenderableContent, mapHistoryToMessages } from '../lib/messages';
import { stripAnsi } from '../lib/markdown';
import './ChatInterface.css';
import CustomSelect from './CustomSelect';
import Composer, { type ComposerApi } from './Composer';
import MessageBubble from './MessageBubble';
import UiRequestModal, { type UiRequest } from './UiRequestModal';
import QuestionsModal, { type QuestionsRequest } from './QuestionsModal';

export default function ChatInterface(props: { activeSessionId?: string, activeProjectId?: string, onSelectProject?: (id: string) => void, onSessionCreated: (id: string, projectId?: string, firstMessage?: string) => void, onTurnComplete?: () => void, projectRefreshTrigger?: number }) {
  const [messages, setMessages] = createStore<ChatMessage[]>([]);
  const [isProcessing, setIsProcessing] = createSignal(false);
  const [isConnected, setIsConnected] = createSignal(false);
  const [lightboxUrl, setLightboxUrl] = createSignal<string | null>(null);
  const [commandsList, setCommandsList] = createSignal<CommandInfo[]>([]);
  const [projects, setProjects] = createSignal<any[]>([]);
  const [models, setModels] = createSignal<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = createSignal('');
  const [uiRequest, setUiRequest] = createSignal<UiRequest | null>(null);
  const [questionsRequest, setQuestionsRequest] = createSignal<QuestionsRequest | null>(null);
  const [statusEntries, setStatusEntries] = createStore<Record<string, string>>({});
  const [widgets, setWidgets] = createSignal<Record<string, ExtWidget>>({});
  const activeProject = () => projects().find((p) => p.id === props.activeProjectId);
  const activeSessionTitle = () => {
    const firstUserMessage = messages.find((m) => m.role === 'user' && m.content?.trim());
    const title = firstUserMessage?.content.trim().split('\n')[0] || 'New Chat';
    return title.length > 80 ? `${title.slice(0, 80)}…` : title;
  };
  // Context-window usage for the active session (drives the composer's
  // context indicator). Seeded by /api/sessions/:sessionId, refreshed by SSE events.
  const [contextInfo, setContextInfo] = createSignal<ContextInfo | null>(null);

  let composerApi: ComposerApi | undefined;

  // Session id promised by the /api/chat response but not yet committed as
  // active. The HTTP response is the single authoritative source of the id;
  // SSE events for an uncommitted session are buffered until it commits.
  let pendingSessionId: string | null = null;
  // True from submitting a prompt with no active session until that session
  // commits (or the request fails). Buffering is gated on it so an idle
  // new-chat screen doesn't accumulate events from unrelated sessions.
  let awaitingSessionCommit = false;
  let pendingEventBuffer: any[] = [];
  // Guards fetchHistory against stale responses when switching sessions fast.
  let historyRequestSeq = 0;
  // While a snapshot is in flight, live events for the session are dropped:
  // the server serves the snapshot from the same live state, so events
  // received during the fetch are already part of it (applying them too
  // would duplicate streamed content).
  let historyLoading = false;

  const fetchProjects = () => {
    fetch(`/api/projects`).then(res => res.json()).then(data => {
      const list = data.projects || [];
      setProjects(list);
      // Auto-select the first project on initial load so the composer
      // doesn't sit on a "Select a Project" placeholder when projects
      // already exist.
      if (!props.activeProjectId && list.length > 0 && props.onSelectProject) {
        props.onSelectProject(list[0].id);
      }
    });
  };

  const fetchModels = () => {
    fetch('/api/models').then(res => res.json()).then(data => {
      if (data.models && data.models.length > 0) {
        // Use the server-provided value ("provider/id") directly as the
        // select value, so the ID round-trips without name ambiguity.
        const mapped = data.models.map((m: any) => {
          const value = m.value || `${m.provider}/${m.id}`;
          const provider = m.provider || String(value).split('/')[0] || 'Other';
          return {
            value,
            label: m.id,
            provider,
            searchText: `${provider} ${m.id} ${value}`,
          };
        });
        setModels(mapped);

        let saved: string | null = null;
        try { saved = localStorage.getItem('sylph.selectedModel'); } catch {}
        const initial = (saved && mapped.find((m: any) => m.value === saved))
          || mapped.find((m: any) => m.value.toLowerCase().includes('flash'))
          || mapped[0];
        if (initial) setSelectedModel(initial.value);
      }
    }).catch(console.error);
  };

  const selectModel = (id: string) => {
    setSelectedModel(id);
    try { localStorage.setItem('sylph.selectedModel', id); } catch {}
  };

  const [selectedThinkingLevel, setSelectedThinkingLevel] = createSignal<ThinkingLevel>('medium');

  // Restore persisted thinking level preference.
  try {
    const saved = localStorage.getItem('sylph.thinkingLevel') as ThinkingLevel | null;
    if (saved && THINKING_LEVELS.some((l) => l.value === saved)) setSelectedThinkingLevel(saved);
  } catch {}

  const selectThinkingLevel = (level: ThinkingLevel) => {
    setSelectedThinkingLevel(level);
    try { localStorage.setItem('sylph.thinkingLevel', level); } catch {}
  };

  let messagesAreaRef: HTMLDivElement | undefined;
  let messagesEndRef: HTMLDivElement | undefined;
  let eventSource: EventSource | null = null;
  let chatDragCounter = 0;
  const [isChatDragOver, setIsChatDragOver] = createSignal(false);

  // "Pinned to bottom" = the view should follow new content as it streams.
  // The user breaks the pin by scrolling up to read history; we restore it
  // when they scroll back near the bottom, or when they submit a prompt.
  const [pinnedToBottom, setPinnedToBottom] = createSignal(true);
  const NEAR_BOTTOM_THRESHOLD = 80; // px slack so tiny renders don't unpin

  const isNearBottom = (el: HTMLElement) =>
    el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_THRESHOLD;

  const handleScroll = () => {
    if (!messagesAreaRef) return;
    setPinnedToBottom(isNearBottom(messagesAreaRef));
  };

  // Instant scroll during streaming. Smooth scroll fired on every delta
  // feels laggy because each animation is cancelled by the next one.
  const scrollToBottom = () => {
    if (messagesAreaRef) {
      messagesAreaRef.scrollTop = messagesAreaRef.scrollHeight;
    } else {
      messagesEndRef?.scrollIntoView({ behavior: 'auto' });
    }
  };

  createEffect(() => {
    const count = messages.length; // re-run when messages are added/removed
    // Re-run on streaming content/thinking deltas too, so the view follows
    // the live message instead of only when a brand-new bubble appears.
    for (let i = count - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.isStreaming) {
        void m.content; // track
        void m.thinking; // track
        break;
      }
    }
    if (pinnedToBottom()) scrollToBottom();
  });

  onMount(() => {
    fetchModels();
    fetchCommands();
    connectSSE();
  });

  // Project list drives the "Select a Project" dropdown for new chats.
  // Refetch on mount and whenever projects are added/removed elsewhere
  // (the sidebar's Add Project modal), so the dropdown never shows a stale
  // snapshot that's missing a freshly created project.
  createEffect(() => {
    void props.projectRefreshTrigger; // track
    fetchProjects();
  });

  createEffect(() => {
    const id = props.activeSessionId; // track
    if (id && pendingSessionId === id) {
      // We just committed a session we created; it's already streaming, so
      // replay buffered events instead of wiping and reloading history. Only
      // this session's events: while /api/chat was in flight, other sessions
      // may have streamed into the buffer too.
      pendingSessionId = null;
      awaitingSessionCommit = false;
      const buffered = pendingEventBuffer;
      pendingEventBuffer = [];
      for (const e of buffered) {
        if (e.sessionId === id) dispatchSessionEvent(e);
      }
      return;
    }
    pendingSessionId = null;
    awaitingSessionCommit = false;
    pendingEventBuffer = [];
    setMessages([]);
    setPinnedToBottom(true); // fresh session — follow from the bottom
    setContextInfo(null);
    setUiRequest(null);
    setQuestionsRequest(null);
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

  const fetchHistory = async () => {
    if (!props.activeSessionId) {
      setMessages([]);
      setUiRequest(null);
      setQuestionsRequest(null);
      return;
    }
    const seq = ++historyRequestSeq;
    historyLoading = true;
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(props.activeSessionId)}`);
      const data = await res.json();
      if (seq !== historyRequestSeq) return; // a newer request superseded this one
      setMessages(mapHistoryToMessages(data.messages || []));
      setContextInfo(data.context || null);
      // Replace extension statuses with the snapshot's. Their live SSE
      // broadcasts are one-shot: any fired while this session wasn't active
      // (background turn, other tab) were dropped by the session gate, so the
      // server-side map is the authority here.
      setStatusEntries(produce((s) => {
        for (const k of Object.keys(s)) delete s[k];
        for (const [k, v] of Object.entries(data.statuses || {})) s[k] = v as string;
      }));
      // The session may be mid-turn (e.g. re-opened while streaming); restore
      // the working indicator we'd otherwise only get from the agent_start we
      // missed.
      setIsProcessing(!!data.isStreaming);
      // Sync the sidebar badge with the snapshot: a session opened mid-turn
      // or blocked on a dialog gets its indicator back (e.g. after a server
      // restart wiped the live status), and stale live badges get cleared.
      // Error badges are left alone — only the SSE stream knows about those.
      if (props.activeSessionId) {
        if (data.isStreaming) {
          setSessionStatus(props.activeSessionId, 'working');
        } else if (data.pendingUiRequests?.length) {
          setSessionStatus(props.activeSessionId, 'needsInput');
        } else if (sessionStatuses[props.activeSessionId] !== 'error') {
          setSessionStatus(props.activeSessionId, undefined);
        }
      }
      // Re-show a dialog the agent is still blocked on (its one-shot SSE
      // broadcast was dropped if we were on another session at the time).
      // Set-only: a request that arrived live during this fetch must not be
      // cleared by a snapshot built before it existed.
      const pendingUi = data.pendingUiRequests?.[0];
      if (pendingUi && !uiRequest() && !questionsRequest()) {
        if (pendingUi.method === 'questions') setQuestionsRequest(pendingUi);
        else setUiRequest(pendingUi);
      }
    } catch (err) {
      console.error('Failed to load history:', err);
    } finally {
      if (seq === historyRequestSeq) historyLoading = false;
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

      // Status tracking sees every session's events, before the
      // active-session gating below drops the foreign ones.
      trackSessionEvent(data);
      handleSessionEvent(data);
    };
  };

  const applyEvent = (event: any) => {
    // message_end / agent_end / compaction_end events carry a fresh
    // context-window snapshot (see server/runtimes.ts).
    if (event.context) setContextInfo(event.context);
    applyAgentEvent(messages, setMessages, event, {
      setProcessing: setIsProcessing,
      onTurnComplete: props.onTurnComplete,
    });
  };

  // Gate live session events (agent events and extension UI requests) by the
  // committed session. Events for a not-yet-committed new session are
  // buffered until the /api/chat response promises its id; with no submission
  // in flight, foreign-session events are just dropped.
  const handleSessionEvent = (event: any) => {
    if (event.sessionId) {
      if (props.activeSessionId) {
        if (event.sessionId !== props.activeSessionId) return;
        // Agent events during a history fetch are already part of the
        // snapshot being loaded; UI requests are not (the snapshot only
        // carries ones pending when it was built), so let them through.
        if (historyLoading && event.type !== 'extension_ui_request') return;
      } else if (awaitingSessionCommit) {
        pendingEventBuffer.push(event);
        return;
      } else {
        return;
      }
    }
    dispatchSessionEvent(event);
  };

  const dispatchSessionEvent = (event: any) => {
    if (event.type === 'extension_ui_request') {
      handleUiMethod(event);
    } else {
      applyEvent(event);
    }
  };

  const addNotification = (message: string, type: string = 'info') => {
    setMessages(messages.length, {
      id: Math.random().toString(36).slice(2),
      role: 'notification',
      content: message,
      notifyType: type,
    });
  };

  const handleUiMethod = (data: any) => {
    switch (data.method) {
      case 'select':
      case 'confirm':
      case 'input':
      case 'editor':
        setUiRequest(data);
        break;
      case 'questions':
        setQuestionsRequest(data);
        break;
      case 'notify':
        addNotification(data.message, data.notifyType || 'info');
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
    const request: any = uiRequest() || questionsRequest();
    const answeredSession = request?.sessionId || props.activeSessionId;
    // The agent unblocks as soon as the response lands; flip the sidebar
    // badge without waiting for the next agent event. Exception: dismissing a
    // reconstructed dialog (question that survived a server restart) resumes
    // nothing — the session just goes idle.
    if (answeredSession) {
      const idle = request?.reconstructed && response?.cancelled;
      setSessionStatus(answeredSession, idle ? undefined : 'working');
    }
    setUiRequest(null);
    setQuestionsRequest(null);
    try {
      if (!answeredSession) throw new Error('No session for UI response');
      await fetch(`/api/sessions/${encodeURIComponent(answeredSession)}/ui-response`, {
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
    setPinnedToBottom(true); // user just sent — follow the reply

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

    // For a brand-new chat the session id only arrives with the /api/chat
    // response; buffer this session's SSE events until then.
    const isNewSession = !props.activeSessionId;
    if (isNewSession) awaitingSessionCommit = true;
    const stopBuffering = () => {
      if (isNewSession) {
        awaitingSessionCommit = false;
        pendingEventBuffer = [];
      }
    };

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: promptText,
          sessionId: props.activeSessionId,
          projectId: props.activeProjectId,
          modelId: selectedModel() || undefined,
          thinkingLevel: selectedThinkingLevel(),
          images: images.length ? images : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        stopBuffering();
        // Server-side error (unknown model, no auth, provider error, etc.).
        // Render it as an assistant error bubble so the user sees what went
        // wrong instead of a silent hang.
        setMessages(messages.length, {
          id: Date.now().toString() + '-err',
          role: 'assistant',
          content: '',
          errorMessage: data.error || `Request failed (${res.status})`,
        });
        return;
      }
      if (data.sessionId && data.sessionId !== props.activeSessionId) {
        // The session-switch effect replays the buffer and clears the flag.
        // Fall back to the locally selected project if the server couldn't
        // resolve one, so the sidebar draft still lands in the right group.
        pendingSessionId = data.sessionId;
        props.onSessionCreated(data.sessionId, data.projectId ?? props.activeProjectId, userMessage.slice(0, 200));
      } else {
        stopBuffering();
      }
    } catch (err) {
      stopBuffering();
      console.error('Failed to send message:', err);
      setMessages(messages.length, {
        id: Date.now().toString() + '-err',
        role: 'assistant',
        content: '',
        errorMessage: err instanceof Error ? err.message : 'Failed to connect to server',
      });
    }
  };

  const handleStop = async () => {
    if (!props.activeSessionId) return;
    try {
      await fetch(`/api/sessions/${encodeURIComponent(props.activeSessionId)}/abort`, {
        method: 'POST'
      });
    } catch (err) {
      console.error('Failed to abort:', err);
    }
  };

  const hasDraggedFiles = (e: DragEvent) => e.dataTransfer?.types?.includes('Files');

  const handleChatDragEnter = (e: DragEvent) => {
    if (!hasDraggedFiles(e) || uiRequest()) return;
    e.preventDefault();
    chatDragCounter++;
    setIsChatDragOver(true);
  };

  const handleChatDragOver = (e: DragEvent) => {
    if (!hasDraggedFiles(e) || uiRequest()) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  };

  const handleChatDragLeave = (e: DragEvent) => {
    if (!hasDraggedFiles(e) || uiRequest()) return;
    e.preventDefault();
    chatDragCounter = Math.max(0, chatDragCounter - 1);
    if (chatDragCounter === 0) setIsChatDragOver(false);
  };

  const handleChatDrop = (e: DragEvent) => {
    if (!hasDraggedFiles(e) || uiRequest()) return;
    e.preventDefault();
    chatDragCounter = 0;
    setIsChatDragOver(false);
    if (e.dataTransfer?.files?.length) {
      composerApi?.addFiles(e.dataTransfer.files);
      requestAnimationFrame(() => composerApi?.focus());
    }
  };

  return (
    <div
      class={`chat-container ${messages.length === 0 ? 'empty-mode' : ''} ${isChatDragOver() ? 'chat-drag-over' : ''}`}
      onDragEnter={handleChatDragEnter}
      onDragOver={handleChatDragOver}
      onDragLeave={handleChatDragLeave}
      onDrop={handleChatDrop}
    >
      <Show when={isChatDragOver()}>
        <div class="chat-drop-overlay">
          <div class="chat-drop-card">
            <div class="chat-drop-icon">＋</div>
            <div class="chat-drop-title">Drop files or images to attach</div>
            <div class="chat-drop-subtitle">They’ll be added to the message composer</div>
          </div>
        </div>
      </Show>
      <Show when={lightboxUrl()}>
        <div class="lightbox-overlay" onClick={() => setLightboxUrl(null)}>
          <img src={lightboxUrl()!} class="lightbox-image" alt="attachment" />
        </div>
      </Show>

      <Show when={props.activeSessionId}>
        <div class="chat-header">
          <h1 class="chat-header-title" title={activeSessionTitle()}>{activeSessionTitle()}</h1>
          <Show when={activeProject()} keyed>
            {(project) => <span class="chat-header-project" title={project.path}>{project.name}</span>}
          </Show>
          <div
            class={`server-status-indicator ${isConnected() ? 'connected' : 'disconnected'}`}
            title={isConnected() ? 'Server connected' : 'Server disconnected'}
            aria-label={isConnected() ? 'Server connected' : 'Server disconnected'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="7"></rect>
              <rect x="3" y="13" width="18" height="7"></rect>
              <line x1="7" y1="7.5" x2="7.01" y2="7.5"></line>
              <line x1="7" y1="16.5" x2="7.01" y2="16.5"></line>
            </svg>
            <span class="server-status-dot" />
          </div>
        </div>
      </Show>

      <div class="messages-area" ref={messagesAreaRef} onScroll={handleScroll}>
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
        <Show when={questionsRequest()} keyed>
          {(req) => <QuestionsModal request={req} onRespond={handleUiRespond} />}
        </Show>
        {/* Hidden (not unmounted) while a UI request is active so draft text
            and attachments survive permission prompts. */}
        <div style={uiRequest() || questionsRequest() ? 'display: none;' : ''}>
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
            disabled={!!uiRequest() || !!questionsRequest()}
            commands={commandsList()}
            models={models()}
            selectedModel={selectedModel()}
            onSelectModel={selectModel}
            thinkingLevels={THINKING_LEVELS}
            selectedThinkingLevel={selectedThinkingLevel()}
            onSelectThinkingLevel={selectThinkingLevel}
            contextInfo={contextInfo()}
            onSubmit={handleSubmit}
            onStop={handleStop}
            api={(api) => { composerApi = api; }}
          />
        </div>
        <Show when={Object.keys(statusEntries).length > 0}>
          <div class="ext-status-entries">
            <For each={Object.keys(statusEntries)}>
              {(key) => (
                // Statuses arrive ANSI-styled (pi extensions color them for
                // the TUI footer); render the text, drop the escapes.
                <span class="ext-status-entry" title={key}>{stripAnsi(statusEntries[key])}</span>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}
