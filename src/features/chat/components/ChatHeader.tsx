import { Show } from 'solid-js';
import type { ProjectInfo } from '../../../types';
import type { PanelTabId } from '../../../shared/ui/RightPanel';

const tabs: Array<{ id: PanelTabId; label: string; icon: 'server' | 'browser' | 'changes' | 'git' }> = [
  { id: 'server', label: 'server status', icon: 'server' },
  { id: 'browser', label: 'agent browser', icon: 'browser' },
  { id: 'changes', label: 'changes', icon: 'changes' },
  { id: 'git', label: 'Git', icon: 'git' },
];

function TabIcon(props: { icon: 'server' | 'browser' | 'changes' | 'git' }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <Show when={props.icon === 'server'}><rect x="3" y="4" width="18" height="7"/><rect x="3" y="13" width="18" height="7"/><line x1="7" y1="7.5" x2="7.01" y2="7.5"/><line x1="7" y1="16.5" x2="7.01" y2="16.5"/></Show>
    <Show when={props.icon === 'browser'}><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/></Show>
    <Show when={props.icon === 'changes'}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="14" y2="13"/><line x1="11" y1="10" x2="11" y2="16"/></Show>
    <Show when={props.icon === 'git'}><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M6 9v6"/><path d="M8.5 7.5 15.5 16.5"/></Show>
  </svg>;
}

export default function ChatHeader(props: {
  title: string;
  project?: ProjectInfo;
  connected: boolean;
  panelOpen: boolean;
  onOpenTab: (tab: PanelTabId) => void;
  onTogglePanel: () => void;
}) {
  return <div class="chat-header">
    <h1 class="chat-header-title" title={props.title}>{props.title}</h1>
    <Show when={props.project} keyed>{(project) => <span class="chat-header-project" title={project.directories.map((directory) => directory.path).join('\n')}>{project.name}</span>}</Show>
    <Show when={!props.panelOpen}>
      <div class="chat-header-panel-tabs" aria-label="Right sidebar tabs">
        {tabs.map((tab) => <button class="chat-header-panel-tab" onClick={() => props.onOpenTab(tab.id)} title={`Open ${tab.label}`} aria-label={`Open ${tab.label}`}>
          <TabIcon icon={tab.icon}/>
          <Show when={tab.id === 'server'}><span class={`chat-header-panel-tab-dot ${props.connected ? 'connected' : 'disconnected'}`}/></Show>
        </button>)}
        <button class="chat-header-panel-tab" onClick={props.onTogglePanel} title="Open right sidebar" aria-label="Open right sidebar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="15" y1="4" x2="15" y2="20"/></svg>
        </button>
      </div>
    </Show>
  </div>;
}
