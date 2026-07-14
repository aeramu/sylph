import { createEffect, createSignal, onCleanup, type Accessor } from 'solid-js';
import type { FileMentionInfo } from '../types';
import { api } from './api';

export interface ActiveMention {
  query: string;
  start: number;
  end: number;
}

interface MentionResponse {
  files?: FileMentionInfo[];
}

export function createMentionSearch(mention: Accessor<ActiveMention | null>, projectId: Accessor<string | undefined>) {
  const [results, setResults] = createSignal<FileMentionInfo[]>([]);
  const [loading, setLoading] = createSignal(false);
  let suppressNextRequest = false;

  createEffect(() => {
    const activeMention = mention();
    const activeProjectId = projectId();
    if (!activeMention || !activeProjectId) {
      setResults([]);
      setLoading(false);
      return;
    }
    if (suppressNextRequest) {
      suppressNextRequest = false;
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams({ projectId: activeProjectId, q: activeMention.query });
      api<MentionResponse>(`/api/fs/files?${query}`, { signal: controller.signal })
        .then((data) => setResults(data.files || []))
        .catch((error) => {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          setResults([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 120);

    onCleanup(() => {
      clearTimeout(timer);
      controller.abort();
    });
  });

  return {
    results,
    loading,
    clear: () => setResults([]),
    suppressNext: () => { suppressNextRequest = true; },
  };
}
