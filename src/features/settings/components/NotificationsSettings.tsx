import { createSignal, Show } from 'solid-js';
import {
  disableBrowserNotifications,
  enableBrowserNotifications,
  getBrowserNotificationState,
  type BrowserNotificationState,
} from '../../../lib/browserNotifications';

function statusLabel(state: BrowserNotificationState) {
  if (!state.supported) return 'Unavailable';
  if (state.permission === 'denied') return 'Blocked';
  return state.enabled ? 'On' : 'Off';
}

export default function NotificationsSettings() {
  const [state, setState] = createSignal(getBrowserNotificationState());
  const [busy, setBusy] = createSignal(false);

  const enable = async () => {
    setBusy(true);
    try {
      setState(await enableBrowserNotifications());
    } finally {
      setBusy(false);
    }
  };

  const disable = () => setState(disableBrowserNotifications());

  return (
    <div class="settings-detail settings-notification-settings">
      <div class="settings-section-intro">
        <div>
          <p class="settings-description">Get a system notification when an agent finishes or needs your input.</p>
          <div class="settings-section-meta">This browser · while Sylph is open in the background</div>
        </div>
      </div>

      <section class="settings-settings-card">
        <div class="settings-notification-row">
          <div class="settings-settings-card-heading">
            <span class="settings-settings-card-icon notification" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"/><path d="M10 21h4"/></svg>
            </span>
            <div><h3>Browser notifications</h3><p>Alerts are sent for completed turns, errors, questions, and permission requests.</p></div>
          </div>
          <span class={`settings-notification-status ${state().enabled ? 'enabled' : ''}`}>{statusLabel(state())}</span>
        </div>

        <Show when={state().supported} fallback={
          <div class="settings-provider-note">This browser does not support system notifications.</div>
        }>
          <Show when={state().permission !== 'denied'} fallback={
            <div class="settings-provider-note">Notifications are blocked for Sylph. Allow them in your browser or system site settings, then reopen Settings.</div>
          }>
            <div class="settings-provider-actions">
              <Show when={!state().enabled} fallback={
                <button class="settings-provider-button" onClick={disable}>Turn off</button>
              }>
                <button class="settings-provider-button primary" disabled={busy()} onClick={() => void enable()}>
                  {busy() ? 'Requesting…' : 'Enable notifications'}
                </button>
              </Show>
            </div>
          </Show>
        </Show>
      </section>

      <p class="settings-notification-footnote">Notification permission is controlled by your browser. Sylph stores only an on/off preference in this browser.</p>
    </div>
  );
}
