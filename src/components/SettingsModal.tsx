import { createResource, createSignal, For, onCleanup, Show } from 'solid-js';
import type { ResourceInfo } from '../types';
import { renderMarkdown } from '../lib/markdown';
import CodeView from './CodeView';
import './SettingsModal.css';

type SettingsSection = 'provider' | 'skills' | 'extensions';

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
  tools: Array<{ name: string; label?: string; description?: string; promptSnippet?: string; promptGuidelines?: string[]; parameters?: unknown }>;
  commands: Array<{ name: string; description?: string }>;
  flags: Array<{ name: string; description?: string; type?: string; default?: unknown }>;
  shortcuts: Array<{ shortcut: string; description?: string }>;
  events: Array<{ name: string; count: number }>;
  messageRenderers: string[];
}

interface ProviderInfo {
  id: string;
  name: string;
  authType: 'api_key' | 'oauth';
  configured: boolean;
  source?: string;
  label?: string;
  stored: boolean;
  storedType?: 'api_key' | 'oauth';
}

type OAuthStep =
  | { type: 'auth_url'; url: string; instructions?: string; progress: string[] }
  | { type: 'device_code'; userCode: string; verificationUri: string; intervalSeconds?: number; expiresInSeconds?: number; progress: string[] }
  | { type: 'prompt'; message: string; placeholder?: string; allowEmpty?: boolean; progress: string[] }
  | { type: 'manual_code'; message: string; progress: string[] }
  | { type: 'select'; message: string; options: Array<{ id: string; label: string }>; progress: string[] }
  | { type: 'waiting'; message: string; progress: string[] };

interface OAuthFlowInfo {
  id: string;
  provider: string;
  status: 'pending' | 'success' | 'error' | 'cancelled';
  step?: OAuthStep;
  authUrl?: string;
  authInstructions?: string;
  error?: string;
  progress: string[];
}

const fetchResources = async (kind: 'skills' | 'extensions') => {
  const res = await fetch(`/api/resources/${kind}`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.resources || []) as ResourceInfo[];
};

