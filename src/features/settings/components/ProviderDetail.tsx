import { createMemo, createResource, createSignal, For, Show } from 'solid-js';
import type { JSX } from 'solid-js';
import { getProviderModels, type ProviderInfo, type ProviderModelInfo } from '../api';

function formatTokens(value?: number) {
  if (!value) return null;
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`;
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}K`;
  return String(value);
}

function ProviderModelCard(props: { model: ProviderModelInfo }) {
  return (
    <div class="settings-provider-model-card">
      <span class="settings-provider-model-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none"><path d="M12 3.75 4.75 8v8L12 20.25 19.25 16V8z"/><path d="m4.75 8 7.25 4.25L19.25 8M12 12.25v8"/></svg>
      </span>
      <span class="settings-provider-model-content">
        <span class="settings-provider-model-heading">
          <span class="settings-provider-model-name">{props.model.name}</span>
          <Show when={props.model.name !== props.model.id}><span class="settings-provider-model-id">{props.model.id}</span></Show>
        </span>
        <span class="settings-provider-model-capabilities">
          <Show when={props.model.reasoning}><span>Reasoning</span></Show>
          <Show when={props.model.input.includes('image')}><span>Vision</span></Show>
          <Show when={formatTokens(props.model.contextWindow)} keyed>{(value) => <span>{value} context</span>}</Show>
          <Show when={formatTokens(props.model.maxTokens)} keyed>{(value) => <span>{value} output</span>}</Show>
        </span>
      </span>
    </div>
  );
}

export default function ProviderDetail(props: {
  provider: ProviderInfo;
  statusText: (provider: ProviderInfo) => string;
  children: JSX.Element;
  message?: string | null;
}) {
  const [models] = createResource(() => props.provider.id, getProviderModels);
  const [modelQuery, setModelQuery] = createSignal('');
  const matchingModels = createMemo(() => {
    const search = modelQuery().trim().toLowerCase();
    return !search ? (models() || []) : (models() || []).filter((model) =>
      `${model.name} ${model.id}`.toLowerCase().includes(search));
  });
  return (
    <div class="settings-detail settings-provider-detail">
      <section class={`settings-provider-hero ${props.provider.configured ? 'configured' : ''}`}>
        <span class="settings-provider-hero-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none"><path d="M8.25 11.5V8.75m7.5 2.75V8.75M6 11.5h12v1.25A5.25 5.25 0 0 1 12.75 18H11.25A5.25 5.25 0 0 1 6 12.75z"/><path d="M12 18v2.25M9.5 3.75v5m5-5v5"/></svg>
        </span>
        <span class="settings-provider-hero-content">
          <span class="settings-provider-hero-title-row">
            <span class="settings-provider-hero-name">{props.provider.name}</span>
            <span class={`settings-provider-state ${props.provider.configured ? 'configured' : ''}`}><span class="settings-provider-state-dot" />{props.provider.configured ? 'Configured' : 'Not configured'}</span>
          </span>
          <span class="settings-provider-hero-id">{props.provider.id}</span>
          <span class="settings-provider-hero-description">{props.statusText(props.provider)} · {props.provider.authType === 'oauth' ? 'OAuth' : 'API key'}</span>
        </span>
      </section>

      <section class="settings-detail-panel settings-provider-models-panel">
        <div class="settings-detail-panel-heading">
          <div><h3>Models</h3><p>Models registered for this provider.</p></div>
          <Show when={!models.loading}><span class="settings-detail-count">{(models() || []).length}</span></Show>
        </div>
        <Show when={!models.loading} fallback={<div class="settings-detail-loading">Loading models...</div>}>
          <Show when={!models.error} fallback={<div class="settings-provider-message">Could not load provider models.</div>}>
            <Show when={(models() || []).length > 0} fallback={<div class="settings-detail-empty">No models are registered for this provider.</div>}>
              <Show when={(models() || []).length > 6}>
                <label class="settings-provider-search settings-provider-model-search">
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>
                  <input value={modelQuery()} onInput={(event) => setModelQuery(event.currentTarget.value)} placeholder="Search models" aria-label="Search provider models" />
                  <Show when={modelQuery()}><button type="button" onClick={() => setModelQuery('')} aria-label="Clear model search">✕</button></Show>
                </label>
              </Show>
              <Show when={matchingModels().length > 0} fallback={<div class="settings-detail-empty">No models match this search.</div>}>
                <div class="settings-provider-model-grid"><For each={matchingModels()}>{(model) => <ProviderModelCard model={model} />}</For></div>
              </Show>
            </Show>
          </Show>
        </Show>
      </section>

      <section class="settings-detail-panel settings-provider-auth-panel">
        <div class="settings-detail-panel-heading">
          <div><h3>Authentication</h3><p>{props.provider.authType === 'oauth' ? 'Connect or remove the stored OAuth session.' : 'Replace or remove the API key used by this provider.'}</p></div>
        </div>
        {props.children}
      </section>

      <Show when={props.message}><div class="settings-provider-message">{props.message}</div></Show>
    </div>
  );
}
