import { For, type JSX } from 'solid-js';
import './RightPanel.css';

export interface PanelTab {
  id: string;
  label: string;
}

// Generic right-hand side panel with a tab strip. The Changes tab is the
// first occupant; future inspectors (files, terminal, tasks, ...) register
// as additional tabs and render their content as children keyed off
// activeTab in the parent.
export default function RightPanel(props: {
  tabs: PanelTab[];
  activeTab: string;
  onSelectTab: (id: string) => void;
  onClose: () => void;
  children: JSX.Element;
}) {
  return (
    <aside class="right-panel">
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
                {tab.label}
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
