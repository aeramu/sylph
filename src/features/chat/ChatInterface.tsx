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
import AddSessionFolderModal from './components/AddSessionFolderModal';
import StartingFolderModal from './components/StartingFolderModal';
import type { UiRequest } from './UiRequestModal';
import type { QuestionsRequest } from './QuestionsModal';
import type { PanelTabId } from '../../shared/ui/RightPanel';
import { startPointerResize } from '../../lib/resize';
import { createModelPreferences } from '../../lib/modelPreferences';
import { getRightPanelState, setRightPanelState } from '../../lib/rightPanelState';
import { createId } from '../../lib/id';
import { ApiError } from '../../lib/api';
import {
  abortSession, acknowledgeArtifact, listCommands, listProjects, recreateWorktree,
  removeWorktree, respondToUi, sendChat, type SessionBindingInfo,
} from './api';
import { connectSessionStream, PendingSessionEvents, type SessionScopedEvent } from './createSessionStream';
import { createNewChatSetup } from './createNewChatSetup';
import { createChatSession } from './createChatSession';
import { prepareChatSubmission } from './createChatSubmission';
import { ChatHistoryController } from './createChatHistory';

export default function ChatInterface(props: { activeSessionId?: string, activeProjectId?: string, onSelectProject?: (id?: string) => void, newSessionRequest?: { id: number; standalonePath?: string }, onSessionCreated: (id: string, projectId?: string, firstMessage?: string, meta?: { workspaceKind?: 'directories' | 'scratch'; directoryId?: string; branch?: string; worktree?: boolean }) => void, onTurnComplete?: () => void, onSessionRemoved?: (id: string) => void, projectRefreshTrigger?: number }) {
  const [messages, setMessages] = createStore<ChatMessage[]>([]);
  const chatSession = createChatSession({ sessionId: () => props.activeSessionId, projectId: () => props.activeProjectId, messages });
  const { setNewSessionProcessing, isProcessing, draftKey: chatDraftKey, title: activeSessionTitle } = chatSession;
  const [isConnected, setIsConnected] = createSignal(false);
  const [lightboxUrl, setLightboxUrl] = createSignal<string | null>(null);
  const [commandsList, setCommandsList] = createSignal<CommandInfo[]>([]);
  const [projects, setProjects] = createSignal<ProjectInfo[]>([]);
  const [sessionBinding, setSessionBinding] = createSignal<SessionBindingInfo | null>(null);
  const [showAddFolder, setShowAddFolder] = createSignal(false);
  const [showStartingFolder, setShowStartingFolder] = createSignal(false);
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
  const configuredProject = () => projects().find((p) => p.id === props.activeProjectId);
  const activeProject = (): ProjectInfo | undefined => {
    const project = configuredProject();
    const directories = sessionBinding()?.directories;
    if (!props.activeSessionId || sessionBinding()?.workspaceKind === 'scratch' || !directories?.length) return project;
    const active = directories.find((directory) => directory.directoryId === sessionBinding()?.directoryId) ?? directories[0];
    return {
      id: project?.id ?? `session:${props.activeSessionId}`,
      name: project?.name ?? 'Session workspace',
      path: active.path,
      directories: directories.map((directory) => ({ id: directory.directoryId, name: directory.name, path: directory.path })),
    };
  };
  const newChatSetup = createNewChatSetup({ project: activeProject, projectId: () => props.activeProjectId, sessionId: () => props.activeSessionId });
  const {
    branches: branchesByDirectory, selectedBranches: selectedBaseBranches, useWorktree, directoryId: selectedDirectoryId,
    standalonePath, branchErrors,
    setUseWorktree, setDirectoryId: setSelectedDirectoryId, setStandalonePath, selectBranch: selectBaseBranch,
  } = newChatSetup;
  const activeDirectory = () => {
    const project = activeProject();
    if (!project) return undefined;
    const directoryId = sessionBinding()?.directoryId || selectedDirectoryId();
    return project.directories.find((directory) => directory.id === directoryId);
  };
  // Context-window usage for the active session (drives the composer's
  // context indicator). Seeded by /api/sessions/:sessionId, refreshed by SSE events.
  const [contextInfo, setContextInfo] = createSignal<ContextInfo | null>(null);

  // Right side panel (tabbed; the Changes tab shows session/turn file diffs).
  const [panelOpen, setPanelOpen] = createSignal(false);
  const [panelTab, setPanelTab] = createSignal<PanelTabId>('changes');
  const [panelWidth, setPanelWidth] = createSignal(420);
  const [gitRefreshTrigger, setGitRefreshTrigger] = createSignal(0);
  const [artifactRefreshTrigger, setArtifactRefreshTrigger] = createSignal(0);
  const [requestedArtifactPath, setRequestedArtifactPath] = createSignal<string>();
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

  // Session id promised by the /api/chat response but not yet committed as
  // active. The HTTP response is the single authoritative source of the id;
  // SSE events for an uncommitted session are buffered until it commits.
  let pendingSessionId: string | null = null;
  // True from submitting a prompt with no active session until that session
  // commits (or the request fails). Buffering is gated on it so an idle
  // new-chat screen doesn't accumulate events from unrelated sessions.
  const pendingSessionEvents = new PendingSessionEvents<SessionScopedEvent>();
  const chatHistory = new ChatHistoryController<any>();
  const handledArtifactRequests = new Set<string>();

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
    setShowAddFolder(false);
    setShowStartingFolder(false);
    setUiRequest(null);
    setQuestionsRequest(null);
    setRequestedArtifactPath(undefined);
    setArtifactRefreshTrigger((value) => value + 1);
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
    if (!props.activeSessionId) {
      chatHistory.cancel();
      setMessages([]);
      setUiRequest(null);
      setQuestionsRequest(null);
      return;
    }
    const sessionId = props.activeSessionId;
    try {
      const loaded = await chatHistory.load(sessionId);
      if (!loaded) return;
      const { snapshot: data, events } = loaded;
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
      // A show_artifact event emitted while another session was active was
      // intentionally dropped by the live session gate. The server keeps the
      // latest request until this snapshot opens it and acknowledges its id.
      if (data.pendingArtifactRequest?.id && data.pendingArtifactRequest.path) {
        showArtifactRequest(sessionId, data.pendingArtifactRequest);
      }
      for (const event of events) dispatchSessionEvent(event);
    } catch (err) {
      console.error('Failed to load history:', err);
    }
  };

  onCleanup(() => {
    disconnectSessionStream?.();
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
      onTurnComplete: () => {
        setArtifactRefreshTrigger((value) => value + 1);
        props.onTurnComplete?.();
      },
      onSuccessfulFileMutation: () => {
        setGitRefreshTrigger((value) => value + 1);
        setArtifactRefreshTrigger((value) => value + 1);
      },
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
        if (chatHistory.capture(event)) return;
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

  const showArtifactRequest = (sessionId: string, request: { id?: string; path: string }) => {
    // The session snapshot and a buffered live event can contain the same
    // request. Present and acknowledge each id only once.
    if (request.id && handledArtifactRequests.has(request.id)) return;
    if (request.id) handledArtifactRequests.add(request.id);
    setRequestedArtifactPath(request.path);
    setArtifactRefreshTrigger((value) => value + 1);
    openPanelTab('artifacts');
    if (request.id) {
      void acknowledgeArtifact(sessionId, request.id).catch((error) => {
        // The presentation already succeeded, so acknowledgement failure must
        // not close the panel. Allow a later snapshot to retry the ack.
        handledArtifactRequests.delete(request.id!);
        console.warn('Failed to acknowledge artifact presentation:', error);
      });
    }
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
      case 'showArtifact':
        if (props.activeSessionId && typeof data.path === 'string' && data.path) {
          showArtifactRequest(props.activeSessionId, data);
        }
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
    const prepared = prepareChatSubmission(userMessage, pendingAttachments);
    setMessages(messages.length, {
      id: createId(),
      role: 'user',
      content: userMessage,
      images: prepared.messageImages,
    });
    setPinnedToBottom(true); // user just sent — follow the reply

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
          prompt: prepared.prompt,
          // The typed message only — mentions live here, not in the appended
          // file attachments the server must not scan.
          mentionText: userMessage,
          sessionId: props.activeSessionId,
          projectId: props.activeProjectId,
          directoryId: selectedDirectoryId() || undefined,
          standalonePath: activeProject()?.directories.length ? undefined : standalonePath().trim() || undefined,
          modelId: selectedModel() || undefined,
          thinkingLevel: selectedThinkingLevel(),
          images: prepared.images,
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
          { workspaceKind: data.workspaceKind, directoryId: data.directoryId, branch: data.branch, worktree: data.worktree },
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
      <Show when={showStartingFolder() && !props.activeSessionId}><StartingFolderModal initialPath={standalonePath()}
        onClose={() => setShowStartingFolder(false)} onSelect={(folderPath) => { setStandalonePath(folderPath); setShowStartingFolder(false); requestAnimationFrame(() => composerApi?.focus()); }}
        onClear={() => { setStandalonePath(''); setShowStartingFolder(false); requestAnimationFrame(() => composerApi?.focus()); }}/></Show>
      <Show when={showAddFolder() && props.activeSessionId} keyed>{(sessionId) => <AddSessionFolderModal
        sessionId={sessionId} worktree={!!sessionBinding()?.worktree} onClose={() => setShowAddFolder(false)}
        onAttached={(binding) => {
          setSessionBinding(binding);
          setShowAddFolder(false);
          setGitRefreshTrigger((value) => value + 1);
          props.onTurnComplete?.();
          requestAnimationFrame(() => composerApi?.focus());
        }}/>}</Show>

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
              standalonePath={standalonePath()} useWorktree={useWorktree()}
              branches={branchesByDirectory()} selectedBranches={selectedBaseBranches()} branchErrors={branchErrors()}
              onSelectProject={(projectId) => { setUseWorktree(false); const project = projects().find((entry) => entry.id === projectId); setSelectedDirectoryId(project?.directories[0]?.id || ''); props.onSelectProject?.(projectId); }}
              onSelectDirectory={(value) => { setUseWorktree(false); setSelectedDirectoryId(value); }}
              onOpenStartingFolder={() => setShowStartingFolder(true)} onUseWorktree={setUseWorktree} onSelectBranch={selectBaseBranch}
            />
          </Show>
          <Show when={props.activeSessionId}><SessionBar project={activeProject()} binding={sessionBinding()} diff={diffs().session} canAddFolder={!isProcessing() && !uiRequest() && !questionsRequest()}
            onRestore={() => void handleWorktreeRestore()} onRemove={() => void handleWorktreeRemove()} onAddFolder={() => setShowAddFolder(true)} onOpenChanges={() => openChangesPanel()}/></Show>
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
      gitRefreshTrigger={gitRefreshTrigger()} artifactPath={requestedArtifactPath()} artifactRefreshTrigger={artifactRefreshTrigger()}
      diff={diffTurn() != null ? (diffs().turns.get(diffTurn()!) ?? emptyDiffSummary()) : diffs().session}
      turnFilter={diffTurn()} onSelectTab={selectPanelTab} onClose={closePanel} onResize={startPanelResize}
      onGitDirectory={setGitDirectoryId} onClearTurn={() => setDiffTurn(null)}
    />
    </div>
  );
}
