import { createSignal, createEffect, createMemo, For, lazy, Show, Suspense, onCleanup, onMount } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import type { Attachment, ChatMessage, CommandInfo, ContextInfo, ExtWidget, ProjectInfo } from '../types';
import { applyAgentEvent } from '../lib/chatEvents';
import { trackSessionEvent, setSessionStatus, sessionStatuses } from '../lib/sessionStatus';
import { hasRenderableContent, mapHistoryToMessages } from '../lib/messages';
import { computeSessionDiffs, emptyDiffSummary } from '../lib/sessionDiff';
import { stripAnsi } from '../lib/markdown';
import { getChatDraft, setChatDraft } from '../lib/chatDraft';
import './ChatInterface.css';
import CustomSelect from './CustomSelect';
import Composer, { type ComposerApi } from './Composer';
import MessageBubble from './MessageBubble';
import UiRequestModal, { type UiRequest } from './UiRequestModal';
import QuestionsModal, { type QuestionsRequest } from './QuestionsModal';
import RightPanel, { type PanelTabId } from './RightPanel';
import DiffStats from './DiffStats';
import { startPointerResize } from '../lib/resize';
import { SessionEventBuffer } from '../lib/sessionEventBuffer';
import { createModelPreferences } from '../lib/modelPreferences';
import { getRightPanelState, setRightPanelState } from '../lib/rightPanelState';

const BrowserTab = lazy(() => import('./BrowserTab'));
const ChangesTab = lazy(() => import('./ChangesTab'));
const GitTab = lazy(() => import('./GitTab'));

