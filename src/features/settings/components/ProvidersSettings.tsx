import { createMemo, createSignal, For, Show } from 'solid-js';
import type { ProviderInfo } from '../api';

type ProviderFilter = 'all' | 'configured';

function authLabel(provider: ProviderInfo) {
  return provider.authType === 'oauth' ? 'OAuth' : 'API key';
}

function providerSubtitle(provider: ProviderInfo, statusText: (provider: ProviderInfo) => string) {
  return provider.configured
    ? `${provider.id} · ${statusText(provider)}`
    : `${provider.id} · ${authLabel(provider)}`;
}

function ProviderCard(props: {
  provider: ProviderInfo;
  statusText: (provider: ProviderInfo) => string;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      class={`settings-provider-card ${props.provider.configured ? 'configured' : ''}`}
      type="button"
      onClick={() => props.onSelect(props.provider.id)}
      aria-label={`Open ${props.provider.name} provider settings`}
    >
      <span class="settings-provider-card-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M8.25 11.5V8.75m7.5 2.75V8.75M6 11.5h12v1.25A5.25 5.25 0 0 1 12.75 18H11.25A5.25 5.25 0 0 1 6 12.75z" />
          <path d="M12 18v2.25M9.5 3.75v5m5-5v5" />
        </svg>
      </span>
      <span class="settings-provider-card-content">
        <span class="settings-provider-card-heading">
          <span class="settings-provider-card-name">{props.provider.name}</span>
          <span class={`settings-provider-state ${props.provider.configured ? 'configured' : ''}`}>
            <span class="settings-provider-state-dot" />
            {props.provider.configured ? 'Configured' : 'Set up'}
          </span>
        </span>
        <span class="settings-provider-card-subtitle">{providerSubtitle(props.provider, props.statusText)}</span>
      </span>
      <svg class="settings-provider-card-chevron" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
    </button>
  );
}

export default function ProvidersSettings(props: {
  providers: ProviderInfo[];
  loading: boolean;
  busy: boolean;
  statusText: (provider: ProviderInfo) => string;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  const [query, setQuery] = createSignal('');
  const [filter, setFilter] = createSignal<ProviderFilter>('all');
  const configuredCount = () => props.providers.filter((provider) => provider.configured).length;
  const matchingProviders = createMemo(() => {
    const search = query().trim().toLowerCase();
    return props.providers.filter((provider) => {
      if (filter() === 'configured' && !provider.configured) return false;
      return !search || `${provider.name} ${provider.id} ${authLabel(provider)}`.toLowerCase().includes(search);
    });
  });
  const configuredProviders = createMemo(() => matchingProviders().filter((provider) => provider.configured));
  const availableProviders = createMemo(() => matchingProviders().filter((provider) => !provider.configured));

  return (
    <div class="settings-providers-overview">
      <div class="settings-providers-intro">
        <div>
          <p class="settings-description">Connect model providers and manage the credentials available to Sylph.</p>
          <Show when={!props.loading}>
            <div class="settings-provider-count">{configuredCount()} configured · {props.providers.length} available</div>
          </Show>
        </div>
        <button class="settings-provider-button primary settings-provider-add" type="button" disabled={props.busy} onClick={props.onCreate}>
          <span aria-hidden="true">＋</span> Custom provider
        </button>
      </div>

      <Show when={!props.loading} fallback={<div class="settings-modal-empty">Loading providers...</div>}>
        <div class="settings-provider-toolbar">
          <label class="settings-provider-search">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>
            <input value={query()} onInput={(event) => setQuery(event.currentTarget.value)} placeholder="Search providers" aria-label="Search providers" />
            <Show when={query()}><button type="button" onClick={() => setQuery('')} aria-label="Clear provider search">✕</button></Show>
          </label>
          <div class="settings-provider-filters" role="group" aria-label="Filter providers">
            <button class={filter() === 'all' ? 'active' : ''} type="button" onClick={() => setFilter('all')}>All <span>{props.providers.length}</span></button>
            <button class={filter() === 'configured' ? 'active' : ''} type="button" onClick={() => setFilter('configured')}>Configured <span>{configuredCount()}</span></button>
          </div>
        </div>

        <Show when={matchingProviders().length > 0} fallback={
          <div class="settings-providers-empty"><strong>No providers found</strong><span>Try another search or change the filter.</span></div>
        }>
          <Show when={configuredProviders().length > 0}>
            <section class="settings-provider-group">
              <div class="settings-provider-group-heading"><span>Configured</span><span>{configuredProviders().length}</span></div>
              <div class="settings-provider-grid configured">
                <For each={configuredProviders()}>{(provider) => <ProviderCard provider={provider} statusText={props.statusText} onSelect={props.onSelect} />}</For>
              </div>
            </section>
          </Show>

          <Show when={availableProviders().length > 0}>
            <section class="settings-provider-group">
              <div class="settings-provider-group-heading"><span>Available providers</span><span>{availableProviders().length}</span></div>
              <div class="settings-provider-grid">
                <For each={availableProviders()}>{(provider) => <ProviderCard provider={provider} statusText={props.statusText} onSelect={props.onSelect} />}</For>
              </div>
            </section>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
