import { createSignal, onCleanup, type Accessor } from 'solid-js';
import { cancelOAuthFlow, getOAuthFlow, respondOAuthFlow, startOAuth, type OAuthFlowInfo, type ProviderInfo } from './api';

export function createOAuthFlow(options: {
  provider: Accessor<ProviderInfo | null>;
  onMessage: (message: string | null) => void;
  onProvidersChanged: () => Promise<unknown>;
  openUrl?: (url: string) => Window | null;
}) {
  const [flow, setFlow] = createSignal<OAuthFlowInfo | null>(null);
  const [input, setInput] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let autoOpenedUrl: string | undefined;
  const stopPolling = () => { if (pollTimer) clearInterval(pollTimer); pollTimer = undefined; };

  const poll = async (id: string) => {
    const next = await getOAuthFlow<OAuthFlowInfo>(id);
    setFlow(next);
    if (next.status === 'pending' && next.authUrl && autoOpenedUrl !== next.authUrl) {
      autoOpenedUrl = next.authUrl;
      const opened = (options.openUrl ?? ((url) => window.open(url, '_blank', 'noopener,noreferrer')))(next.authUrl);
      if (!opened) options.onMessage('Popup blocked — use the Open browser button below.');
    }
    if (next.status === 'success') {
      stopPolling(); options.onMessage('OAuth login complete. Models from this provider are now available.'); await options.onProvidersChanged();
    } else if (next.status === 'error' || next.status === 'cancelled') {
      stopPolling(); options.onMessage(next.error || `OAuth login ${next.status}.`);
    }
  };
  const start = async () => {
    const provider = options.provider();
    if (!provider) return;
    setBusy(true); options.onMessage(null); setFlow(null); setInput(''); stopPolling(); autoOpenedUrl = undefined;
    try {
      const started = await startOAuth(provider.id);
      await poll(started.id);
      pollTimer = setInterval(() => void poll(started.id).catch((error) => { stopPolling(); options.onMessage(error instanceof Error ? error.message : String(error)); }), 1000);
    } catch (error) { options.onMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const respond = async (value?: string, cancelled = false) => {
    const current = flow(); if (!current) return;
    setBusy(true);
    try { await respondOAuthFlow(current.id, value, cancelled); setInput(''); await poll(current.id); }
    catch (error) { options.onMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const cancel = async () => {
    const current = flow(); if (!current) return;
    setBusy(true);
    try { await cancelOAuthFlow(current.id); stopPolling(); setFlow(null); options.onMessage('OAuth login cancelled.'); }
    finally { setBusy(false); }
  };
  const abandon = () => {
    stopPolling(); const current = flow();
    if (current?.status === 'pending') void cancelOAuthFlow(current.id).catch(() => {});
    setFlow(null); setInput('');
  };
  onCleanup(abandon);
  return { flow, input, setInput, busy, start, respond, cancel, abandon, poll, stopPolling };
}