export default function ChatInterface(props: { activeSessionId?: string, activeProjectId?: string, onSelectProject?: (id: string) => void, onSessionCreated: (id: string, projectId?: string, firstMessage?: string) => void, onTurnComplete?: () => void, projectRefreshTrigger?: number }) {
  const [messages, setMessages] = createStore<ChatMessage[]>([]);
  // Only needed during the brief new-chat window before /api/chat returns a
  // session id. Existing sessions derive processing from sessionStatuses.
  const [newSessionProcessing, setNewSessionProcessing] = createSignal(false);
  const isProcessing = () => {
    if (!props.activeSessionId) return newSessionProcessing();
    const status = sessionStatuses[props.activeSessionId];
    return status === 'working' || status === 'needsInput';
  };
  const [isConnected, setIsConnected] = createSignal(false);
  const [lightboxUrl, setLightboxUrl] = createSignal<string | null>(null);
  const [commandsList, setCommandsList] = createSignal<CommandInfo[]>([]);
  const [projects, setProjects] = createSignal<ProjectInfo[]>([]);
  const {
    models,
    selectedModel,
    selectedThinkingLevel,
    thinkingLevelOptions,
    loadModels,
    selectModel,
    selectThinkingLevel,
  } = createModelPreferences();
  const [uiRequest, setUiRequest] = createSignal<UiRequest | null>(null);
  const [questionsRequest, setQuestionsRequest] = createSignal<QuestionsRequest | null>(null);
  const [statusEntries, setStatusEntries] = createStore<Record<string, string>>({});
  const [widgets, setWidgets] = createSignal<Record<string, ExtWidget>>({});
  const activeProject = () => projects().find((p) => p.id === props.activeProjectId);
  const chatDraftKey = () => props.activeSessionId
    ? `session:${props.activeSessionId}`
    : `project:${props.activeProjectId ?? 'none'}:new`;
  const activeSessionTitle = () => {
    const firstUserMessage = messages.find((m) => m.role === 'user' && m.content?.trim());
    const title = firstUserMessage?.content.trim().split('\n')[0] || 'New Chat';
    return title.length > 80 ? `${title.slice(0, 80)}…` : title;
  };
  // Context-window usage for the active session (drives the composer's
  // context indicator). Seeded by /api/sessions/:sessionId, refreshed by SSE events.
  const [contextInfo, setContextInfo] = createSignal<ContextInfo | null>(null);

  // Right side panel (tabbed; the Changes tab shows session/turn file diffs).
  const [panelOpen, setPanelOpen] = createSignal(false);
  const [panelTab, setPanelTab] = createSignal<PanelTabId>('changes');
  const [panelWidth, setPanelWidth] = createSignal(420);
  const [gitRefreshTrigger, setGitRefreshTrigger] = createSignal(0);
  // null = whole session; a number filters the Changes tab to that turn.
  const [diffTurn, setDiffTurn] = createSignal<number | null>(null);

  // File diffs reconstructed from this session's edit/write tool calls,
  // per turn and for the whole session. Recomputes as tool calls stream in.
  const diffs = createMemo(() => computeSessionDiffs(messages));

  const savePanelState = (open: boolean, tab = panelTab()) => {
    if (props.activeSessionId) setRightPanelState(props.activeSessionId, { open, tab });
  };

  const closePanel = () => {
    setPanelOpen(false);
    savePanelState(false);
  };

  const openChangesPanel = (turn?: number) => {
    setDiffTurn(turn ?? null);
    setPanelTab('changes');
    setPanelOpen(true);
    savePanelState(true, 'changes');
  };

  const togglePanel = () => {
    const open = !panelOpen();
    setPanelOpen(open);
    savePanelState(open);
  };

  const selectPanelTab = (tab: PanelTabId) => {
    setPanelTab(tab);
    savePanelState(panelOpen(), tab);
  };

  const openPanelTab = (tab: PanelTabId) => {
    setPanelTab(tab);
    setPanelOpen(true);
    savePanelState(true, tab);
  };

  const startPanelResize = (event: PointerEvent) => {
    if (window.matchMedia('(max-width: 768px)').matches) return;
    startPointerResize({
      event,
      startWidth: panelWidth(),
      min: 320,
      max: Math.min(720, Math.floor(window.innerWidth * 0.55)),
      direction: -1,
      bodyClass: 'resizing-right-panel',
      onWidth: setPanelWidth,
    });
  };

  // Stats for the "X files changed" chip rendered after message i, if that
  // message closes a turn that changed files. The last message only counts
  // once the turn has actually finished streaming.
  const turnChipFor = (i: number) => {
    const d = diffs();
    const turn = d.turnOf[i];
    if (!turn || messages[i].role === 'user') return null;
    const turnEnds = i === messages.length - 1 ? !isProcessing() : d.turnOf[i + 1] !== turn;
    if (!turnEnds) return null;
    const summary = d.turns.get(turn);
    if (!summary || summary.files.length === 0) return null;
    return { turn, files: summary.files.length, added: summary.added, deleted: summary.deleted };
  };

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
  const historyEventBuffer = new SessionEventBuffer<any>();

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
    loadModels().catch(console.error);
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
      setNewSessionProcessing(false);
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
    setNewSessionProcessing(false);
    setMessages([]);
    setPinnedToBottom(true); // fresh session — follow from the bottom
    setContextInfo(null);
    setUiRequest(null);
    setQuestionsRequest(null);
    const savedPanel = getRightPanelState(id);
    setPanelOpen(savedPanel.open);
    setPanelTab(savedPanel.tab);
    setDiffTurn(null);
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
    const seq = ++historyRequestSeq;
    if (!props.activeSessionId) {
      historyEventBuffer.cancel();
      setMessages([]);
      setUiRequest(null);
      setQuestionsRequest(null);
      return;
    }
    const sessionId = props.activeSessionId;
    historyEventBuffer.begin(sessionId);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
      if (!res.ok) throw new Error(`Failed to load history (${res.status})`);
      const data = await res.json();
      if (seq !== historyRequestSeq) return;
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
      // Sync the sidebar badge with the snapshot: a session opened mid-turn
      // or blocked on a dialog gets its indicator back (e.g. after a server
      // restart wiped the live status), and stale live badges get cleared.
      // Error badges are left alone — only the SSE stream knows about those.
      if (data.isStreaming) {
        setSessionStatus(sessionId, 'working');
      } else if (data.pendingUiRequests?.length) {
        setSessionStatus(sessionId, 'needsInput');
      } else if (sessionStatuses[sessionId] !== 'error') {
        setSessionStatus(sessionId, undefined);
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
      for (const event of historyEventBuffer.finish(sessionId, data.eventSeq)) dispatchSessionEvent(event);
    } catch (err) {
      if (seq === historyRequestSeq) historyEventBuffer.cancel();
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
      setProcessing: (processing) => {
        if (!props.activeSessionId) setNewSessionProcessing(processing);
      },
      onTurnComplete: props.onTurnComplete,
      onSuccessfulFileMutation: () => setGitRefreshTrigger((value) => value + 1),
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
        if (historyEventBuffer.capture(event)) return;
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
      id: crypto.randomUUID(),
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
      id: crypto.randomUUID(),
      role: 'user',
      content: userMessage,
      images: messageImages.length ? messageImages : undefined,
    });
    setPinnedToBottom(true); // user just sent — follow the reply

    // Images go through the SDK's images option; text files and @mentions are
    // inlined into the prompt so the model receives their contents.
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
    if (isNewSession) {
      awaitingSessionCommit = true;
      setNewSessionProcessing(true);
    }
    const stopBuffering = () => {
      if (isNewSession) {
        awaitingSessionCommit = false;
        pendingEventBuffer = [];
        setNewSessionProcessing(false);
      }
    };

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: promptText,
          // The typed message only — mentions live here, not in the appended
          // file attachments the server must not scan.
          mentionText: userMessage,
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
          id: crypto.randomUUID(),
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
        id: crypto.randomUUID(),
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
    <div class={`chat-layout ${panelOpen() ? 'panel-open' : ''}`} style={`--right-panel-width: ${panelWidth()}px`}>
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
          <Show when={!panelOpen()}>
            <div class="chat-header-panel-tabs" aria-label="Right sidebar tabs">
              <button
                class="chat-header-panel-tab"
                onClick={() => openPanelTab('server')}
                title="Open server status"
                aria-label="Open server status"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <rect x="3" y="4" width="18" height="7"></rect>
                  <rect x="3" y="13" width="18" height="7"></rect>
                  <line x1="7" y1="7.5" x2="7.01" y2="7.5"></line>
                  <line x1="7" y1="16.5" x2="7.01" y2="16.5"></line>
                </svg>
                <span class={`chat-header-panel-tab-dot ${isConnected() ? 'connected' : 'disconnected'}`} />
              </button>
              <button
                class="chat-header-panel-tab"
                onClick={() => openPanelTab('browser')}
                title="Open agent browser"
                aria-label="Open agent browser"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <rect x="3" y="4" width="18" height="16" rx="2"></rect>
                  <line x1="3" y1="9" x2="21" y2="9"></line>
                  <circle cx="6.5" cy="6.5" r="0.5" fill="currentColor" stroke="none"></circle>
                  <circle cx="9" cy="6.5" r="0.5" fill="currentColor" stroke="none"></circle>
                </svg>
              </button>
              <button
                class="chat-header-panel-tab"
                onClick={() => openPanelTab('changes')}
                title="Open changes"
                aria-label="Open changes"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                  <line x1="8" y1="13" x2="14" y2="13"></line>
                  <line x1="11" y1="10" x2="11" y2="16"></line>
                  <line x1="8" y1="18" x2="14" y2="18"></line>
                </svg>
              </button>
              <button
                class="chat-header-panel-tab"
                onClick={() => openPanelTab('git')}
                title="Open Git"
                aria-label="Open Git"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <circle cx="18" cy="18" r="3"></circle>
                  <circle cx="6" cy="6" r="3"></circle>
                  <circle cx="6" cy="18" r="3"></circle>
                  <path d="M6 9v6"></path>
                  <path d="M8.5 7.5 15.5 16.5"></path>
                </svg>
              </button>
              <button
                class="chat-header-panel-tab"
                onClick={togglePanel}
                title="Open right sidebar"
                aria-label="Open right sidebar"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <rect x="3" y="4" width="18" height="16" rx="2"></rect>
                  <line x1="15" y1="4" x2="15" y2="20"></line>
                </svg>
              </button>
            </div>
          </Show>
        </div>
      </Show>

      <div class="messages-area" ref={messagesAreaRef} onScroll={handleScroll}>
        <For each={messages}>
          {(msg, i) => (
            <>
              <Show when={hasRenderableContent(msg)}>
                <MessageBubble msg={msg} onImageClick={setLightboxUrl} />
              </Show>
              <Show when={turnChipFor(i())} keyed>
                {(chip) => (
                  <div class="turn-diff-row">
                    <button
                      class="diff-stats-chip"
                      onClick={() => openChangesPanel(chip.turn)}
                      title={`Show file changes from turn ${chip.turn}`}
                    >
                      <DiffStats files={chip.files} added={chip.added} deleted={chip.deleted} />
                    </button>
                  </div>
                )}
              </Show>
            </>
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
          <Show when={props.activeSessionId}>
            <div class="composer-session-bar">
              <Show when={activeProject()} keyed>
                {(project) => <span class="composer-session-project" title={project.path}>{project.name}</span>}
              </Show>
              <Show when={diffs().session.files.length > 0}>
                <button
                  class="diff-stats-chip session"
                  onClick={() => openChangesPanel()}
                  title="Show all file changes from this session"
                >
                  <DiffStats
                    files={diffs().session.files.length}
                    added={diffs().session.added}
                    deleted={diffs().session.deleted}
                  />
                </button>
              </Show>
            </div>
          </Show>
          <Composer
            isConnected={isConnected()}
            isProcessing={isProcessing()}
            disabled={!!uiRequest() || !!questionsRequest()}
            commands={commandsList()}
            projectId={props.activeProjectId}
            draftKey={chatDraftKey()}
            draftText={getChatDraft(chatDraftKey())}
            onDraftChange={(text) => setChatDraft(chatDraftKey(), text)}
            models={models()}
            selectedModel={selectedModel()}
            onSelectModel={selectModel}
            thinkingLevels={thinkingLevelOptions()}
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

    <Show when={panelOpen()}>
      <div
        class="right-panel-overlay"
        onClick={closePanel}
      />
      <div
        class="right-panel-resize-handle"
        onPointerDown={startPanelResize}
        title="Resize right sidebar"
        aria-label="Resize right sidebar"
      />
    </Show>
    <RightPanel
      class={panelOpen() ? 'panel-open' : ''}
      tabs={[{ id: 'server', label: 'Server' }, { id: 'browser', label: 'Browser' }, { id: 'changes', label: 'Changes' }, { id: 'git', label: 'Git' }]}
      activeTab={panelTab()}
      onSelectTab={selectPanelTab}
      onClose={closePanel}
    >
      <Show when={panelOpen() && panelTab() === 'browser'}>
        <Suspense>
          <BrowserTab />
        </Suspense>
      </Show>
      <Show when={panelOpen() && panelTab() === 'changes'}>
        <Suspense>
          <ChangesTab
            diff={diffTurn() != null ? (diffs().turns.get(diffTurn()!) ?? emptyDiffSummary()) : diffs().session}
            turnFilter={diffTurn()}
            onClearFilter={() => setDiffTurn(null)}
          />
        </Suspense>
      </Show>
      <Show when={panelOpen() && panelTab() === 'git'}>
        <Suspense>
          <GitTab projectId={props.activeProjectId} refreshTrigger={gitRefreshTrigger()} />
        </Suspense>
      </Show>
      <Show when={panelOpen() && panelTab() === 'server'}>
        <div class="server-status-panel">
          <div class="server-status-panel-card">
            <div
              class={`server-status-indicator ${isConnected() ? 'connected' : 'disconnected'}`}
              title={isConnected() ? 'Server connected' : 'Server disconnected'}
              aria-label={isConnected() ? 'Server connected' : 'Server disconnected'}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="7"></rect>
                <rect x="3" y="13" width="18" height="7"></rect>
                <line x1="7" y1="7.5" x2="7.01" y2="7.5"></line>
                <line x1="7" y1="16.5" x2="7.01" y2="16.5"></line>
              </svg>
              <span class="server-status-dot" />
            </div>
            <div>
              <div class="server-status-panel-title">Server</div>
              <div class={`server-status-panel-value ${isConnected() ? 'connected' : 'disconnected'}`}>
                {isConnected() ? 'Connected' : 'Disconnected'}
              </div>
            </div>
          </div>
        </div>
      </Show>
    </RightPanel>
    </div>
  );
}
