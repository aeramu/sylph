import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { Show } from 'solid-js';
import { createOAuthFlow } from './createOAuthFlow';
import { getOAuthFlow, startApiKeyLogin } from './api';

vi.mock('./api', () => ({
  startApiKeyLogin: vi.fn(), startOAuth: vi.fn(),
  getOAuthFlow: vi.fn(), respondOAuthFlow: vi.fn(), cancelOAuthFlow: vi.fn().mockResolvedValue({ ok: true }),
}));

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.useRealTimers(); vi.clearAllMocks(); });

it('preserves prompt focus and selection across polling and progress updates', async () => {
  vi.useFakeTimers();
  vi.mocked(startApiKeyLogin).mockResolvedValue({ id: 'login' });
  let polls = 0;
  vi.mocked(getOAuthFlow).mockImplementation(async () => ({
    id: 'login', provider: 'omniroute', status: 'pending', progress: [],
    step: { type: 'prompt', message: 'Server URL', secret: false, progress: [`poll ${++polls}`] },
  }) as any);
  const host = document.createElement('div'); document.body.append(host);
  let login!: ReturnType<typeof createOAuthFlow>;
  dispose = render(() => {
    login = createOAuthFlow({
      provider: () => ({ id: 'omniroute', name: 'OmniRoute', authType: 'api_key', configured: false, stored: false }),
      onMessage: () => {}, onProvidersChanged: async () => {},
    });
    return <Show when={login.flow()?.step} keyed>{step => <div>
      <input value={login.input()} onInput={e => login.setInput(e.currentTarget.value)} />
      <span>{step.progress.join(',')}</span>
    </div>}</Show>;
  }, host);
  await login.start('api_key');
  const input = host.querySelector('input')!;
  input.focus();
  await vi.advanceTimersByTimeAsync(1000);
  expect(document.activeElement).toBe(input);
  input.value = 'http://localhost'; input.dispatchEvent(new Event('input', { bubbles: true }));
  input.setSelectionRange(5, 9);
  await vi.advanceTimersByTimeAsync(2000);
  expect(host.querySelector('input')).toBe(input);
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe('http://localhost');
  expect([input.selectionStart, input.selectionEnd]).toEqual([5, 9]);
  expect(host.querySelector('span')?.textContent).toBe('poll 4');
});
