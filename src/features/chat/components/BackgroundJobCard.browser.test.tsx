import { render } from 'solid-js/web';
import { page, userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BackgroundJobCard from './BackgroundJobCard';

let dispose: (() => void) | undefined;

function mount(component: () => any) {
  const host = document.createElement('div');
  document.body.append(host);
  dispose = render(component, host);
}

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function mockLogs(text = 'build passed') {
  const fetch = vi.fn(async () => new Response(JSON.stringify({
    job: { id: 'bg-1', name: 'Build', status: 'completed' },
    text,
    bytesRead: text.length,
    totalBytes: text.length,
    truncated: false,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('BackgroundJobCard', () => {
  it('keeps successful output lazy and reveals logs on demand', async () => {
    const fetch = mockLogs();
    mount(() => <BackgroundJobCard sessionId="session-a" jobs={[{
      id: 'bg-1', name: 'Build', command: 'npm run build', cwd: '/workspace',
      status: 'completed', startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:00:03.000Z',
      exitCode: 0, outputBytes: 12,
    }]} />);

    await expect.element(page.getByText('Build', { exact: true })).toBeInTheDocument();
    await expect.element(page.getByText('Completed')).toBeInTheDocument();
    await expect.element(page.getByText('3s · exit 0')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();

    await userEvent.click(page.getByRole('button', { name: 'View logs' }));
    await expect.element(page.getByText('build passed')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      '/api/sessions/session-a/background-jobs/bg-1/logs?maxBytes=20480',
      { cache: 'no-store' },
    );
  });

  it('opens failures automatically and groups batched completions', async () => {
    mockLogs('compiler error');
    mount(() => <BackgroundJobCard sessionId="session-a" jobs={[
      { id: 'bg-1', name: 'Build', status: 'failed', exitCode: 2, error: 'Build failed' },
      { id: 'bg-2', name: 'Lint', status: 'completed', exitCode: 0 },
    ]} />);

    await expect.element(page.getByRole('button', { name: '2 background jobs finished' })).toHaveAttribute('aria-expanded', 'true');
    await expect.element(page.getByText('Build failed')).toBeInTheDocument();
    await expect.element(page.getByText('compiler error')).toBeInTheDocument();
    await expect.element(page.getByText('Lint', { exact: true })).toBeInTheDocument();
  });
});
