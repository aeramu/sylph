import { lazy, Show, Suspense } from 'solid-js';
import type { ProjectInfo } from '../../../types';
import type { DiffSummary } from '../../../lib/sessionDiff';
import CustomSelect from '../../../shared/ui/CustomSelect';
import RightPanel, { type PanelTabId } from '../../../shared/ui/RightPanel';
import type { ReviewCommentRequest } from '../../../shared/ui/ReviewCommentPopover';

const ArtifactsTab = lazy(() => import('../../artifacts/ArtifactsTab'));
const BrowserTab = lazy(() => import('../../browser/BrowserTab'));
const ChangesTab = lazy(() => import('../../changes/ChangesTab'));
const GitTab = lazy(() => import('../../git/GitTab'));

export default function ChatRightPanel(props: {
  open: boolean; tab: PanelTabId; connected: boolean; project?: ProjectInfo; projectId?: string; sessionId?: string;
  directoryId?: string; gitDirectoryId: string; gitRefreshTrigger: number; artifactPath?: string; artifactRefreshTrigger: number;
  diff: DiffSummary; turnFilter: number | null;
  onSelectTab: (tab: PanelTabId) => void; onClose: () => void; onResize: (event: PointerEvent) => void;
  onGitDirectory: (id: string) => void; onClearTurn: () => void; onComment: (request: ReviewCommentRequest) => void;
}) {
  return <>
    <Show when={props.open}><div class="right-panel-overlay" onClick={props.onClose}/><div class="right-panel-resize-handle" onPointerDown={props.onResize} title="Resize right sidebar" aria-label="Resize right sidebar"/></Show>
    <RightPanel class={props.open ? 'panel-open' : ''} tabs={[{ id: 'server', label: 'Server' }, { id: 'browser', label: 'Browser' }, { id: 'artifacts', label: 'Artifacts' }, { id: 'changes', label: 'Changes' }, { id: 'git', label: 'Git' }]}
      activeTab={props.tab} onSelectTab={props.onSelectTab} onClose={props.onClose}>
      <Show when={props.open && props.tab === 'browser'}><Suspense><BrowserTab/></Suspense></Show>
      <Show when={props.open && props.tab === 'artifacts'}><Suspense><ArtifactsTab sessionId={props.sessionId} requestedPath={props.artifactPath} refreshTrigger={props.artifactRefreshTrigger} onComment={props.onComment}/></Suspense></Show>
      <Show when={props.open && props.tab === 'changes'}><Suspense><ChangesTab diff={props.diff} turnFilter={props.turnFilter} onClearFilter={props.onClearTurn}/></Suspense></Show>
      <Show when={props.open && props.tab === 'git'}><Suspense>
        <Show when={props.project && props.project.directories.length > 0} fallback={<div class="git-empty">Add a folder to use Git.</div>}>
        <Show when={props.project && props.project.directories.length > 1}><div class="git-root-selector"><span>Repository</span>
          <CustomSelect value={props.gitDirectoryId || props.project!.directories[0]?.id || ''} onChange={props.onGitDirectory}
            options={props.project!.directories.map((directory) => ({ value: directory.id, label: directory.name, icon: 'folder' }))} placeholder="Select repository" position="bottom"/>
        </div></Show>
        <GitTab projectId={props.projectId || (props.sessionId ? '__session__' : undefined)} directoryId={props.gitDirectoryId || props.directoryId} sessionId={props.sessionId} refreshTrigger={props.gitRefreshTrigger} onComment={props.onComment}/>
        </Show>
      </Suspense></Show>
      <Show when={props.open && props.tab === 'server'}><div class="server-status-panel"><div class="server-status-panel-card">
        <div class={`server-status-indicator ${props.connected ? 'connected' : 'disconnected'}`} title={props.connected ? 'Server connected' : 'Server disconnected'} aria-label={props.connected ? 'Server connected' : 'Server disconnected'}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><rect x="3" y="4" width="18" height="7"/><rect x="3" y="13" width="18" height="7"/><line x1="7" y1="7.5" x2="7.01" y2="7.5"/><line x1="7" y1="16.5" x2="7.01" y2="16.5"/></svg><span class="server-status-dot"/>
        </div><div><div class="server-status-panel-title">Server</div><div class={`server-status-panel-value ${props.connected ? 'connected' : 'disconnected'}`}>{props.connected ? 'Connected' : 'Disconnected'}</div></div>
      </div></div></Show>
    </RightPanel>
  </>;
}
