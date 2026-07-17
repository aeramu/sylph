import { For, Show } from 'solid-js';
import type { ResourceInfo } from '../../../types';

export default function ResourceList(props: { resources: ResourceInfo[]; loading: boolean; label: string; onSelect: (name: string) => void }) {
  return <Show when={!props.loading} fallback={<div class="settings-modal-empty">Loading...</div>}>
    <Show when={props.resources.length > 0} fallback={<div class="settings-modal-empty">No {props.label} loaded.</div>}>
      <div class="settings-resource-list"><For each={props.resources}>{(resource) => <button class="settings-resource-card clickable" type="button" onClick={() => props.onSelect(resource.name)}>
        <div class="settings-resource-card-header"><span class="settings-resource-card-name">{resource.name}</span></div>
        <Show when={resource.description}><div class="settings-resource-card-desc">{resource.description}</div></Show>
      </button>}</For></div>
    </Show>
  </Show>;
}