const fetchProviders = async () => {
  const res = await fetch('/api/auth/providers');
  if (!res.ok) return [];
  const data = await res.json();
  return (data.providers || []) as ProviderInfo[];
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

function SettingsMenuIcon(props: { kind: SettingsSection }) {
  return (
    <span class={`settings-menu-icon ${props.kind}`} aria-hidden="true">
      <Show when={props.kind === 'provider'} fallback={
        <Show when={props.kind === 'skills'} fallback={
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M8 3.75h8A4.25 4.25 0 0 1 20.25 8v8A4.25 4.25 0 0 1 16 20.25H8A4.25 4.25 0 0 1 3.75 16V8A4.25 4.25 0 0 1 8 3.75Z" />
            <path d="M8.25 9.25h7.5M8.25 14.75h7.5M9.25 7.25v9.5M14.75 7.25v9.5" />
          </svg>
        }>
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M12 3.75v3.5M12 16.75v3.5M3.75 12h3.5M16.75 12h3.5" />
            <path d="m6.55 6.55 2.47 2.47M14.98 14.98l2.47 2.47M17.45 6.55l-2.47 2.47M9.02 14.98l-2.47 2.47" />
            <circle cx="12" cy="12" r="2.75" />
          </svg>
        </Show>
      }>
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M12 3.75 5.75 6.5v5.25c0 4.15 2.62 7.22 6.25 8.5 3.63-1.28 6.25-4.35 6.25-8.5V6.5L12 3.75Z" />
          <path d="M9.25 12.25 11.1 14l3.65-4" />
        </svg>
      </Show>
    </span>
  );
}

function statusText(provider: ProviderInfo) {
  if (provider.source === 'environment') return `Environment${provider.label ? ` · ${provider.label}` : ''}`;
  if (provider.source === 'runtime') return 'Runtime API key';
  if (provider.source === 'models_json_key') return 'Key in models.json';
  if (provider.source === 'models_json_command') return 'Command in models.json';
  if (provider.source === 'stored') return provider.storedType === 'oauth' ? 'OAuth stored' : 'API key stored';
  return provider.configured ? 'Configured' : 'Not configured';
}

export default function SettingsModal(props: { onClose: () => void }) {
  const [activeSection, setActiveSection] = createSignal<SettingsSection>('provider');
  const [mobileMenuOpen, setMobileMenuOpen] = createSignal(true);
  const [selectedSkill, setSelectedSkill] = createSignal<string | null>(null);
  const [selectedExtension, setSelectedExtension] = createSignal<string | null>(null);
  const [selectedProvider, setSelectedProvider] = createSignal<string | null>(null);
  const [creatingProvider, setCreatingProvider] = createSignal(false);
  const [newProviderId, setNewProviderId] = createSignal('');
  const [newProviderName, setNewProviderName] = createSignal('');
  const [newProviderBaseUrl, setNewProviderBaseUrl] = createSignal('');
  const [newProviderModelId, setNewProviderModelId] = createSignal('');
  const [newProviderModelName, setNewProviderModelName] = createSignal('');
  const [newProviderApiKey, setNewProviderApiKey] = createSignal('');
  const [apiKey, setApiKey] = createSignal('');
  const [providerMessage, setProviderMessage] = createSignal<string | null>(null);
  const [providerBusy, setProviderBusy] = createSignal(false);
  const [oauthFlow, setOauthFlow] = createSignal<OAuthFlowInfo | null>(null);
  const [oauthInput, setOauthInput] = createSignal('');
  let oauthPoll: ReturnType<typeof setInterval> | undefined;

  const [providers, { refetch: refetchProviders }] = createResource(fetchProviders);
  const [skills] = createResource(() => fetchResources('skills'));
  const [extensions] = createResource(() => fetchResources('extensions'));
  const [skillDetail] = createResource(selectedSkill, fetchSkillDetail);
  const [extensionDetail] = createResource(selectedExtension, fetchExtensionDetail);

  const currentResources = () => activeSection() === 'skills' ? (skills() || []) : (extensions() || []);
  const currentResourcesLoading = () => activeSection() === 'skills' ? skills.loading : extensions.loading;
  const selectedTitle = () => creatingProvider() ? 'Create Provider' : selectedProvider() || selectedSkill() || selectedExtension() || sectionTitle();
  const sectionTitle = () => activeSection() === 'provider' ? 'Provider' : activeSection() === 'skills' ? 'Skills' : 'Extensions';
  const emptyLabel = () => activeSection() === 'skills' ? 'skills' : 'extensions';
  const selectedProviderInfo = () => (providers() || []).find((p) => p.id === selectedProvider()) || null;
  const canCreateProvider = () => !!newProviderId().trim() && !!newProviderBaseUrl().trim() && !!newProviderModelId().trim();

  const stopOAuthPolling = () => {
    if (oauthPoll) clearInterval(oauthPoll);
    oauthPoll = undefined;
  };

  // Stop polling and cancel a still-pending flow server-side, so navigating
  // away (or closing the modal) doesn't leave the login hanging on input.
  const abandonOAuthFlow = () => {
    stopOAuthPolling();
    const flow = oauthFlow();
    if (flow && flow.status === 'pending') {
      fetch(`/api/auth/oauth/flows/${encodeURIComponent(flow.id)}/cancel`, { method: 'POST' }).catch(() => {});
    }
    setOauthFlow(null);
    setOauthInput('');
  };

  onCleanup(abandonOAuthFlow);

  const switchSection = (section: SettingsSection) => {
    setActiveSection(section);
    setSelectedSkill(null);
    setSelectedExtension(null);
    setSelectedProvider(null);
    setCreatingProvider(false);
    setProviderMessage(null);
    abandonOAuthFlow();
    setApiKey('');
    setMobileMenuOpen(false);
  };

  const resetCreateProviderForm = () => {
    setNewProviderId('');
    setNewProviderName('');
    setNewProviderBaseUrl('');
    setNewProviderModelId('');
    setNewProviderModelName('');
    setNewProviderApiKey('');
  };

  const createProvider = async () => {
    if (!canCreateProvider()) return;
    setProviderBusy(true);
    setProviderMessage(null);
    try {
      const res = await fetch('/api/auth/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: newProviderId(),
          name: newProviderName(),
          baseUrl: newProviderBaseUrl(),
          modelId: newProviderModelId(),
          modelName: newProviderModelName(),
          apiKey: newProviderApiKey(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to create provider');
      const created = data.provider || newProviderId().trim();
      resetCreateProviderForm();
      setCreatingProvider(false);
      setSelectedProvider(created);
      setProviderMessage('Provider created in Pi models.json.');
      await refetchProviders();
    } catch (err) {
      setProviderMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setProviderBusy(false);
    }
  };

  const saveApiKey = async () => {
    const provider = selectedProviderInfo();
    if (!provider || !apiKey().trim()) return;
    setProviderBusy(true);
    setProviderMessage(null);
    try {
      const res = await fetch(`/api/auth/${encodeURIComponent(provider.id)}/api-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to save API key');
      setApiKey('');
      setProviderMessage('API key saved. Models from this provider are now available.');
      await refetchProviders();
    } catch (err) {
      setProviderMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setProviderBusy(false);
    }
  };

  const logoutProvider = async () => {
    const provider = selectedProviderInfo();
    if (!provider) return;
    setProviderBusy(true);
    setProviderMessage(null);
    try {
      const res = await fetch(`/api/auth/${encodeURIComponent(provider.id)}/logout`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to remove credentials');
      setProviderMessage('Credentials removed.');
      await refetchProviders();
    } catch (err) {
      setProviderMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setProviderBusy(false);
    }
  };

  // Auto-open the auth URL the first time a poll delivers it. window.open from
  // a poll callback is outside a user gesture, so popup blockers may veto it —
  // the visible "Open browser" button stays as the fallback.
  let autoOpenedUrl: string | undefined;

  const pollOAuthFlow = async (id: string) => {
    const res = await fetch(`/api/auth/oauth/flows/${encodeURIComponent(id)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to read OAuth flow');
    setOauthFlow(data as OAuthFlowInfo);
    if (data.status === 'pending' && data.authUrl && autoOpenedUrl !== data.authUrl) {
      autoOpenedUrl = data.authUrl;
      const opened = window.open(data.authUrl, '_blank', 'noopener,noreferrer');
      if (!opened) setProviderMessage('Popup blocked — use the Open browser button below.');
    }
    if (data.status === 'success') {
      stopOAuthPolling();
      setProviderMessage('OAuth login complete. Models from this provider are now available.');
      await refetchProviders();
    } else if (data.status === 'error' || data.status === 'cancelled') {
      stopOAuthPolling();
      setProviderMessage(data.error || `OAuth login ${data.status}.`);
    }
  };

  const startOAuthLogin = async () => {
    const provider = selectedProviderInfo();
    if (!provider) return;
    setProviderBusy(true);
    setProviderMessage(null);
    setOauthFlow(null);
    setOauthInput('');
    stopOAuthPolling();
    autoOpenedUrl = undefined;
    try {
      const res = await fetch(`/api/auth/${encodeURIComponent(provider.id)}/oauth/start`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to start OAuth login');
      await pollOAuthFlow(data.id);
      oauthPoll = setInterval(() => pollOAuthFlow(data.id).catch((err) => {
        stopOAuthPolling();
        setProviderMessage(err instanceof Error ? err.message : String(err));
      }), 1000);
    } catch (err) {
      setProviderMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setProviderBusy(false);
    }
  };

  const respondOAuth = async (value?: string, cancelled = false) => {
    const flow = oauthFlow();
    if (!flow) return;
    setProviderBusy(true);
    try {
      const res = await fetch(`/api/auth/oauth/flows/${encodeURIComponent(flow.id)}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value, cancelled }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to continue OAuth login');
      setOauthInput('');
      await pollOAuthFlow(flow.id);
    } catch (err) {
      setProviderMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setProviderBusy(false);
    }
  };

  const cancelOAuth = async () => {
    const flow = oauthFlow();
    if (!flow) return;
    setProviderBusy(true);
    try {
      await fetch(`/api/auth/oauth/flows/${encodeURIComponent(flow.id)}/cancel`, { method: 'POST' });
      stopOAuthPolling();
      setOauthFlow(null);
      setProviderMessage('OAuth login cancelled.');
    } finally {
      setProviderBusy(false);
    }
  };

  const openOAuthUrl = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setProviderMessage('Copied to clipboard.');
    } catch {
      setProviderMessage('Could not copy to clipboard.');
    }
  };

  return (
    <div class="settings-modal-overlay" onClick={props.onClose}>
      <div class={`settings-modal ${mobileMenuOpen() ? 'menu-view' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div class="settings-modal-sidebar">
          <div class="settings-modal-title-row">
            <div class="settings-modal-title">Settings</div>
            <button onClick={props.onClose} class="settings-modal-close settings-sidebar-close">✕</button>
          </div>
          <For each={(['provider', 'skills', 'extensions'] as SettingsSection[])}>
            {(section) => (
              <button class={`settings-menu-item ${activeSection() === section ? 'active' : ''}`} onClick={() => switchSection(section)}>
                <SettingsMenuIcon kind={section} />
                <span>{section === 'provider' ? 'Provider' : section === 'skills' ? 'Skills' : 'Extensions'}</span>
              </button>
            )}
          </For>
        </div>

        <div class="settings-modal-content">
          <div class="settings-modal-header">
            <div class="settings-section-heading">
              <Show when={!selectedSkill() && !selectedExtension() && !selectedProvider() && !creatingProvider()}>
                <button class="settings-back-button settings-menu-back" onClick={() => setMobileMenuOpen(true)}>← Settings</button>
              </Show>
              <Show when={activeSection() === 'provider' && (selectedProvider() || creatingProvider())}>
                <button class="settings-back-button" onClick={() => { setSelectedProvider(null); setCreatingProvider(false); setProviderMessage(null); abandonOAuthFlow(); setApiKey(''); resetCreateProviderForm(); }}>← Provider</button>
              </Show>
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
            <Show when={activeSection() !== 'provider'} fallback={
              <Show when={!selectedProvider() && !creatingProvider()} fallback={
                <Show when={creatingProvider()} fallback={
                  <Show when={selectedProviderInfo()} keyed fallback={<div class="settings-modal-empty">Provider not found.</div>}>
                    {(provider) => (
                    <div class="settings-detail">
                      <div class="settings-skill-meta">
                        <div class="settings-skill-meta-row"><span class="settings-skill-meta-label">Name</span><span class="settings-skill-meta-value">{provider.name}</span></div>
                        <div class="settings-skill-meta-row"><span class="settings-skill-meta-label">Provider</span><span class="settings-skill-meta-value path">{provider.id}</span></div>
                        <div class="settings-skill-meta-row"><span class="settings-skill-meta-label">Status</span><span class={`settings-skill-meta-value ${provider.configured ? 'success' : ''}`}>{statusText(provider)}</span></div>
                        <div class="settings-skill-meta-row"><span class="settings-skill-meta-label">Auth</span><span class="settings-skill-meta-value">{provider.authType === 'oauth' ? 'OAuth' : 'API key'}</span></div>
                      </div>

                      <Show when={provider.authType === 'api_key'} fallback={
                        <div class="settings-provider-form">
                          <div class="settings-provider-actions">
                            <button class="settings-provider-button primary" disabled={providerBusy() || oauthFlow()?.status === 'pending'} onClick={startOAuthLogin}>Login with OAuth</button>
                            <Show when={provider.stored}>
                              <button class="settings-provider-button" disabled={providerBusy()} onClick={logoutProvider}>Remove stored credentials</button>
                            </Show>
                          </div>

                          <Show when={oauthFlow()?.step} keyed>
                            {(step) => (
                              <div class="settings-oauth-step">
                                {/* The auth URL lives on the flow, not the step: providers
                                    move to manual_code in the same tick they announce the
                                    URL, so it must stay visible across step changes. */}
                                <Show when={oauthFlow()?.status === 'pending' && oauthFlow()?.authUrl} keyed>
                                  {(url) => (
                                    <>
                                      <p>{oauthFlow()?.authInstructions || 'Complete login in your browser:'}</p>
                                      <button class="settings-provider-button primary" onClick={() => openOAuthUrl(url)}>Open browser</button>
                                      <div class="settings-oauth-url">{url}</div>
                                    </>
                                  )}
                                </Show>

                                <Show when={step.type === 'auth_url'}>
                                  <button class="settings-provider-button" disabled={providerBusy()} onClick={cancelOAuth}>Cancel</button>
                                </Show>

                                <Show when={step.type === 'device_code'}>
                                  <p>Open the verification URL and enter this code:</p>
                                  <div class="settings-oauth-code-row">
                                    <div class="settings-oauth-code">{step.type === 'device_code' ? step.userCode : ''}</div>
                                    <button
                                      class="settings-oauth-copy-button"
                                      type="button"
                                      title="Copy code"
                                      aria-label="Copy device code"
                                      onClick={() => step.type === 'device_code' && copyToClipboard(step.userCode)}
                                    >
                                      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                        <path d="M8.75 8.75h8.5v8.5h-8.5z" />
                                        <path d="M6.75 15.25h-1a2 2 0 0 1-2-2v-7.5a2 2 0 0 1 2-2h7.5a2 2 0 0 1 2 2v1" />
                                      </svg>
                                    </button>
                                  </div>
                                  <button class="settings-provider-button primary" onClick={() => step.type === 'device_code' && openOAuthUrl(step.verificationUri)}>Open verification page</button>
                                  <div class="settings-oauth-url">{step.type === 'device_code' ? step.verificationUri : ''}</div>
                                </Show>

                                <Show when={step.type === 'prompt' || step.type === 'manual_code'}>
                                  <label class="settings-provider-label" for="oauth-input">{step.type === 'prompt' || step.type === 'manual_code' ? step.message : ''}</label>
                                  <input
                                    id="oauth-input"
                                    class="settings-provider-input"
                                    type="text"
                                    placeholder={step.type === 'prompt' ? step.placeholder || '' : ''}
                                    value={oauthInput()}
                                    onInput={(e) => setOauthInput(e.currentTarget.value)}
                                    disabled={providerBusy()}
                                  />
                                  <div class="settings-provider-actions">
                                    <button class="settings-provider-button primary" disabled={providerBusy() || (!oauthInput().trim() && !(step.type === 'prompt' && step.allowEmpty))} onClick={() => respondOAuth(oauthInput())}>Continue</button>
                                    <button class="settings-provider-button" disabled={providerBusy()} onClick={cancelOAuth}>Cancel</button>
                                  </div>
                                </Show>

                                <Show when={step.type === 'select'}>
                                  <p>{step.type === 'select' ? step.message : ''}</p>
                                  <div class="settings-provider-actions">
                                    <For each={step.type === 'select' ? step.options : []}>
                                      {(option) => <button class="settings-provider-button primary" disabled={providerBusy()} onClick={() => respondOAuth(option.id)}>{option.label}</button>}
                                    </For>
                                    <button class="settings-provider-button" disabled={providerBusy()} onClick={() => respondOAuth(undefined, true)}>Cancel</button>
                                  </div>
                                </Show>

                                <Show when={step.type === 'waiting'}>
                                  <p>{step.type === 'waiting' ? step.message : 'Waiting...'}</p>
                                  <button class="settings-provider-button" disabled={providerBusy()} onClick={cancelOAuth}>Cancel</button>
                                </Show>

                                <Show when={step.progress.length > 0}>
                                  <div class="settings-oauth-progress">
                                    <For each={step.progress}>{(line) => <div>{line}</div>}</For>
                                  </div>
                                </Show>
                              </div>
                            )}
                          </Show>
                        </div>
                      }>
                        <div class="settings-provider-form">
                          <label class="settings-provider-label" for="provider-api-key">API key</label>
                          <input
                            id="provider-api-key"
                            class="settings-provider-input"
                            type="password"
                            placeholder={`Paste ${provider.name} API key`}
                            value={apiKey()}
                            onInput={(e) => setApiKey(e.currentTarget.value)}
                            disabled={providerBusy()}
                          />
                          <div class="settings-provider-actions">
                            <button class="settings-provider-button primary" disabled={providerBusy() || !apiKey().trim()} onClick={saveApiKey}>Save API key</button>
                            <Show when={provider.stored}>
                              <button class="settings-provider-button" disabled={providerBusy()} onClick={logoutProvider}>Remove stored credentials</button>
                            </Show>
                          </div>
                        </div>
                      </Show>

                      <Show when={providerMessage()}>
                        <div class="settings-provider-message">{providerMessage()}</div>
                      </Show>
                    </div>
                    )}
                  </Show>
                }>
                  <div class="settings-detail">
                    <div class="settings-skill-meta">
                      <div class="settings-skill-meta-row"><span class="settings-skill-meta-label">Type</span><span class="settings-skill-meta-value">OpenAI-compatible custom provider</span></div>
                      <div class="settings-skill-meta-row"><span class="settings-skill-meta-label">File</span><span class="settings-skill-meta-value path">~/.pi/agent/models.json</span></div>
                    </div>
                    <div class="settings-provider-form">
                      <label class="settings-provider-label" for="new-provider-id">Provider ID *</label>
                      <input id="new-provider-id" class="settings-provider-input" value={newProviderId()} placeholder="local-openai" onInput={(e) => setNewProviderId(e.currentTarget.value)} disabled={providerBusy()} />

                      <label class="settings-provider-label" for="new-provider-name">Display name</label>
                      <input id="new-provider-name" class="settings-provider-input" value={newProviderName()} placeholder="Local OpenAI" onInput={(e) => setNewProviderName(e.currentTarget.value)} disabled={providerBusy()} />

                      <label class="settings-provider-label" for="new-provider-base-url">Base URL *</label>
                      <input id="new-provider-base-url" class="settings-provider-input" value={newProviderBaseUrl()} placeholder="http://localhost:1234/v1" onInput={(e) => setNewProviderBaseUrl(e.currentTarget.value)} disabled={providerBusy()} />

                      <label class="settings-provider-label" for="new-provider-model-id">Model ID *</label>
                      <input id="new-provider-model-id" class="settings-provider-input" value={newProviderModelId()} placeholder="qwen3-coder" onInput={(e) => setNewProviderModelId(e.currentTarget.value)} disabled={providerBusy()} />

                      <label class="settings-provider-label" for="new-provider-model-name">Model display name</label>
                      <input id="new-provider-model-name" class="settings-provider-input" value={newProviderModelName()} placeholder="Qwen3 Coder" onInput={(e) => setNewProviderModelName(e.currentTarget.value)} disabled={providerBusy()} />

                      <label class="settings-provider-label" for="new-provider-api-key">API key optional</label>
                      <input id="new-provider-api-key" class="settings-provider-input" type="password" value={newProviderApiKey()} placeholder="Stored in ~/.pi/agent/auth.json" onInput={(e) => setNewProviderApiKey(e.currentTarget.value)} disabled={providerBusy()} />

                      <div class="settings-provider-actions">
                        <button class="settings-provider-button primary" disabled={providerBusy() || !canCreateProvider()} onClick={createProvider}>Create Provider</button>
                        <button class="settings-provider-button" disabled={providerBusy()} onClick={() => { setCreatingProvider(false); resetCreateProviderForm(); }}>Cancel</button>
                      </div>
                    </div>
                    <Show when={providerMessage()}><div class="settings-provider-message">{providerMessage()}</div></Show>
                  </div>
                </Show>
              }>
                <Show when={!providers.loading} fallback={<div class="settings-modal-empty">Loading providers...</div>}>
                  <div class="settings-provider-actions settings-provider-create-row">
                    <button class="settings-provider-button primary" disabled={providerBusy()} onClick={() => { setCreatingProvider(true); setProviderMessage(null); }}>Create Provider</button>
                  </div>
                  <Show when={(providers() || []).length > 0} fallback={<div class="settings-modal-empty">No providers found.</div>}>
                    <div class="settings-resource-list">
                      <For each={providers()}>
                        {(provider) => (
                          <button class="settings-resource-card clickable" type="button" onClick={() => setSelectedProvider(provider.id)}>
                            <div class="settings-resource-card-header provider">
                              <span class="settings-resource-card-name">{provider.name}</span>
                              <span class={`settings-provider-badge ${provider.configured ? 'configured' : ''}`}>{provider.configured ? 'Configured' : 'Not configured'}</span>
                            </div>
                            <div class="settings-resource-card-desc">{provider.id} · {statusText(provider)}</div>
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>
                </Show>
              </Show>
            }>
              <Show when={!((activeSection() === 'skills' && selectedSkill()) || (activeSection() === 'extensions' && selectedExtension()))} fallback={
                <Show when={activeSection() === 'skills'} fallback={
                  <Show when={!extensionDetail.loading} fallback={<div class="settings-modal-empty">Loading extension...</div>}>
                    <Show when={extensionDetail()} keyed fallback={<div class="settings-modal-empty">Unable to load extension.</div>}>
                      {(detail) => (
                        <div class="settings-detail">
                          <div class="settings-skill-meta">
                            <div class="settings-skill-meta-row"><span class="settings-skill-meta-label">Name</span><span class="settings-skill-meta-value">{detail.name}</span></div>
                            <div class="settings-skill-meta-row"><span class="settings-skill-meta-label">Path</span><span class="settings-skill-meta-value path">{detail.path}</span></div>
                            <Show when={detail.resolvedPath && detail.resolvedPath !== detail.path}><div class="settings-skill-meta-row"><span class="settings-skill-meta-label">Resolved</span><span class="settings-skill-meta-value path">{detail.resolvedPath}</span></div></Show>
                            <Show when={detail.sourceInfo?.scope}><div class="settings-skill-meta-row"><span class="settings-skill-meta-label">Scope</span><span class="settings-skill-meta-value">{String(detail.sourceInfo?.scope)}</span></div></Show>
                          </div>
                          <div class="settings-extension-summary">
                            <div><strong>{detail.tools.length}</strong><span>Tools</span></div>
                            <div><strong>{detail.commands.length}</strong><span>Commands</span></div>
                            <div><strong>{detail.flags.length}</strong><span>Flags</span></div>
                            <div><strong>{detail.shortcuts.length}</strong><span>Shortcuts</span></div>
                            <div><strong>{detail.events.length}</strong><span>Events</span></div>
                            <div><strong>{detail.messageRenderers.length}</strong><span>Renderers</span></div>
                          </div>
                          <Show when={detail.tools.length + detail.commands.length + detail.flags.length + detail.shortcuts.length + detail.events.length + detail.messageRenderers.length === 0}>
                            <div class="settings-modal-empty">This extension has no registered runtime capabilities.</div>
                          </Show>
                          <Show when={detail.tools.length > 0}><section class="settings-detail-section"><h3>Tools</h3><For each={detail.tools}>{(tool) => <div class="settings-capability-card"><div class="settings-capability-title">{tool.name}</div><Show when={tool.label}><div class="settings-capability-subtitle">{tool.label}</div></Show><Show when={tool.description}><p>{tool.description}</p></Show><Show when={tool.promptSnippet}><p class="settings-capability-muted">Prompt: {tool.promptSnippet}</p></Show><Show when={tool.promptGuidelines?.length}><ul class="settings-capability-list"><For each={tool.promptGuidelines}>{(item) => <li>{item}</li>}</For></ul></Show><Show when={tool.parameters}><details class="settings-json-details"><summary>Parameters</summary><CodeView code={JSON.stringify(tool.parameters, null, 2)} path={`${tool.name}-parameters.json`} class="settings-json-code" /></details></Show></div>}</For></section></Show>
                          <Show when={detail.commands.length > 0}><section class="settings-detail-section"><h3>Commands</h3><For each={detail.commands}>{(command) => <div class="settings-capability-card compact"><div class="settings-capability-title">/{command.name}</div><Show when={command.description}><p>{command.description}</p></Show></div>}</For></section></Show>
                          <Show when={detail.flags.length > 0}><section class="settings-detail-section"><h3>Flags</h3><For each={detail.flags}>{(flag) => <div class="settings-capability-card compact"><div class="settings-capability-title">--{flag.name}</div><div class="settings-capability-muted">{flag.type}{flag.default !== undefined ? ` · default: ${String(flag.default)}` : ''}</div><Show when={flag.description}><p>{flag.description}</p></Show></div>}</For></section></Show>
                          <Show when={detail.shortcuts.length > 0}><section class="settings-detail-section"><h3>Shortcuts</h3><For each={detail.shortcuts}>{(shortcut) => <div class="settings-capability-card compact"><div class="settings-capability-title">{shortcut.shortcut}</div><Show when={shortcut.description}><p>{shortcut.description}</p></Show></div>}</For></section></Show>
                          <Show when={detail.events.length > 0}><section class="settings-detail-section"><h3>Events</h3><div class="settings-chip-list"><For each={detail.events}>{(event) => <span class="settings-chip">{event.name}{event.count > 1 ? ` ×${event.count}` : ''}</span>}</For></div></section></Show>
                          <Show when={detail.messageRenderers.length > 0}><section class="settings-detail-section"><h3>Message Renderers</h3><div class="settings-chip-list"><For each={detail.messageRenderers}>{(renderer) => <span class="settings-chip">{renderer}</span>}</For></div></section></Show>
                        </div>
                      )}
                    </Show>
                  </Show>
                }>
                  <Show when={!skillDetail.loading} fallback={<div class="settings-modal-empty">Loading skill...</div>}>
                    <Show when={skillDetail()} keyed fallback={<div class="settings-modal-empty">Unable to load skill.</div>}>
                      {(detail) => (
                        <div class="settings-detail">
                          <div class="settings-skill-meta">
                            <div class="settings-skill-meta-row"><span class="settings-skill-meta-label">Name</span><span class="settings-skill-meta-value">{detail.name}</span></div>
                            <Show when={detail.description}><div class="settings-skill-meta-row"><span class="settings-skill-meta-label">Description</span><span class="settings-skill-meta-value">{detail.description}</span></div></Show>
                            <div class="settings-skill-meta-row"><span class="settings-skill-meta-label">Path</span><span class="settings-skill-meta-value path">{detail.path}</span></div>
                          </div>
                          <div class="settings-skill-detail-content message-content" innerHTML={renderMarkdown(stripFrontmatter(detail.content))} />
                        </div>
                      )}
                    </Show>
                  </Show>
                </Show>
              }>
                <Show when={!currentResourcesLoading()} fallback={<div class="settings-modal-empty">Loading...</div>}>
                  <Show when={currentResources().length > 0} fallback={<div class="settings-modal-empty">No {emptyLabel()} loaded.</div>}>
                    <div class="settings-resource-list">
                      <For each={currentResources()}>
                        {(resource) => (
                          <button class="settings-resource-card clickable" type="button" onClick={() => activeSection() === 'skills' ? setSelectedSkill(resource.name) : setSelectedExtension(resource.name)}>
                            <div class="settings-resource-card-header"><span class="settings-resource-card-name">{resource.name}</span></div>
                            <Show when={resource.description}><div class="settings-resource-card-desc">{resource.description}</div></Show>
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>
                </Show>
              </Show>
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
}
