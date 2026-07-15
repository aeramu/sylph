import { describe, expect, it } from "vitest";
import {
  rewriteAgentBrowserDashboardAsset,
  stripAgentBrowserDashboardPath,
} from "./agentBrowserDashboardProxy.ts";

describe("agent-browser dashboard proxy", () => {
  it("strips the public path before proxying to the dashboard", () => {
    expect(stripAgentBrowserDashboardPath("/browser/")).toBe("/");
    expect(stripAgentBrowserDashboardPath("/browser/api/sessions?active=1")).toBe("/api/sessions?active=1");
    expect(stripAgentBrowserDashboardPath("/api/sessions")).toBe("/api/sessions");
  });

  it("rewrites dashboard root paths under /browser", () => {
    const source = Buffer.from([
      '<script src="/_next/static/app.js"></script>',
      'fetch("/api/sessions")',
      'new WebSocket(`${protocol}//${window.location.host}/api/session/${port}/stream`)',
      '<link rel="icon" href="/favicon.ico">',
    ].join("\n"));

    expect(rewriteAgentBrowserDashboardAsset(source, "https://server.example").toString()).toBe([
      '<script src="/browser/_next/static/app.js"></script>',
      'fetch("/browser/api/sessions")',
      'new WebSocket(`${protocol}//${window.location.host}/browser/api/session/${port}/stream`)',
      '<link rel="icon" href="/browser/favicon.ico">',
    ].join("\n"));
  });

  it("rewrites the dashboard's build-time localhost origin to the public origin", () => {
    const source = Buffer.from(
      'let daemon="http://localhost:4848"; fetch(`${daemon}/api/chat`);',
    );

    expect(rewriteAgentBrowserDashboardAsset(source, "https://server.example").toString()).toBe(
      'let daemon="https://server.example"; fetch(`${daemon}/browser/api/chat`);',
    );
  });

  it("leaves unrelated asset content unchanged", () => {
    const source = Buffer.from("console.log('dashboard')");
    expect(rewriteAgentBrowserDashboardAsset(source, "http://server").toString()).toBe(source.toString());
  });
});
