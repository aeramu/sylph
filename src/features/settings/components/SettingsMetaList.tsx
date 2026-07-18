import type { JSX } from 'solid-js';

export function SettingsMetaList(props: { children: JSX.Element }) {
  return <div class="settings-skill-meta">{props.children}</div>;
}

export function SettingsMetaRow(props: {
  label: string;
  children: JSX.Element;
  valueClass?: string;
}) {
  return (
    <div class="settings-skill-meta-row">
      <span class="settings-skill-meta-label">{props.label}</span>
      <span class={`settings-skill-meta-value ${props.valueClass ?? ''}`}>{props.children}</span>
    </div>
  );
}
