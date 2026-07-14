import { createSignal, onMount, Show } from 'solid-js';
import { api } from '../lib/api';
import './BrowserTab.css';

interface DashboardStatus {
  available: boolean;
  running: boolean;
  url: string;
  error?: string;
}

export default function BrowserTab() {
  const [status, setStatus] = createSignal<DashboardStatus>();
  const [loading, setLoading] = createSignal(true);

  const loadStatus = async (start = false) => {
    setLoading(true);
    try {
      const next = await api<DashboardStatus>(
        start ? '/api/agent-browser/dashboard/start' : '/api/agent-browser/dashboard',
        start ? { method: 'POST' } : undefined,
      );
      setStatus(next);
    } catch (error: any) {
      setStatus({
        available: false,
        running: false,
        url: 'http://127.0.0.1:4848',
        error: error?.message || 'Could not query the agent-browser dashboard.',
      });
    } finally {
      setLoading(false);
    }
  };

  onMount(() => void loadStatus());

  return (
    <div class="browser-tab">
      <Show when={!loading()} fallback={<div class="browser-tab-state">Connecting to agent-browser…</div>}>
        <Show when={status()?.available} fallback={
          <div class="browser-tab-state">
            <div class="browser-tab-state-title">Agent Browser dashboard unavailable</div>
            <div class="browser-tab-state-message">{status()?.error || 'The dashboard is not responding.'}</div>
            <div class="browser-tab-actions">
              <button class="browser-tab-button" onClick={() => void loadStatus(true)}>Start again</button>
              <a class="browser-tab-link" href={status()?.url} target="_blank" rel="noreferrer">Open dashboard</a>
            </div>
          </div>
        }>
          <iframe
            class="browser-tab-frame"
            src={status()!.url}
            title="Agent Browser dashboard"
            allow="clipboard-read; clipboard-write"
          />
        </Show>
      </Show>
    </div>
  );
}
