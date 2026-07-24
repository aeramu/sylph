import { createEffect, createResource, createSignal, For, Show } from 'solid-js';
import type { ModelOption, ThinkingLevel } from '../../types';
import { THINKING_LEVELS } from '../../types';
import { renderMarkdown } from '../../lib/markdown';
import CodeView from '../../shared/ui/CodeView';
import CustomSelect from '../../shared/ui/CustomSelect';
import {
  createProvider as createProviderRequest, getExtension, getModels, getProviders,
  getSettings, getSkill, installExtension as installExtensionRequest, listResources,
  logoutProvider as logoutProviderRequest, saveProviderKey, uninstallExtension as uninstallExtensionRequest,
  updateSettings,
  type ModelsResponse, type ProviderInfo,
} from './api';
import SettingsNavigation, { type SettingsSection } from './components/SettingsNavigation';
import ResourceList from './components/ResourceList';
import { SettingsMetaList, SettingsMetaRow } from './components/SettingsMetaList';
import { createOAuthFlow } from './createOAuthFlow';
import './SettingsModal.css';

const fetchModels = async () => {
  const data = await getModels().catch((): ModelsResponse => ({ models: [] }));
  return (data.models || []).map((model): ModelOption => {
    const value = model.value || `${model.provider}/${model.id}`;
    const provider = model.provider || value.split('/')[0] || 'Other';
    const thinkingLevels = Array.isArray(model.thinkingLevels)
      ? model.thinkingLevels.filter((level): level is ThinkingLevel =>
          typeof level === 'string' && THINKING_LEVELS.some((option) => option.value === level))
      : undefined;
    return { value, label: model.id, provider, searchText: `${provider} ${model.id} ${value}`, thinkingLevels };
  });
};

