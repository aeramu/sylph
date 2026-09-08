import { batch, createEffect, createMemo, createSignal } from 'solid-js';
import type { ModelOption, ThinkingLevel } from '../types';
import { THINKING_LEVELS } from '../types';
import { api } from './api';

interface ModelsResponse {
  models?: Array<{
    id: string;
    provider?: string;
    value?: string;
    reasoning?: boolean;
    thinkingLevels?: unknown[];
  }>;
}

export function createModelPreferences(sessionId: () => string | undefined = () => undefined) {
  const [models, setModels] = createSignal<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = createSignal('');
  const [selectedThinkingLevel, setSelectedThinkingLevel] = createSignal<ThinkingLevel>('medium');
  const sessionModels = new Map<string, string>();
  const sessionEfforts = new Map<string, ThinkingLevel>();
  const loadedSessions = new Set<string>();
  const [sessionRevision, setSessionRevision] = createSignal(0);
  const pendingSaves = new Map<string, Promise<void>>();
  const rememberSessionModel = (id: string, model: string, effort?: ThinkingLevel) => {
    if (!model) return;
    sessionModels.set(id, model);
    if (effort) sessionEfforts.set(id, effort);
    loadedSessions.add(id);
    setSessionRevision((value) => value + 1);
  };

  try {
    const saved = localStorage.getItem('sylph.thinkingLevel') as ThinkingLevel | null;
    if (saved && THINKING_LEVELS.some((level) => level.value === saved)) setSelectedThinkingLevel(saved);
  } catch {}

  const loadModels = async () => {
    const data = await api<ModelsResponse>('/api/models');
    const mapped = (data.models || []).map((model): ModelOption => {
      const value = model.value || `${model.provider}/${model.id}`;
      const provider = model.provider || value.split('/')[0] || 'Other';
      const thinkingLevels = Array.isArray(model.thinkingLevels)
        ? model.thinkingLevels.filter((level): level is ThinkingLevel =>
            typeof level === 'string' && THINKING_LEVELS.some((option) => option.value === level))
        : undefined;
      return {
        value,
        label: model.id,
        provider,
        searchText: `${provider} ${model.id} ${value}`,
        reasoning: !!model.reasoning,
        thinkingLevels,
      };
    });
    setModels(mapped);
  };

  createEffect(() => {
    sessionRevision();
    const id = sessionId();
    const mapped = models();
    if (!mapped.length) return;
    let saved = id ? sessionModels.get(id) : undefined;
    try {
      if (!id) saved ||= localStorage.getItem('sylph.selectedModel') || undefined;
    } catch {}
    const initial = (saved && mapped.find((model) => model.value === saved))
      || mapped.find((model) => model.value.toLowerCase().includes('flash'))
      || mapped[0];
    let effort = id ? sessionEfforts.get(id) : undefined;
    if (!id) {
      try { effort = localStorage.getItem('sylph.thinkingLevel') as ThinkingLevel | undefined; } catch {}
    }
    batch(() => {
      setSelectedModel(id && !loadedSessions.has(id) ? '' : initial?.value ?? '');
      setSelectedThinkingLevel(THINKING_LEVELS.some((option) => option.value === effort) ? effort! : 'medium');
    });
  });

  const restoreSessionModel = (id: string, model?: string, effort?: ThinkingLevel) => {
    if (!pendingSaves.has(id)) {
      loadedSessions.add(id);
      if (effort) sessionEfforts.set(id, effort);
      if (model) sessionModels.set(id, model);
      setSessionRevision((value) => value + 1);
    }
  };

  const preferencesReady = createMemo(() => {
    sessionRevision();
    const id = sessionId();
    return !id || loadedSessions.has(id);
  });

  const savePreferences = async (model: string, effort: ThinkingLevel) => {
    const activeSession = sessionId();
    const previousModel = selectedModel();
    const previousEffort = selectedThinkingLevel();
    batch(() => { setSelectedModel(model); setSelectedThinkingLevel(effort); });
    if (!activeSession) {
      try {
        localStorage.setItem('sylph.selectedModel', model);
        localStorage.setItem('sylph.thinkingLevel', effort);
      } catch {}
      return;
    }
    rememberSessionModel(activeSession, model, effort);
    const save = (pendingSaves.get(activeSession) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const result = await api<{ modelId: string; thinkingLevel: ThinkingLevel }>(`/api/sessions/${encodeURIComponent(activeSession)}/model`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: model, thinkingLevel: effort }),
      });
      if (pendingSaves.get(activeSession) === save && result?.modelId) {
        rememberSessionModel(activeSession, result.modelId, result.thinkingLevel);
      }
    });
    pendingSaves.set(activeSession, save);
    try {
      await save;
    } catch (error) {
      if (pendingSaves.get(activeSession) === save) rememberSessionModel(activeSession, previousModel, previousEffort);
      throw error;
    } finally {
      if (pendingSaves.get(activeSession) === save) pendingSaves.delete(activeSession);
    }
  };
  const selectModel = (model: string) => savePreferences(model, selectedThinkingLevel());
  const selectThinkingLevel = (level: ThinkingLevel) => savePreferences(selectedModel(), level);
  const waitForPreferenceSave = () => {
    const id = sessionId();
    return id ? pendingSaves.get(id) : undefined;
  };

  const availableThinkingLevels = createMemo<ThinkingLevel[]>(() => {
    const model = models().find((option) => option.value === selectedModel());
    return model?.thinkingLevels?.length
      ? model.thinkingLevels
      : THINKING_LEVELS.map((option) => option.value);
  });

  const thinkingLevelOptions = createMemo(() => {
    const available = new Set(availableThinkingLevels());
    return THINKING_LEVELS.filter((option) => available.has(option.value));
  });

  createEffect(() => {
    const available = availableThinkingLevels();
    const selected = selectedThinkingLevel();
    if (available.includes(selected)) return;

    const ordered = THINKING_LEVELS.map((option) => option.value);
    const requestedIndex = ordered.indexOf(selected);
    const stronger = ordered.slice(requestedIndex + 1).find((level) => available.includes(level));
    const weaker = ordered.slice(0, requestedIndex).reverse().find((level) => available.includes(level));
    setSelectedThinkingLevel(stronger ?? weaker ?? available[0] ?? 'off');
  });

  return {
    models,
    preferencesReady,
    waitForPreferenceSave,
    selectedModel,
    selectedThinkingLevel,
    thinkingLevelOptions,
    loadModels,
    selectModel,
    rememberSessionModel,
    restoreSessionModel,
    selectThinkingLevel,
  };
}
