import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from './api';
import { createModelPreferences } from './modelPreferences';

vi.mock('./api', () => ({
  api: vi.fn(async () => ({ models: [
    { id: 'flash', provider: 'test' },
    { id: 'large', provider: 'test' },
  ] })),
}));

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); localStorage.clear(); vi.clearAllMocks(); });

async function setup(initialSession?: string) {
  const state = createRoot((cleanup) => {
    dispose = cleanup;
    const [session, setSession] = createSignal(initialSession);
    return { ...createModelPreferences(session), setSession };
  });
  await state.loadModels();
  if (initialSession) state.restoreSessionModel(initialSession, 'test/flash', 'medium');
  return state;
}

it('restores each session selection, including unsent changes and after remounting', async () => {
  const state = await setup('a');
  await state.selectModel('test/large');
  state.setSession('b');
  await state.selectModel('test/flash');
  state.setSession('a');
  expect(state.selectedModel()).toBe('test/large');
  state.setSession('b');
  expect(state.selectedModel()).toBe('test/flash');
  dispose?.();
  expect(api).toHaveBeenCalledWith('/api/sessions/a/model', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ modelId: 'test/large', thinkingLevel: 'medium' }) }));
  const restored = await setup('a');
  restored.restoreSessionModel('a', 'test/large');
  expect(restored.selectedModel()).toBe('test/large');
});

it('attaches the submitted model to a new session and keeps a default for new chats', async () => {
  const state = await setup();
  await state.selectModel('test/large');
  state.rememberSessionModel('created', state.selectedModel());
  state.setSession('created');
  state.setSession('other');
  await state.selectModel('test/flash');
  state.setSession('created');
  expect(state.selectedModel()).toBe('test/large');
  state.setSession(undefined);
  expect(state.selectedModel()).toBe('test/large');
});

it('falls back to an available model when the saved model was removed', async () => {
  const state = await setup('a');
  state.restoreSessionModel('a', 'test/removed');
  expect(state.selectedModel()).toBe('test/flash');
});

it('ignores a late snapshot while a model selection is being saved', async () => {
  const state = await setup('a');
  let finish!: () => void;
  vi.mocked(api).mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve({}); }));
  const saving = state.selectModel('test/large');
  state.restoreSessionModel('a', 'test/flash');
  expect(state.selectedModel()).toBe('test/large');
  await Promise.resolve();
  await Promise.resolve();
  finish();
  await saving;
});

it('restores the prior selection when saving fails', async () => {
  const state = await setup('a');
  state.restoreSessionModel('a', 'test/flash');
  vi.mocked(api).mockRejectedValueOnce(new Error('Save failed'));
  await expect(state.selectModel('test/large')).rejects.toThrow('Save failed');
  expect(state.selectedModel()).toBe('test/flash');
});

it('restores effort and model independently for each session and after a fresh mount', async () => {
  const state = await setup('a');
  await state.selectModel('test/large');
  await state.selectThinkingLevel('high');
  state.setSession('b');
  expect(state.preferencesReady()).toBe(false);
  expect(state.selectedModel()).toBe('');
  state.restoreSessionModel('b', 'test/flash', 'low');
  expect(state.selectedThinkingLevel()).toBe('low');
  await state.selectThinkingLevel('minimal');
  state.setSession('a');
  state.restoreSessionModel('a', 'test/large', 'high');
  expect(state.selectedModel()).toBe('test/large');
  expect(state.selectedThinkingLevel()).toBe('high');
  dispose?.();
  localStorage.clear();
  const fresh = await setup('b');
  fresh.restoreSessionModel('b', 'test/flash', 'minimal');
  expect(fresh.selectedThinkingLevel()).toBe('minimal');
  expect(fresh.selectedModel()).toBe('test/flash');
});
