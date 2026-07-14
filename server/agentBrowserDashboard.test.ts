import { afterEach, describe, expect, it, vi } from 'vitest';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('agent-browser dashboard status', () => {
  it('reports an embedded dashboard as available', async () => {
    globalThis.fetch = vi.fn(async () => new Response('<!doctype html><html></html>', { status: 200 })) as any;
    const { getAgentBrowserDashboardStatus } = await import('./agentBrowserDashboard.ts');

    await expect(getAgentBrowserDashboardStatus()).resolves.toMatchObject({
      available: true,
      running: true,
      url: 'http://127.0.0.1:4848',
    });
  });

  it('recognizes binaries built without dashboard assets', async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      '<p>Dashboard not built. Run: cd packages/dashboard &amp;&amp; pnpm build</p>',
      { status: 200 },
    )) as any;
    const { getAgentBrowserDashboardStatus } = await import('./agentBrowserDashboard.ts');

    await expect(getAgentBrowserDashboardStatus()).resolves.toMatchObject({
      available: false,
      running: true,
      error: expect.stringContaining('does not include the dashboard bundle'),
    });
  });

  it('reports a stopped dashboard without throwing', async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError('fetch failed'); }) as any;
    const { getAgentBrowserDashboardStatus } = await import('./agentBrowserDashboard.ts');

    await expect(getAgentBrowserDashboardStatus()).resolves.toMatchObject({
      available: false,
      running: false,
      error: expect.stringContaining('not responding'),
    });
  });
});
