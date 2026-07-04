import { For } from 'solid-js';
import type { ResourceInfo } from '../types';

// Modal listing loaded skills or extensions.
export default function ResourcesModal(props: {
  kind: 'skill' | 'extension';
  resources: ResourceInfo[];
  onClose: () => void;
}) {
  const filtered = () => props.resources.filter(r => r.source === props.kind);
  return (
    <div class="skills-modal-overlay">
      <div class="skills-modal">
        <div class="skills-modal-header">
          <h2 class="skills-modal-title">
            {props.kind === 'skill' ? 'Skills' : 'Extensions'}
          </h2>
          <button onClick={props.onClose} class="skills-modal-close">✕</button>
        </div>
        <div class="skills-modal-body">
          {filtered().length === 0 ? (
            <div class="skills-modal-empty">No {props.kind}s loaded.</div>
          ) : (
            <div class="skills-list">
              <For each={filtered()}>
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
  );
}
