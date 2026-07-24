import { createMemo, createSignal, For, Show } from 'solid-js';
import type { ResourceInfo } from '../../../types';

type ResourceKind = 'skills' | 'extensions';

function ResourceIcon(props: { kind: ResourceKind }) {
  return (
    <span class={`settings-library-card-icon ${props.kind}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none">
        <Show when={props.kind === 'skills'} fallback={
          <><path d="M8 3.75h8A4.25 4.25 0 0 1 20.25 8v8A4.25 4.25 0 0 1 16 20.25H8A4.25 4.25 0 0 1 3.75 16V8A4.25 4.25 0 0 1 8 3.75Z"/><path d="M8.25 9.25h7.5M8.25 14.75h7.5M9.25 7.25v9.5M14.75 7.25v9.5"/></>
        }>
          <><path d="M12 3.75v3.5M12 16.75v3.5M3.75 12h3.5M16.75 12h3.5"/><circle cx="12" cy="12" r="2.75"/></>
        </Show>
      </svg>
    </span>
  );
}

export default function ResourceList(props: {
  resources: ResourceInfo[];
  loading: boolean;
  label: string;
  kind: ResourceKind;
  onSelect: (name: string) => void;
}) {
  const [query, setQuery] = createSignal('');
  const matchingResources = createMemo(() => {
    const search = query().trim().toLowerCase();
    return !search ? props.resources : props.resources.filter((resource) =>
      `${resource.name} ${resource.description || ''}`.toLowerCase().includes(search));
  });
  const noun = () => props.kind === 'skills' ? 'skill' : 'extension';

  return (
    <div class={`settings-library settings-library-${props.kind}`}>
      <Show when={!props.loading} fallback={<div class="settings-modal-empty">Loading {props.label}...</div>}>
        <div class="settings-library-heading">
          <div>
            <h3>{props.kind === 'skills' ? 'Available skills' : 'Installed extensions'}</h3>
            <p>{props.kind === 'skills' ? 'Skills give the assistant specialized workflows and instructions.' : 'Extensions add tools, commands, and runtime capabilities to Pi.'}</p>
          </div>
          <span>{props.resources.length}</span>
        </div>

        <Show when={props.resources.length > 0} fallback={<div class="settings-library-empty"><strong>No {props.label} loaded</strong><span>Loaded {props.label} will appear here.</span></div>}>
          <label class="settings-provider-search settings-library-search">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>
            <input value={query()} onInput={(event) => setQuery(event.currentTarget.value)} placeholder={`Search ${props.label}`} aria-label={`Search ${props.label}`} />
            <Show when={query()}><button type="button" onClick={() => setQuery('')} aria-label={`Clear ${noun()} search`}>✕</button></Show>
          </label>

          <Show when={matchingResources().length > 0} fallback={<div class="settings-library-empty"><strong>No {props.label} found</strong><span>Try another search.</span></div>}>
            <div class={`settings-library-grid ${props.kind}`}>
              <For each={matchingResources()}>
                {(resource) => (
                  <button class="settings-library-card" type="button" onClick={() => props.onSelect(resource.name)} aria-label={`Open ${resource.name} ${noun()}`}>
                    <ResourceIcon kind={props.kind} />
                    <span class="settings-library-card-content">
                      <span class="settings-library-card-name">{resource.name}</span>
                      <Show when={resource.description}><span class="settings-library-card-description">{resource.description}</span></Show>
                      <Show when={!resource.description}><span class="settings-library-card-description muted">View capabilities and source details</span></Show>
                    </span>
                    <svg class="settings-library-card-chevron" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
