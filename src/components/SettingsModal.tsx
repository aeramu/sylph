import { createResource, createSignal, For, Show } from 'solid-js';
import type { ResourceInfo } from '../types';
import { renderMarkdown } from '../lib/markdown';
import CodeView from './CodeView';

type SettingsSection = 'skills' | 'extensions';

interface SkillDetail {
  name: string;
  description?: string;
  content: string;
  path: string;
}

interface ExtensionDetail {
  name: string;
  path: string;
  resolvedPath?: string;
  sourceInfo?: Record<string, unknown>;
  tools: Array<{
    name: string;
    label?: string;
    description?: string;
    promptSnippet?: string;
    promptGuidelines?: string[];
    parameters?: unknown;
  }>;
  commands: Array<{ name: string; description?: string }>;
  flags: Array<{ name: string; description?: string; type?: string; default?: unknown }>;
  shortcuts: Array<{ shortcut: string; description?: string }>;
  events: Array<{ name: string; count: number }>;
  messageRenderers: string[];
}

const fetchResources = async (kind: 'skills' | 'extensions') => {
  const res = await fetch(`/api/resources/${kind}`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.resources || []) as ResourceInfo[];
};

const fetchSkillDetail = async (name: string) => {
  const res = await fetch(`/api/resources/skills/${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error('Failed to load skill');
  return await res.json() as SkillDetail;
};

const fetchExtensionDetail = async (name: string) => {
  const res = await fetch(`/api/resources/extensions/${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error('Failed to load extension');
  return await res.json() as ExtensionDetail;
};

const stripFrontmatter = (content: string) =>
  content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');

export default function SettingsModal(props: { onClose: () => void }) {
  const [activeSection, setActiveSection] = createSignal<SettingsSection>('skills');
  const [selectedSkill, setSelectedSkill] = createSignal<string | null>(null);
  const [selectedExtension, setSelectedExtension] = createSignal<string | null>(null);
  const [skills] = createResource(() => fetchResources('skills'));
  const [extensions] = createResource(() => fetchResources('extensions'));
  const [skillDetail] = createResource(selectedSkill, fetchSkillDetail);
  const [extensionDetail] = createResource(selectedExtension, fetchExtensionDetail);

  const currentResources = () => activeSection() === 'skills' ? (skills() || []) : (extensions() || []);
  const currentResourcesLoading = () => activeSection() === 'skills' ? skills.loading : extensions.loading;

  const resourceKind = () => activeSection() === 'skills' ? 'skill' : 'extension';
  const sectionTitle = () => activeSection() === 'skills' ? 'Skills' : 'Extensions';
  const selectedTitle = () => selectedSkill() || selectedExtension() || sectionTitle();
  const emptyLabel = () => activeSection() === 'skills' ? 'skills' : 'extensions';
  const capabilityCount = (detail: ExtensionDetail) =>
    detail.tools.length + detail.commands.length + detail.flags.length + detail.shortcuts.length + detail.events.length + detail.messageRenderers.length;

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
              setSelectedExtension(null);
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
              setSelectedExtension(null);
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
              <Show when={activeSection() === 'extensions' && selectedExtension()}>
                <button class="settings-back-button" onClick={() => setSelectedExtension(null)}>← Extensions</button>
              </Show>
              <h2 class="settings-section-title">{selectedTitle()}</h2>
            </div>
            <button onClick={props.onClose} class="settings-modal-close">✕</button>
          </div>
          <div class="settings-modal-body">
            <Show
              when={!((activeSection() === 'skills' && selectedSkill()) || (activeSection() === 'extensions' && selectedExtension()))}
              fallback={
                <Show
                  when={activeSection() === 'skills'}
                  fallback={
                    <Show when={!extensionDetail.loading} fallback={<div class="settings-modal-empty">Loading extension...</div>}>
                      <Show when={extensionDetail()} keyed fallback={<div class="settings-modal-empty">Unable to load extension.</div>}>
                        {(detail) => (
                          <div class="settings-detail">
                            <div class="settings-skill-meta">
                              <div class="settings-skill-meta-row">
                                <span class="settings-skill-meta-label">Name</span>
                                <span class="settings-skill-meta-value">{detail.name}</span>
                              </div>
                              <div class="settings-skill-meta-row">
                                <span class="settings-skill-meta-label">Path</span>
                                <span class="settings-skill-meta-value path">{detail.path}</span>
                              </div>
                              <Show when={detail.resolvedPath && detail.resolvedPath !== detail.path}>
                                <div class="settings-skill-meta-row">
                                  <span class="settings-skill-meta-label">Resolved</span>
                                  <span class="settings-skill-meta-value path">{detail.resolvedPath}</span>
                                </div>
                              </Show>
                              <Show when={detail.sourceInfo?.scope}>
                                <div class="settings-skill-meta-row">
                                  <span class="settings-skill-meta-label">Scope</span>
                                  <span class="settings-skill-meta-value">{String(detail.sourceInfo?.scope)}</span>
                                </div>
                              </Show>
                            </div>

                            <div class="settings-extension-summary">
                              <div><strong>{detail.tools.length}</strong><span>Tools</span></div>
                              <div><strong>{detail.commands.length}</strong><span>Commands</span></div>
                              <div><strong>{detail.flags.length}</strong><span>Flags</span></div>
                              <div><strong>{detail.shortcuts.length}</strong><span>Shortcuts</span></div>
                              <div><strong>{detail.events.length}</strong><span>Events</span></div>
                              <div><strong>{detail.messageRenderers.length}</strong><span>Renderers</span></div>
                            </div>

                            <Show when={capabilityCount(detail) === 0}>
                              <div class="settings-modal-empty">This extension has no registered runtime capabilities.</div>
                            </Show>

                            <Show when={detail.tools.length > 0}>
                              <section class="settings-detail-section">
                                <h3>Tools</h3>
                                <For each={detail.tools}>
                                  {(tool) => (
                                    <div class="settings-capability-card">
                                      <div class="settings-capability-title">{tool.name}</div>
                                      <Show when={tool.label}><div class="settings-capability-subtitle">{tool.label}</div></Show>
                                      <Show when={tool.description}><p>{tool.description}</p></Show>
                                      <Show when={tool.promptSnippet}><p class="settings-capability-muted">Prompt: {tool.promptSnippet}</p></Show>
                                      <Show when={tool.promptGuidelines?.length}>
                                        <ul class="settings-capability-list">
                                          <For each={tool.promptGuidelines}>{(item) => <li>{item}</li>}</For>
                                        </ul>
                                      </Show>
                                      <Show when={tool.parameters}>
                                        <details class="settings-json-details">
                                          <summary>Parameters</summary>
                                          <CodeView
                                            code={JSON.stringify(tool.parameters, null, 2)}
                                            path={`${tool.name}-parameters.json`}
                                            class="settings-json-code"
                                          />
                                        </details>
                                      </Show>
                                    </div>
                                  )}
                                </For>
                              </section>
                            </Show>

                            <Show when={detail.commands.length > 0}>
                              <section class="settings-detail-section">
                                <h3>Commands</h3>
                                <For each={detail.commands}>
                                  {(command) => (
                                    <div class="settings-capability-card compact">
                                      <div class="settings-capability-title">/{command.name}</div>
                                      <Show when={command.description}><p>{command.description}</p></Show>
                                    </div>
                                  )}
                                </For>
                              </section>
                            </Show>

                            <Show when={detail.flags.length > 0}>
                              <section class="settings-detail-section">
                                <h3>Flags</h3>
                                <For each={detail.flags}>
                                  {(flag) => (
                                    <div class="settings-capability-card compact">
                                      <div class="settings-capability-title">--{flag.name}</div>
                                      <div class="settings-capability-muted">{flag.type}{flag.default !== undefined ? ` · default: ${String(flag.default)}` : ''}</div>
                                      <Show when={flag.description}><p>{flag.description}</p></Show>
                                    </div>
                                  )}
                                </For>
                              </section>
                            </Show>

                            <Show when={detail.shortcuts.length > 0}>
                              <section class="settings-detail-section">
                                <h3>Shortcuts</h3>
                                <For each={detail.shortcuts}>
                                  {(shortcut) => (
                                    <div class="settings-capability-card compact">
                                      <div class="settings-capability-title">{shortcut.shortcut}</div>
                                      <Show when={shortcut.description}><p>{shortcut.description}</p></Show>
                                    </div>
                                  )}
                                </For>
                              </section>
                            </Show>

                            <Show when={detail.events.length > 0}>
                              <section class="settings-detail-section">
                                <h3>Events</h3>
                                <div class="settings-chip-list">
                                  <For each={detail.events}>
                                    {(event) => <span class="settings-chip">{event.name}{event.count > 1 ? ` ×${event.count}` : ''}</span>}
                                  </For>
                                </div>
                              </section>
                            </Show>

                            <Show when={detail.messageRenderers.length > 0}>
                              <section class="settings-detail-section">
                                <h3>Message Renderers</h3>
                                <div class="settings-chip-list">
                                  <For each={detail.messageRenderers}>{(renderer) => <span class="settings-chip">{renderer}</span>}</For>
                                </div>
                              </section>
                            </Show>
                          </div>
                        )}
                      </Show>
                    </Show>
                  }
                >
                  <Show when={!skillDetail.loading} fallback={<div class="settings-modal-empty">Loading skill...</div>}>
                    <Show when={skillDetail()} keyed fallback={<div class="settings-modal-empty">Unable to load skill.</div>}>
                      {(detail) => (
                        <div class="settings-detail">
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
                </Show>
              }
            >
              <Show when={!currentResourcesLoading()} fallback={<div class="settings-modal-empty">Loading...</div>}>
                <Show
                  when={currentResources().length > 0}
                  fallback={<div class="settings-modal-empty">No {emptyLabel()} loaded.</div>}
                >
                  <div class="settings-resource-list">
                    <For each={currentResources()}>
                      {(resource) => (
                        <button
                          class="settings-resource-card clickable"
                          type="button"
                          onClick={() => {
                            if (resourceKind() === 'skill') {
                              setSelectedSkill(resource.name);
                              setSelectedExtension(null);
                            } else {
                              setSelectedExtension(resource.name);
                              setSelectedSkill(null);
                            }
                          }}
                        >
                          <div class="settings-resource-card-header">
                            <span class="settings-resource-card-name">{resource.name}</span>
                            <span class="settings-resource-card-source">{resourceKind()}</span>
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
