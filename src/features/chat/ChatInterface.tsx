import { createSignal, createEffect, createMemo, Show, onCleanup, onMount } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import type { Attachment, ChatMessage, CommandInfo, ContextInfo, ExtWidget, ProjectInfo } from '../../types';
import { applyAgentEvent } from '../../lib/chatEvents';
import { trackSessionEvent, setSessionStatus, sessionStatuses } from '../../lib/sessionStatus';
import { mapHistoryToMessages } from '../../lib/messages';
import { computeSessionDiffs, emptyDiffSummary } from '../../lib/sessionDiff';
import { getChatDraft, setChatDraft } from '../../lib/chatDraft';
import './ChatInterface.css';
import Composer, { type ComposerApi } from '../composer/Composer';
import ChatHeader from './components/ChatHeader';
import MessageTimeline from './components/MessageTimeline';
import NewChatSetup from './components/NewChatSetup';
import SessionBar from './components/SessionBar';
import ExtensionUiHost from './components/ExtensionUiHost';
import ChatRightPanel from './components/ChatRightPanel';
import type { UiRequest } from './UiRequestModal';
import type { QuestionsRequest } from './QuestionsModal';
import type { PanelTabId } from '../../shared/ui/RightPanel';
import { startPointerResize } from '../../lib/resize';
import { SessionEventBuffer } from '../../lib/sessionEventBuffer';
import { createModelPreferences } from '../../lib/modelPreferences';
import { getRightPanelState, setRightPanelState } from '../../lib/rightPanelState';
import { createId } from '../../lib/id';
import { ApiError } from '../../lib/api';
import {
  abortSession, getSession, listBranches, listCommands, listDirectories, listProjects, recreateWorktree,
  removeWorktree, respondToUi, sendChat, type GitBranchOption, type SessionBindingInfo,
} from './api';
import { connectSessionStream, PendingSessionEvents, type SessionScopedEvent } from './createSessionStream';

