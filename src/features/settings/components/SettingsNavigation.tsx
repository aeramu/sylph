import { For, Show } from 'solid-js';

export type SettingsSection = 'projects' | 'provider' | 'git' | 'notifications' | 'skills' | 'extensions';

function Icon(props: { kind: SettingsSection }) {
  return <span class={`settings-menu-icon ${props.kind}`} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none">
    <Show when={props.kind === 'projects'}><path d="M3.75 7.75A1.75 1.75 0 0 1 5.5 6h4.25l2 2h6.75a1.75 1.75 0 0 1 1.75 1.75v7.5A1.75 1.75 0 0 1 18.5 19H5.5a1.75 1.75 0 0 1-1.75-1.75z"/><path d="M3.75 11h16.5"/></Show>
    <Show when={props.kind === 'provider'}><path d="M12 3.75 5.75 6.5v5.25c0 4.15 2.62 7.22 6.25 8.5 3.63-1.28 6.25-4.35 6.25-8.5V6.5L12 3.75Z"/><path d="M9.25 12.25 11.1 14l3.65-4"/></Show>
    <Show when={props.kind === 'git'}><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="12" r="2"/><path d="M6 7v10M8 6.5c5 0 3 5.5 8 5.5"/></Show>
    <Show when={props.kind === 'notifications'}><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"/><path d="M10 21h4"/></Show>
    <Show when={props.kind === 'skills'}><path d="M12 3.75v3.5M12 16.75v3.5M3.75 12h3.5M16.75 12h3.5"/><circle cx="12" cy="12" r="2.75"/></Show>
    <Show when={props.kind === 'extensions'}><path d="M8 3.75h8A4.25 4.25 0 0 1 20.25 8v8A4.25 4.25 0 0 1 16 20.25H8A4.25 4.25 0 0 1 3.75 16V8A4.25 4.25 0 0 1 8 3.75Z"/><path d="M8.25 9.25h7.5M8.25 14.75h7.5M9.25 7.25v9.5M14.75 7.25v9.5"/></Show>
  </svg></span>;
}

export default function SettingsNavigation(props: { active: SettingsSection; onSelect: (section: SettingsSection) => void; onClose: () => void }) {
  const sections: Array<[SettingsSection, string]> = [['projects', 'Projects'], ['provider', 'Provider'], ['git', 'Git'], ['notifications', 'Notifications'], ['skills', 'Skills'], ['extensions', 'Extensions']];
  return <div class="settings-modal-sidebar">
    <div class="settings-modal-title-row"><div class="settings-modal-title">Settings</div><button onClick={props.onClose} class="settings-modal-close settings-sidebar-close">✕</button></div>
    <For each={sections}>{([section, label]) => <button class={`settings-menu-item ${props.active === section ? 'active' : ''}`} onClick={() => props.onSelect(section)}><Icon kind={section}/><span>{label}</span></button>}</For>
  </div>;
}