const stripFrontmatter = (content: string) =>
  content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');

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
  const [commitMessageModel, setCommitMessageModel] = createSignal('');
  const [commitMessageThinkingLevel, setCommitMessageThinkingLevel] = createSignal<ThinkingLevel>('off');
  const [commitMessagePrompt, setCommitMessagePrompt] = createSignal('');
  const [savedCommitMessagePrompt, setSavedCommitMessagePrompt] = createSignal('');
  const [settingsMessage, setSettingsMessage] = createSignal<string | null>(null);
  const [settingsBusy, setSettingsBusy] = createSignal(false);
  const [extensionSource, setExtensionSource] = createSignal('');
  const [extensionMessage, setExtensionMessage] = createSignal<string | null>(null);
  const [extensionBusy, setExtensionBusy] = createSignal(false);
  const [confirmingExtensionRemoval, setConfirmingExtensionRemoval] = createSignal(false);

  const [appSettings] = createResource(getSettings);
  const [models] = createResource(fetchModels);
  const [providers, { refetch: refetchProviders }] = createResource(getProviders);
  const [skills] = createResource(() => listResources('skills'));
  const [extensions, { refetch: refetchExtensions }] = createResource(() => listResources('extensions'));
  const [skillDetail] = createResource(selectedSkill, getSkill);
  const [extensionDetail] = createResource(selectedExtension, getExtension);

  const currentResources = () => activeSection() === 'skills' ? (skills() || []) : (extensions() || []);
  const currentResourcesLoading = () => activeSection() === 'skills' ? skills.loading : extensions.loading;
  const selectedTitle = () => creatingProvider() ? 'Create Provider' : selectedProvider() || selectedSkill() || selectedExtension() || sectionTitle();
  const sectionTitle = () => activeSection() === 'provider' ? 'Provider' : activeSection() === 'git' ? 'Git' : activeSection() === 'skills' ? 'Skills' : 'Extensions';
  const emptyLabel = () => activeSection() === 'skills' ? 'skills' : 'extensions';
  const selectedProviderInfo = () => (providers() || []).find((p) => p.id === selectedProvider()) || null;
  const providerOperationBusy = () => providerBusy() || oauthBusy();
  const canCreateProvider = () => !!newProviderId().trim() && !!newProviderBaseUrl().trim() && !!newProviderModelId().trim();

  createEffect(() => {
    const settings = appSettings();
    if (!settings) return;
    setCommitMessageModel(settings.commitMessageModel || '');
    setCommitMessageThinkingLevel(settings.commitMessageThinkingLevel || 'off');
    setCommitMessagePrompt(settings.commitMessagePrompt || '');
    setSavedCommitMessagePrompt(settings.commitMessagePrompt || '');
  });

  const selectedCommitModel = () => models()?.find((model) => model.value === commitMessageModel());
  const commitThinkingOptions = () => {
    const available = new Set(selectedCommitModel()?.thinkingLevels || ['off']);
    return THINKING_LEVELS
      .filter((option) => available.has(option.value))
      .map((option) => ({ value: option.value, label: option.label }));
  };

  const patchSettings = updateSettings;

  const saveCommitMessageModel = async (value: string) => {
    const previous = commitMessageModel();
    setCommitMessageModel(value);
    setSettingsBusy(true);
    setSettingsMessage(null);
    try {
      const model = models()?.find((option) => option.value === value);
      const levels = model?.thinkingLevels || ['off'];
      const thinkingLevel = levels.includes(commitMessageThinkingLevel()) ? commitMessageThinkingLevel() : levels[0] || 'off';
      const data = await patchSettings({ commitMessageModel: value, commitMessageThinkingLevel: thinkingLevel });
      setCommitMessageModel(data.commitMessageModel || value);
      setCommitMessageThinkingLevel(data.commitMessageThinkingLevel || thinkingLevel);
      setSettingsMessage('Saved for every project.');
    } catch (err) {
      setCommitMessageModel(previous);
      setSettingsMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setSettingsBusy(false);
    }
  };

  const saveCommitThinkingLevel = async (value: ThinkingLevel) => {
    const previous = commitMessageThinkingLevel();
    setCommitMessageThinkingLevel(value);
    setSettingsBusy(true);
    setSettingsMessage(null);
    try {
      const data = await patchSettings({ commitMessageThinkingLevel: value });
      setCommitMessageThinkingLevel(data.commitMessageThinkingLevel || value);
      setSettingsMessage('Saved for every project.');
    } catch (err) {
      setCommitMessageThinkingLevel(previous);
      setSettingsMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setSettingsBusy(false);
    }
  };

  const saveCommitPrompt = async () => {
    if (!commitMessagePrompt().trim()) return;
    setSettingsBusy(true);
    setSettingsMessage(null);
    try {
      const data = await patchSettings({ commitMessagePrompt: commitMessagePrompt() });
      setCommitMessagePrompt(data.commitMessagePrompt);
      setSavedCommitMessagePrompt(data.commitMessagePrompt);
      setSettingsMessage('Prompt saved for every project.');
    } catch (err) {
      setSettingsMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setSettingsBusy(false);
    }
  };

  const oauth = createOAuthFlow({
    provider: selectedProviderInfo,
    onMessage: setProviderMessage,
    onProvidersChanged: async () => { await refetchProviders(); },
  });
  const { flow: oauthFlow, input: oauthInput, setInput: setOauthInput, busy: oauthBusy, start: startOAuthLogin, respond: respondOAuth, cancel: cancelOAuth, abandon: abandonOAuthFlow } = oauth;

  const switchSection = (section: SettingsSection) => {
    setActiveSection(section);
    setSelectedSkill(null);
    setSelectedExtension(null);
    setConfirmingExtensionRemoval(false);
    setSelectedProvider(null);
    setCreatingProvider(false);
    setProviderMessage(null);
    setSettingsMessage(null);
    setExtensionMessage(null);
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
      const data = await createProviderRequest({
        providerId: newProviderId(), name: newProviderName(), baseUrl: newProviderBaseUrl(),
        modelId: newProviderModelId(), modelName: newProviderModelName(), apiKey: newProviderApiKey(),
      });
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
      await saveProviderKey(provider.id, apiKey());
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
      await logoutProviderRequest(provider.id);
      setProviderMessage('Credentials removed.');
      await refetchProviders();
    } catch (err) {
      setProviderMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setProviderBusy(false);
    }
  };

  const installExtension = async () => {
    const source = extensionSource().trim();
    if (!source) return;
    setExtensionBusy(true);
    setExtensionMessage(null);
    try {
      const data = await installExtensionRequest(source);
      setExtensionSource('');
      setExtensionMessage(`Installed ${data.source}. New chats will load it automatically; reload existing chats to activate it there.`);
      await refetchExtensions();
    } catch (err) {
      setExtensionMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setExtensionBusy(false);
    }
  };

  const uninstallExtension = async () => {
    const name = selectedExtension();
    if (!name) return;
    setExtensionBusy(true);
    setExtensionMessage(null);
    try {
      const data = await uninstallExtensionRequest(name);
      setSelectedExtension(null);
      setConfirmingExtensionRemoval(false);
      setExtensionMessage(`Uninstalled ${data.source}. New chats will no longer load it; reload existing chats to remove it there.`);
      await refetchExtensions();
    } catch (err) {
      setExtensionMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setExtensionBusy(false);
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
        <SettingsNavigation active={activeSection()} onSelect={switchSection} onClose={props.onClose} />

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
                <button class="settings-back-button" onClick={() => { setSelectedExtension(null); setConfirmingExtensionRemoval(false); setExtensionMessage(null); }}>← Extensions</button>
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
                      <SettingsMetaList>
                        <SettingsMetaRow label="Name">{provider.name}</SettingsMetaRow>
                        <SettingsMetaRow label="Provider" valueClass="path">{provider.id}</SettingsMetaRow>
                        <SettingsMetaRow label="Status" valueClass={provider.configured ? 'success' : ''}>{statusText(provider)}</SettingsMetaRow>
                        <SettingsMetaRow label="Auth">{provider.authType === 'oauth' ? 'OAuth' : 'API key'}</SettingsMetaRow>
                      </SettingsMetaList>

                      <Show when={provider.authType === 'api_key'} fallback={
                        <div class="settings-provider-form">
                          <div class="settings-provider-actions">
                            <button class="settings-provider-button primary" disabled={providerOperationBusy() || oauthFlow()?.status === 'pending'} onClick={startOAuthLogin}>Login with OAuth</button>
                            <Show when={provider.stored}>
                              <button class="settings-provider-button" disabled={providerOperationBusy()} onClick={logoutProvider}>Remove stored credentials</button>
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
                                  <button class="settings-provider-button" disabled={providerOperationBusy()} onClick={cancelOAuth}>Cancel</button>
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
                                    disabled={providerOperationBusy()}
                                  />
                                  <div class="settings-provider-actions">
                                    <button class="settings-provider-button primary" disabled={providerOperationBusy() || (!oauthInput().trim() && !(step.type === 'prompt' && step.allowEmpty))} onClick={() => respondOAuth(oauthInput())}>Continue</button>
                                    <button class="settings-provider-button" disabled={providerOperationBusy()} onClick={cancelOAuth}>Cancel</button>
                                  </div>
                                </Show>

                                <Show when={step.type === 'select'}>
                                  <p>{step.type === 'select' ? step.message : ''}</p>
                                  <div class="settings-provider-actions">
                                    <For each={step.type === 'select' ? step.options : []}>
                                      {(option) => <button class="settings-provider-button primary" disabled={providerOperationBusy()} onClick={() => respondOAuth(option.id)}>{option.label}</button>}
                                    </For>
                                    <button class="settings-provider-button" disabled={providerOperationBusy()} onClick={() => respondOAuth(undefined, true)}>Cancel</button>
                                  </div>
                                </Show>

                                <Show when={step.type === 'waiting'}>
                                  <p>{step.type === 'waiting' ? step.message : 'Waiting...'}</p>
                                  <button class="settings-provider-button" disabled={providerOperationBusy()} onClick={cancelOAuth}>Cancel</button>
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
                            disabled={providerOperationBusy()}
                          />
                          <div class="settings-provider-actions">
                            <button class="settings-provider-button primary" disabled={providerOperationBusy() || !apiKey().trim()} onClick={saveApiKey}>Save API key</button>
                            <Show when={provider.stored}>
                              <button class="settings-provider-button" disabled={providerOperationBusy()} onClick={logoutProvider}>Remove stored credentials</button>
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
                    <SettingsMetaList>
                      <SettingsMetaRow label="Type">OpenAI-compatible custom provider</SettingsMetaRow>
                      <SettingsMetaRow label="File" valueClass="path">~/.pi/agent/models.json</SettingsMetaRow>
                    </SettingsMetaList>
                    <div class="settings-provider-form">
                      <label class="settings-provider-label" for="new-provider-id">Provider ID *</label>
                      <input id="new-provider-id" class="settings-provider-input" value={newProviderId()} placeholder="local-openai" onInput={(e) => setNewProviderId(e.currentTarget.value)} disabled={providerOperationBusy()} />

                      <label class="settings-provider-label" for="new-provider-name">Display name</label>
                      <input id="new-provider-name" class="settings-provider-input" value={newProviderName()} placeholder="Local OpenAI" onInput={(e) => setNewProviderName(e.currentTarget.value)} disabled={providerOperationBusy()} />

                      <label class="settings-provider-label" for="new-provider-base-url">Base URL *</label>
                      <input id="new-provider-base-url" class="settings-provider-input" value={newProviderBaseUrl()} placeholder="http://localhost:1234/v1" onInput={(e) => setNewProviderBaseUrl(e.currentTarget.value)} disabled={providerOperationBusy()} />

                      <label class="settings-provider-label" for="new-provider-model-id">Model ID *</label>
                      <input id="new-provider-model-id" class="settings-provider-input" value={newProviderModelId()} placeholder="qwen3-coder" onInput={(e) => setNewProviderModelId(e.currentTarget.value)} disabled={providerOperationBusy()} />

                      <label class="settings-provider-label" for="new-provider-model-name">Model display name</label>
                      <input id="new-provider-model-name" class="settings-provider-input" value={newProviderModelName()} placeholder="Qwen3 Coder" onInput={(e) => setNewProviderModelName(e.currentTarget.value)} disabled={providerOperationBusy()} />

                      <label class="settings-provider-label" for="new-provider-api-key">API key optional</label>
                      <input id="new-provider-api-key" class="settings-provider-input" type="password" value={newProviderApiKey()} placeholder="Stored in ~/.pi/agent/auth.json" onInput={(e) => setNewProviderApiKey(e.currentTarget.value)} disabled={providerOperationBusy()} />

                      <div class="settings-provider-actions">
                        <button class="settings-provider-button primary" disabled={providerOperationBusy() || !canCreateProvider()} onClick={createProvider}>Create Provider</button>
                        <button class="settings-provider-button" disabled={providerOperationBusy()} onClick={() => { setCreatingProvider(false); resetCreateProviderForm(); }}>Cancel</button>
                      </div>
                    </div>
                    <Show when={providerMessage()}><div class="settings-provider-message">{providerMessage()}</div></Show>
                  </div>
                </Show>
              }>
                <Show when={!providers.loading} fallback={<div class="settings-modal-empty">Loading providers...</div>}>
                  <div class="settings-provider-actions settings-provider-create-row">
                    <button class="settings-provider-button primary" disabled={providerOperationBusy()} onClick={() => { setCreatingProvider(true); setProviderMessage(null); }}>Create Provider</button>
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
              <Show when={activeSection() !== 'git'} fallback={
                <div class="settings-detail">
                  <div class="settings-provider-form settings-git-form">
                    <p class="settings-description">Choose the model and reasoning effort used for commit messages. These settings apply to every project.</p>
                    <div class="settings-git-select-row">
                      <div class="settings-git-select-field settings-git-model-field">
                        <label class="settings-provider-label">Commit message model</label>
                        <Show when={!models.loading && !appSettings.loading} fallback={<div class="settings-modal-empty">Loading models...</div>}>
                          <CustomSelect
                            triggerClass="settings-model-selector"
                            value={commitMessageModel()}
                            onChange={(value) => void saveCommitMessageModel(value)}
                            options={models() || []}
                            placeholder="Select a model"
                            position="bottom"
                            searchable
                            searchPlaceholder="Search models..."
                            noOptionsText="No configured models found"
                            disabled={settingsBusy()}
                            groupBy={(option) => option.provider}
                          />
                        </Show>
                      </div>
                      <div class="settings-git-select-field settings-git-thinking-field">
                        <label class="settings-provider-label">Thinking</label>
                        <CustomSelect
                          triggerClass="settings-model-selector"
                          value={commitMessageThinkingLevel()}
                          onChange={(value) => void saveCommitThinkingLevel(value as ThinkingLevel)}
                          options={commitThinkingOptions()}
                          placeholder="Off"
                          position="bottom"
                          disabled={settingsBusy() || !commitMessageModel() || commitThinkingOptions().length === 0}
                        />
                      </div>
                    </div>

                    <label class="settings-provider-label" for="commit-message-prompt">Prompt template</label>
                    <p class="settings-description">Use <code>{'{{diff}}'}</code> where the staged patch should appear. If omitted, Sylph appends the diff automatically.</p>
                    <textarea
                      id="commit-message-prompt"
                      class="settings-provider-input settings-prompt-input"
                      value={commitMessagePrompt()}
                      onInput={(event) => setCommitMessagePrompt(event.currentTarget.value)}
                      disabled={settingsBusy()}
                      rows="10"
                    />
                    <div class="settings-provider-actions">
                      <button
                        class="settings-provider-button primary"
                        disabled={settingsBusy() || !commitMessagePrompt().trim() || commitMessagePrompt() === savedCommitMessagePrompt()}
                        onClick={() => void saveCommitPrompt()}
                      >
                        Save prompt
                      </button>
                      <button
                        class="settings-provider-button"
                        disabled={settingsBusy() || commitMessagePrompt() === savedCommitMessagePrompt()}
                        onClick={() => setCommitMessagePrompt(savedCommitMessagePrompt())}
                      >
                        Revert
                      </button>
                    </div>
                    <Show when={settingsMessage()}><div class="settings-provider-message">{settingsMessage()}</div></Show>
                  </div>
                </div>
              }>
              <Show when={!((activeSection() === 'skills' && selectedSkill()) || (activeSection() === 'extensions' && selectedExtension()))} fallback={
                <Show when={activeSection() === 'skills'} fallback={
                  <Show when={!extensionDetail.loading} fallback={<div class="settings-modal-empty">Loading extension...</div>}>
                    <Show when={extensionDetail()} keyed fallback={<div class="settings-modal-empty">Unable to load extension.</div>}>
                      {(detail) => (
                        <div class="settings-detail">
                          <SettingsMetaList>
                            <SettingsMetaRow label="Name">{detail.name}</SettingsMetaRow>
                            <SettingsMetaRow label="Path" valueClass="path">{detail.path}</SettingsMetaRow>
                            <Show when={detail.resolvedPath && detail.resolvedPath !== detail.path}><SettingsMetaRow label="Resolved" valueClass="path">{detail.resolvedPath}</SettingsMetaRow></Show>
                            <Show when={detail.sourceInfo?.scope}><SettingsMetaRow label="Scope">{String(detail.sourceInfo?.scope)}</SettingsMetaRow></Show>
                            <Show when={detail.package}><SettingsMetaRow label="Package" valueClass="path">{detail.package?.source}</SettingsMetaRow></Show>
                          </SettingsMetaList>
                          <Show when={detail.package}>
                            <div class="settings-extension-remove-panel">
                              <Show when={!confirmingExtensionRemoval()} fallback={
                                <>
                                  <p>Uninstall <code>{detail.package?.source}</code>? This removes all {detail.package?.extensions.length} extension{detail.package?.extensions.length === 1 ? '' : 's'} loaded from this package.</p>
                                  <div class="settings-provider-actions">
                                    <button class="settings-provider-button danger" disabled={extensionBusy()} onClick={() => void uninstallExtension()}>{extensionBusy() ? 'Uninstalling…' : 'Confirm uninstall'}</button>
                                    <button class="settings-provider-button" disabled={extensionBusy()} onClick={() => setConfirmingExtensionRemoval(false)}>Cancel</button>
                                  </div>
                                </>
                              }>
                                <button class="settings-provider-button danger" disabled={extensionBusy()} onClick={() => setConfirmingExtensionRemoval(true)}>Uninstall package</button>
                              </Show>
                              <Show when={extensionMessage()}><div class="settings-provider-message">{extensionMessage()}</div></Show>
                            </div>
                          </Show>
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
                          <SettingsMetaList>
                            <SettingsMetaRow label="Name">{detail.name}</SettingsMetaRow>
                            <Show when={detail.description}><SettingsMetaRow label="Description">{detail.description}</SettingsMetaRow></Show>
                            <SettingsMetaRow label="Path" valueClass="path">{detail.path}</SettingsMetaRow>
                          </SettingsMetaList>
                          <div class="settings-skill-detail-content message-content" innerHTML={renderMarkdown(stripFrontmatter(detail.content))} />
                        </div>
                      )}
                    </Show>
                  </Show>
                </Show>
              }>
                <Show when={activeSection() === 'extensions'}>
                  <div class="settings-provider-form settings-extension-install-form">
                    <label class="settings-provider-label" for="extension-source">Install extension package</label>
                    <p class="settings-description">Enter an npm package, git repository, URL, or local path. Installs globally in Pi.</p>
                    <div class="settings-extension-install-row">
                      <input
                        id="extension-source"
                        class="settings-provider-input"
                        type="text"
                        placeholder="npm:@scope/package, https://github.com/user/repo, or /path/to/package"
                        value={extensionSource()}
                        onInput={(event) => setExtensionSource(event.currentTarget.value)}
                        onKeyDown={(event) => { if (event.key === 'Enter') void installExtension(); }}
                        disabled={extensionBusy()}
                      />
                      <button class="settings-provider-button primary" disabled={extensionBusy() || !extensionSource().trim()} onClick={() => void installExtension()}>
                        {extensionBusy() ? 'Installing…' : 'Install'}
                      </button>
                    </div>
                    <div class="settings-extension-warning"><strong>Security:</strong> Extensions run arbitrary code with full system access. Review and trust the source before installing.</div>
                    <Show when={extensionMessage()}><div class="settings-provider-message">{extensionMessage()}</div></Show>
                  </div>
                </Show>
                <ResourceList
                  resources={currentResources()}
                  loading={currentResourcesLoading()}
                  label={emptyLabel()}
                  onSelect={(name) => activeSection() === 'skills' ? setSelectedSkill(name) : setSelectedExtension(name)}
                />
              </Show>
              </Show>
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
}
