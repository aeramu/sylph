export type BrowserNotificationState =
  | { supported: false; permission: 'unsupported'; enabled: false }
  | { supported: true; permission: NotificationPermission; enabled: boolean };

export interface SylphNotification {
  title: string;
  body: string;
  tag: string;
  sessionId?: string;
}

const STORAGE_KEY = 'sylph.notifications.enabled';
const INPUT_METHODS = new Set(['select', 'confirm', 'input', 'editor', 'questions']);

function notificationsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

function preferenceEnabled() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function savePreference(enabled: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(enabled));
  } catch {
    // A private browsing policy can disable storage. Permission still remains
    // under the browser's control, so simply treat the preference as off.
  }
}

export function getBrowserNotificationState(): BrowserNotificationState {
  if (!notificationsSupported()) return { supported: false, permission: 'unsupported', enabled: false };
  return {
    supported: true,
    permission: Notification.permission,
    enabled: Notification.permission === 'granted' && preferenceEnabled(),
  };
}

export async function enableBrowserNotifications(): Promise<BrowserNotificationState> {
  if (!notificationsSupported()) return getBrowserNotificationState();
  const permission = await Notification.requestPermission();
  savePreference(permission === 'granted');
  return getBrowserNotificationState();
}

export function disableBrowserNotifications(): BrowserNotificationState {
  if (typeof window !== 'undefined') savePreference(false);
  return getBrowserNotificationState();
}

/** Convert a live agent event into the small set of events worth interrupting the user for. */
export function notificationForSessionEvent(
  event: { type?: string; method?: string; sessionId?: string },
  sessionTitle?: string,
  failed = false,
): SylphNotification | null {
  const label = sessionTitle?.trim() || 'Your task';
  if (event.type === 'extension_ui_request' && event.method && INPUT_METHODS.has(event.method)) {
    return {
      title: 'Sylph needs your input',
      body: `${label} is waiting for you.`,
      tag: `sylph-input-${event.sessionId || 'session'}`,
      sessionId: event.sessionId,
    };
  }
  if (event.type === 'agent_end') {
    return {
      title: failed ? 'Sylph hit a problem' : 'Sylph finished',
      body: failed ? `${label} ended with an error.` : `${label} is ready.`,
      tag: `sylph-complete-${event.sessionId || 'session'}`,
      sessionId: event.sessionId,
    };
  }
  return null;
}

function openSession(sessionId?: string) {
  window.focus();
  if (sessionId) window.dispatchEvent(new CustomEvent('sylph:open-session', { detail: { sessionId } }));
}

/** Show a system notification only when Sylph is not already the focused tab. */
export async function showBrowserNotification(notification: SylphNotification): Promise<boolean> {
  const state = getBrowserNotificationState();
  if (!state.supported || !state.enabled) return false;
  if (document.visibilityState === 'visible' && document.hasFocus()) return false;

  const options: NotificationOptions = {
    body: notification.body,
    icon: '/favicon.svg',
    tag: notification.tag,
    data: { sessionId: notification.sessionId },
  };

  // Service-worker notifications also work for installed mobile PWAs. Fall
  // back to the page API in development, where Sylph intentionally unregisters
  // its service worker to prevent stale Vite assets.
  if ('serviceWorker' in navigator) {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration) {
      await registration.showNotification(notification.title, options);
      return true;
    }
  }

  const nativeNotification = new Notification(notification.title, options);
  nativeNotification.onclick = () => {
    nativeNotification.close();
    openSession(notification.sessionId);
  };
  return true;
}