export default function ChatInterface(props: { activeSessionId?: string, activeProjectId?: string, onSelectProject?: (id?: string) => void, newSessionRequest?: { id: number; standalonePath?: string }, onSessionCreated: (id: string, projectId?: string, firstMessage?: string, meta?: { directoryId?: string; branch?: string; worktree?: boolean }) => void, onTurnComplete?: () => void, onSessionRemoved?: (id: string) => void, projectRefreshTrigger?: number }) {
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
  const [branchesByDirectory, setBranchesByDirectory] = createSignal<Record<string, GitBranchOption[]>>({});
  const [selectedBaseBranches, setSelectedBaseBranches] = createSignal<Record<string, string>>({});
  const [useWorktree, setUseWorktree] = createSignal(false);
  const [selectedDirectoryId, setSelectedDirectoryId] = createSignal('');
  const [standalonePath, setStandalonePath] = createSignal('');
  const [standaloneSuggestions, setStandaloneSuggestions] = createSignal<Array<{ name: string; path: string }>>([]);
  const [standaloneSuggestionsOpen, setStandaloneSuggestionsOpen] = createSignal(false);
  const [standaloneSuggestionIndex, setStandaloneSuggestionIndex] = createSignal(0);
  const [standaloneSuggestionsLoading, setStandaloneSuggestionsLoading] = createSignal(false);
  const [branchErrors, setBranchErrors] = createSignal<Record<string, string>>({});
  const [sessionBinding, setSessionBinding] = createSignal<SessionBindingInfo | null>(null);
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
  const activeDirectory = () => {
    const project = activeProject();
    if (!project) return undefined;
    const directoryId = sessionBinding()?.directoryId || selectedDirectoryId();
    return project.directories.find((directory) => directory.id === directoryId);
  };
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
  const [gitDirectoryId, setGitDirectoryId] = createSignal('');
  // null = whole session; a number filters the Changes tab to that turn.
  const [diffTurn, setDiffTurn] = createSignal<number | null>(null);

  createEffect(() => {
    const project = activeProject();
    if (!project) { setGitDirectoryId(''); return; }
    if (!project.directories.some((directory) => directory.id === gitDirectoryId())) {
      setGitDirectoryId(activeDirectory()?.id || project.directories[0]?.id || '');
    }
  });

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
  let standaloneSuggestionsRef: HTMLDivElement | undefined;
  let standaloneSuggestionTimer: number | undefined;
  let standaloneSuggestionController: AbortController | undefined;

  const loadStandaloneSuggestions = async (value: string, open = true) => {
    standaloneSuggestionController?.abort();
    const controller = new AbortController();
    standaloneSuggestionController = controller;
    setStandaloneSuggestionsLoading(true);
    try {
      const data = await listDirectories(value, controller.signal);
      if (controller.signal.aborted) return;
      setStandaloneSuggestions(data.directories || []);
      setStandaloneSuggestionIndex(0);
      if (!value.trim() && data.currentPath) setStandalonePath(data.currentPath);
      if (open) setStandaloneSuggestionsOpen(true);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setStandaloneSuggestions([]);
    } finally {
      if (!controller.signal.aborted) setStandaloneSuggestionsLoading(false);
    }
  };

  const scheduleStandaloneSuggestions = (value: string) => {
    if (standaloneSuggestionTimer) window.clearTimeout(standaloneSuggestionTimer);
    setStandaloneSuggestionIndex(0);
    standaloneSuggestionTimer = window.setTimeout(() => void loadStandaloneSuggestions(value), 180);
  };

  const selectStandaloneSuggestion = (suggestion: { path: string } | undefined) => {
    if (!suggestion) return;
    setStandalonePath(suggestion.path);
    // Keep browsing from the selected folder so users can drill down without
    // repeatedly reopening the picker.
    void loadStandaloneSuggestions(suggestion.path);
  };

  const handleStandaloneDirectoryKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!standaloneSuggestionsOpen()) {
        void loadStandaloneSuggestions(standalonePath());
        return;
      }
      const count = standaloneSuggestions().length;
      if (count) {
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        setStandaloneSuggestionIndex((index) => (index + direction + count) % count);
      }
    } else if (event.key === 'Enter' && standaloneSuggestionsOpen() && standaloneSuggestions().length) {
      event.preventDefault();
      selectStandaloneSuggestion(standaloneSuggestions()[standaloneSuggestionIndex()]);
    } else if (event.key === 'Escape' && standaloneSuggestionsOpen()) {
      event.preventDefault();
      setStandaloneSuggestionsOpen(false);
    }
  };

  createEffect(() => {
    standaloneSuggestionIndex();
    if (!standaloneSuggestionsOpen()) return;
    queueMicrotask(() => standaloneSuggestionsRef?.querySelector('.highlighted')?.scrollIntoView({ block: 'nearest' }));
  });

  // Session id promised by the /api/chat response but not yet committed as
  // active. The HTTP response is the single authoritative source of the id;
  // SSE events for an uncommitted session are buffered until it commits.
  let pendingSessionId: string | null = null;
  // True from submitting a prompt with no active session until that session
  // commits (or the request fails). Buffering is gated on it so an idle
  // new-chat screen doesn't accumulate events from unrelated sessions.
  const pendingSessionEvents = new PendingSessionEvents<SessionScopedEvent>();
  // Guards fetchHistory against stale responses when switching sessions fast.
  let historyRequestSeq = 0;
  const historyEventBuffer = new SessionEventBuffer<any>();

  const fetchProjects = () => {
    listProjects().then((list) => {
      setProjects(list);
      // No Project is a first-class choice; never replace it implicitly with
      // the first configured project.
    });
  };

  let messagesAreaRef: HTMLDivElement | undefined;
  let messagesEndRef: HTMLDivElement | undefined;
  let disconnectSessionStream: (() => void) | undefined;
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
    void loadStandaloneSuggestions('', false);
  });

  // Project list drives the "Select a Project" dropdown for new chats.
  // Refetch on mount and whenever projects are added/removed elsewhere
  // (the sidebar's Add Project modal), so the dropdown never shows a stale
  // snapshot that's missing a freshly created project.
  createEffect(() => {
    void props.projectRefreshTrigger; // track
    fetchProjects();
  });

  // Group-level + actions can open a No Project draft at a specific
  // standalone directory. Use an incrementing request id so choosing the same
  // group repeatedly still resets the new-session form.
  createEffect(() => {
    const request = props.newSessionRequest;
    if (!request?.id || props.activeSessionId) return;
    setUseWorktree(false);
    setSelectedDirectoryId('');
    if (request.standalonePath) setStandalonePath(request.standalonePath);
  });

  // Keep the new-chat directory selection valid when the user switches
  // projects from the sidebar or project dropdown.
  createEffect(() => {
    if (props.activeSessionId) return;
    const project = activeProject();
    if (!project) {
      setSelectedDirectoryId('');
      return;
    }
    if (!project.directories.some((directory) => directory.id === selectedDirectoryId())) {
      setSelectedDirectoryId(project.directories[0]?.id || '');
    }
  });

  // Worktree mode is project-wide: discover a base branch independently for
  // every repository. Creation remains disabled if any root is not Git-ready.
  let branchRequest = 0;
  createEffect(() => {
    const projectId = props.activeProjectId;
    const sessionId = props.activeSessionId;
    const project = activeProject();
    if (sessionId || !projectId || !project) {
      setBranchesByDirectory({});
      setSelectedBaseBranches({});
      setBranchErrors({});
      return;
    }
    const request = ++branchRequest;
    setBranchErrors({});
    void Promise.all(project.directories.map(async (directory) => {
      try {
        const branches = await listBranches(projectId, directory.id);
        return { directory, branches };
      } catch (error) {
        return { directory, branches: [] as GitBranchOption[], error: error instanceof Error ? error.message : 'Git branches unavailable' };
      }
    })).then((results) => {
      if (request !== branchRequest) return;
      const nextBranches: Record<string, GitBranchOption[]> = {};
      const nextSelected: Record<string, string> = {};
      const nextErrors: Record<string, string> = {};
      for (const result of results) {
        nextBranches[result.directory.id] = result.branches;
        const previous = selectedBaseBranches()[result.directory.id];
        const current = result.branches.find((branch) => branch.current);
        nextSelected[result.directory.id] = result.branches.some((branch) => branch.name === previous)
          ? previous
          : (current?.name || result.branches[0]?.name || '');
        if (result.error || !nextSelected[result.directory.id]) nextErrors[result.directory.id] = result.error || 'No Git branches found';
      }
      setBranchesByDirectory(nextBranches);
      setSelectedBaseBranches(nextSelected);
      setBranchErrors(nextErrors);
      if (Object.keys(nextErrors).length) setUseWorktree(false);
    });
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
      for (const event of pendingSessionEvents.commit(id)) dispatchSessionEvent(event);
      return;
    }
    pendingSessionId = null;
    pendingSessionEvents.cancel();
    setNewSessionProcessing(false);
    setMessages([]);
    setPinnedToBottom(true); // fresh session — follow from the bottom
    setContextInfo(null);
    setSessionBinding(null);
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
      setCommandsList(await listCommands());
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
      const data = await getSession(sessionId);
      if (seq !== historyRequestSeq) return;
      setMessages(mapHistoryToMessages(data.messages || []));
      setContextInfo(data.context || null);
      setSessionBinding(data.binding || null);
      if (data.binding?.directoryId) setSelectedDirectoryId(data.binding.directoryId);
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
    disconnectSessionStream?.();
    if (standaloneSuggestionTimer) window.clearTimeout(standaloneSuggestionTimer);
    standaloneSuggestionController?.abort();
  });

  const connectSSE = () => {
    disconnectSessionStream = connectSessionStream({
      onConnectionChange: setIsConnected,
      onReconnect: () => void fetchHistory(),
      onEvent: (event) => {
        trackSessionEvent(event);
        handleSessionEvent(event);
      },
    });
  };

  const applyEvent = (event: any) => {
    // message_end / agent_end / compaction_end events carry a fresh
    // context-window snapshot (see server/runtime/index.ts).
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
      } else if (pendingSessionEvents.capture(event)) {
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
      id: createId(),
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
      await respondToUi(answeredSession, response);
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
      id: createId(),
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
      pendingSessionEvents.begin();
      setNewSessionProcessing(true);
    }
    const stopBuffering = () => {
      if (isNewSession) {
        pendingSessionEvents.cancel();
        setNewSessionProcessing(false);
      }
    };

    try {
      const data = await sendChat({
          prompt: promptText,
          // The typed message only — mentions live here, not in the appended
          // file attachments the server must not scan.
          mentionText: userMessage,
          sessionId: props.activeSessionId,
          projectId: props.activeProjectId,
          directoryId: selectedDirectoryId() || undefined,
          standalonePath: props.activeProjectId ? undefined : standalonePath().trim() || undefined,
          modelId: selectedModel() || undefined,
          thinkingLevel: selectedThinkingLevel(),
          images: images.length ? images : undefined,
          useWorktree: isNewSession && useWorktree(),
          baseBranches: isNewSession && useWorktree() ? selectedBaseBranches() : undefined,
      });
      if (data.sessionId && data.sessionId !== props.activeSessionId) {
        // The session-switch effect replays the buffer and clears the flag.
        // Fall back to the locally selected project if the server couldn't
        // resolve one, so the sidebar draft still lands in the right group.
        pendingSessionId = data.sessionId;
        props.onSessionCreated(
          data.sessionId,
          data.projectId ?? props.activeProjectId,
          userMessage.slice(0, 200),
          { directoryId: data.directoryId, branch: data.branch, worktree: data.worktree },
        );
      } else {
        stopBuffering();
      }
    } catch (err) {
      stopBuffering();
      console.error('Failed to send message:', err);
      setMessages(messages.length, {
        id: createId(),
        role: 'assistant',
        content: '',
        errorMessage: err instanceof Error ? err.message : 'Failed to connect to server',
      });
    }
  };

  const handleStop = async () => {
    if (!props.activeSessionId) return;
    try {
      await abortSession(props.activeSessionId);
    } catch (err) {
      console.error('Failed to abort:', err);
    }
  };

  const handleWorktreeRestore = async () => {
    const sessionId = props.activeSessionId;
    if (!sessionId || !sessionBinding()?.worktreeMissing) return;
    try {
      await recreateWorktree(sessionId);
      setSessionBinding((binding) => binding ? { ...binding, worktreeMissing: false } : binding);
      props.onTurnComplete?.();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to restore worktree');
    }
  };

  const handleWorktreeRemove = async () => {
    const sessionId = props.activeSessionId;
    if (!sessionId || !sessionBinding()?.worktree || sessionBinding()?.worktreeMissing) return;
    if (!confirm(`Remove the worktree for ${sessionBinding()?.branch || 'this session'}?\n\nThe chat history and branch will be kept.`)) return;
    try {
      try {
        await removeWorktree(sessionId);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 409 || error.details.code !== 'unmerged') throw error;
        if (!confirm(`This branch is not merged into its base branch.\n\nRemove the clean worktree anyway?`)) return;
        await removeWorktree(sessionId, true);
      }
      // Removing a checkout does not remove the chat. Keep the session open in
      // detached/read-only mode and expose Restore worktree in the session bar.
      setSessionBinding((binding) => binding ? { ...binding, worktreeMissing: true } : binding);
      props.onTurnComplete?.();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to remove worktree');
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
        <ChatHeader
          title={activeSessionTitle()}
          project={activeProject()}
          connected={isConnected()}
          panelOpen={panelOpen()}
          onOpenTab={openPanelTab}
          onTogglePanel={togglePanel}
        />
      </Show>

      <MessageTimeline
        messages={messages}
        processing={isProcessing()}
        onScroll={handleScroll}
        onImageClick={setLightboxUrl}
        turnChipFor={turnChipFor}
        onOpenTurn={(turn) => openChangesPanel(turn)}
        areaRef={(element) => { messagesAreaRef = element; }}
        endRef={(element) => { messagesEndRef = element; }}
      />

      <div class="input-wrapper">
        <ExtensionUiHost widgets={widgets()} statuses={statusEntries} uiRequest={uiRequest()} questionsRequest={questionsRequest()} onRespond={handleUiRespond}>
          <Show when={messages.length === 0}>
            <NewChatSetup
              activeProjectId={props.activeProjectId} activeProject={activeProject()} projects={projects()} selectedDirectoryId={selectedDirectoryId()}
              standalonePath={standalonePath()} suggestions={standaloneSuggestions()} suggestionsOpen={standaloneSuggestionsOpen()}
              suggestionIndex={standaloneSuggestionIndex()} suggestionsLoading={standaloneSuggestionsLoading()} useWorktree={useWorktree()}
              branches={branchesByDirectory()} selectedBranches={selectedBaseBranches()} branchErrors={branchErrors()}
              onSelectProject={(projectId) => { setUseWorktree(false); const project = projects().find((entry) => entry.id === projectId); setSelectedDirectoryId(project?.directories[0]?.id || ''); props.onSelectProject?.(projectId); }}
              onSelectDirectory={(value) => { setUseWorktree(false); setSelectedDirectoryId(value); }}
              onStandaloneInput={(value) => { setStandalonePath(value); scheduleStandaloneSuggestions(value); }}
              onStandaloneFocus={() => void loadStandaloneSuggestions(standalonePath())} onStandaloneKeyDown={handleStandaloneDirectoryKeyDown}
              onStandaloneBlur={() => window.setTimeout(() => setStandaloneSuggestionsOpen(false), 140)} onSelectSuggestion={selectStandaloneSuggestion}
              onSuggestionIndex={setStandaloneSuggestionIndex} onSuggestionsRef={(element) => { standaloneSuggestionsRef = element; }}
              onUseWorktree={setUseWorktree} onSelectBranch={(directoryId, branch) => setSelectedBaseBranches((previous) => ({ ...previous, [directoryId]: branch }))}
            />
          </Show>
          <Show when={props.activeSessionId}><SessionBar project={activeProject()} binding={sessionBinding()} diff={diffs().session}
            onRestore={() => void handleWorktreeRestore()} onRemove={() => void handleWorktreeRemove()} onOpenChanges={() => openChangesPanel()}/></Show>
          <Composer
            isConnected={isConnected()} isProcessing={isProcessing()} disabled={!!uiRequest() || !!questionsRequest() || !!sessionBinding()?.worktreeMissing}
            commands={commandsList()} projectId={props.activeProjectId} directoryId={activeDirectory()?.id} sessionId={props.activeSessionId}
            draftKey={chatDraftKey()} draftText={getChatDraft(chatDraftKey())} onDraftChange={(text) => setChatDraft(chatDraftKey(), text)}
            models={models()} selectedModel={selectedModel()} onSelectModel={selectModel} thinkingLevels={thinkingLevelOptions()}
            selectedThinkingLevel={selectedThinkingLevel()} onSelectThinkingLevel={selectThinkingLevel} contextInfo={contextInfo()}
            onSubmit={handleSubmit} onStop={handleStop} api={(api) => { composerApi = api; }}
          />
        </ExtensionUiHost>
      </div>
    </div>

    <ChatRightPanel
      open={panelOpen()} tab={panelTab()} connected={isConnected()} project={activeProject()} projectId={props.activeProjectId}
      sessionId={props.activeSessionId} directoryId={activeDirectory()?.id || sessionBinding()?.directoryId} gitDirectoryId={gitDirectoryId()}
      gitRefreshTrigger={gitRefreshTrigger()} diff={diffTurn() != null ? (diffs().turns.get(diffTurn()!) ?? emptyDiffSummary()) : diffs().session}
      turnFilter={diffTurn()} onSelectTab={selectPanelTab} onClose={closePanel} onResize={startPanelResize}
      onGitDirectory={setGitDirectoryId} onClearTurn={() => setDiffTurn(null)}
    />
    </div>
  );
}
