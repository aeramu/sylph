import { createResource, createSignal, For, Show } from 'solid-js';
import type { ResourceInfo } from '../types';
import { renderMarkdown } from '../lib/markdown';

type SettingsSection = 'skills' | 'extensions';

interface SkillDetail {
  name: string;
  description?: string;
  content: string;
  path: string;
}

const fetchResources = async () => {
  const res = await fetch('/api/resources');
  if (!res.ok) return [];
  const data = await res.json();
  return (data.resources || []) as ResourceInfo[];
};

const fetchSkillDetail = async (name: string) => {
  const res = await fetch(`/api/resources/skills/${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error('Failed to load skill');
  return await res.json() as SkillDetail;
};

const stripFrontmatter = (content: string) =>
  content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');

export default function SettingsModal(props: { onClose: () => void }) {
  const [activeSection, setActiveSection] = createSignal<SettingsSection>('skills');
  const [selectedSkill, setSelectedSkill] = createSignal<string | null>(null);
  const [resources] = createResource(fetchResources);
  const [skillDetail] = createResource(selectedSkill, fetchSkillDetail);

  const filteredResources = () => {
    const kind = activeSection() === 'skills' ? 'skill' : 'extension';
    return (resources() || []).filter((resource) => resource.source === kind);
  };

  const sectionTitle = () => activeSection() === 'skills' ? 'Skills' : 'Extensions';
  const emptyLabel = () => activeSection() === 'skills' ? 'skills' : 'extensions';

  return (
    <div class="settings-modal-overlay" onClick={props.onClose}>
      <div class="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div class="settings-modal-sidebar">
          <div class="settings-modal-title">Settings</div>
          <button
            class={`settings-menu-item ${activeSection() === 'skills' ? 'active' : ''}`}
            onClick={() => {
              setActiveSection('skills');
              setSelectedSkill(null);
            }}
          >
            <span>🤹</span>
            <span>Skills</span>
          </button>
          <button
            class={`settings-menu-item ${activeSection() === 'extensions' ? 'active' : ''}`}
            onClick={() => {
              setActiveSection('extensions');
              setSelectedSkill(null);
            }}
          >
            <span>🧩</span>
            <span>Extensions</span>
          </button>
        </div>

        <div class="settings-modal-content">
          <div class="settings-modal-header">
            <div class="settings-section-heading">
              <Show when={activeSection() === 'skills' && selectedSkill()}>
                <button class="settings-back-button" onClick={() => setSelectedSkill(null)}>← Skills</button>
              </Show>
              <h2 class="settings-section-title">{selectedSkill() || sectionTitle()}</h2>
            </div>
            <button onClick={props.onClose} class="settings-modal-close">✕</button>
          </div>
          <div class="settings-modal-body">
            <Show
              when={!(activeSection() === 'skills' && selectedSkill())}
              fallback={
                <Show when={!skillDetail.loading} fallback={<div class="settings-modal-empty">Loading skill...</div>}>
                  <Show when={skillDetail()} keyed fallback={<div class="settings-modal-empty">Unable to load skill.</div>}>
                    {(detail) => (
                      <div class="settings-skill-detail">
                        <div class="settings-skill-meta">
                          <div class="settings-skill-meta-row">
                            <span class="settings-skill-meta-label">Name</span>
                            <span class="settings-skill-meta-value">{detail.name}</span>
                          </div>
                          <Show when={detail.description}>
                            <div class="settings-skill-meta-row">
                              <span class="settings-skill-meta-label">Description</span>
                              <span class="settings-skill-meta-value">{detail.description}</span>
                            </div>
                          </Show>
                          <div class="settings-skill-meta-row">
                            <span class="settings-skill-meta-label">Path</span>
                            <span class="settings-skill-meta-value path">{detail.path}</span>
                          </div>
                        </div>
                        <div class="settings-skill-detail-content message-content" innerHTML={renderMarkdown(stripFrontmatter(detail.content))} />
                      </div>
                    )}
                  </Show>
                </Show>
              }
            >
              <Show when={!resources.loading} fallback={<div class="settings-modal-empty">Loading...</div>}>
                <Show
                  when={filteredResources().length > 0}
                  fallback={<div class="settings-modal-empty">No {emptyLabel()} loaded.</div>}
                >
                  <div class="settings-resource-list">
                    <For each={filteredResources()}>
                      {(resource) => (
                        <button
                          class={`settings-resource-card ${resource.source === 'skill' ? 'clickable' : ''}`}
                          type="button"
                          onClick={() => {
                            if (resource.source === 'skill') {
                              setSelectedSkill(resource.name);
                            }
                          }}
                        >
                          <div class="settings-resource-card-header">
                            <span class="settings-resource-card-name">{resource.name}</span>
                            <span class="settings-resource-card-source">{resource.source}</span>
                          </div>
                          <Show when={resource.description}>
                            <div class="settings-resource-card-desc">{resource.description}</div>
                          </Show>
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </Show>
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
}
