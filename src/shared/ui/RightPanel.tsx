import { For, type JSX } from 'solid-js';
import './RightPanel.css';

export type PanelTabId = 'server' | 'browser' | 'changes' | 'git';

export interface PanelTab {
  id: PanelTabId;
  label: string;
}

function PanelTabIcon(props: { id: PanelTabId }) {
  if (props.id === 'server') {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="7"></rect>
        <rect x="3" y="13" width="18" height="7"></rect>
        <line x1="7" y1="7.5" x2="7.01" y2="7.5"></line>
        <line x1="7" y1="16.5" x2="7.01" y2="16.5"></line>
      </svg>
    );
  }

  if (props.id === 'browser') {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2"></rect>
        <line x1="3" y1="9" x2="21" y2="9"></line>
        <circle cx="6.5" cy="6.5" r="0.5" fill="currentColor" stroke="none"></circle>
        <circle cx="9" cy="6.5" r="0.5" fill="currentColor" stroke="none"></circle>
      </svg>
    );
  }

  if (props.id === 'changes') {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="8" y1="13" x2="14" y2="13"></line>
        <line x1="11" y1="10" x2="11" y2="16"></line>
        <line x1="8" y1="18" x2="14" y2="18"></line>
      </svg>
    );
  }

  if (props.id === 'git') {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="18" cy="18" r="3"></circle>
        <circle cx="6" cy="6" r="3"></circle>
        <circle cx="6" cy="18" r="3"></circle>
        <path d="M6 9v6"></path>
        <path d="M8.5 7.5 15.5 16.5"></path>
      </svg>
    );
  }

  return null;
}

// Generic right-hand side panel with a tab strip. The Changes tab is the
// first occupant; future inspectors (files, terminal, tasks, ...) register
// as additional tabs and render their content as children keyed off
// activeTab in the parent.
export default function RightPanel(props: {
  tabs: PanelTab[];
  activeTab: PanelTabId;
  onSelectTab: (id: PanelTabId) => void;
  onClose: () => void;
  class?: string;
  children: JSX.Element;
}) {
  return (
    <aside
      class={`right-panel ${props.class ?? ''}`}
      aria-hidden={props.class?.includes('panel-open') ? 'false' : 'true'}
    >
      <div class="right-panel-header">
        <div class="right-panel-tabs" role="tablist">
          <For each={props.tabs}>
            {(tab) => (
              <button
                class={`right-panel-tab ${props.activeTab === tab.id ? 'active' : ''}`}
                role="tab"
                aria-selected={props.activeTab === tab.id}
                onClick={() => props.onSelectTab(tab.id)}
              >
                <PanelTabIcon id={tab.id} />
                <span>{tab.label}</span>
              </button>
            )}
          </For>
        </div>
        <button class="right-panel-close" onClick={props.onClose} title="Close panel" aria-label="Close panel">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div class="right-panel-body">{props.children}</div>
    </aside>
  );
}
