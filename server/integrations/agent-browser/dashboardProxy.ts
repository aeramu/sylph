import type { RequestHandler } from "express";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import httpProxy from "http-proxy";
import { AGENT_BROWSER_DASHBOARD_URL } from "./dashboard.ts";

export const AGENT_BROWSER_DASHBOARD_PATH = "/browser";

const DASHBOARD_BUILD_ORIGIN = "http://localhost:4848";
const DASHBOARD_ROOT_PATHS = [
  "/_next/",
  "/api/",
  "/favicon.ico",
  "/lightpanda.svg",
  "/providers/",
];
const REWRITABLE_CONTENT_TYPES = [
  "application/javascript",
  "text/javascript",
  "text/css",
  "text/html",
];

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value?.split(",")[0];
  return first?.trim() || undefined;
}

function requestOrigin(req: IncomingMessage): string {
  const protocol = firstHeaderValue(req.headers["x-forwarded-proto"])
    || ((req.socket as typeof req.socket & { encrypted?: boolean }).encrypted ? "https" : "http");
  const host = firstHeaderValue(req.headers["x-forwarded-host"])
    || firstHeaderValue(req.headers.host)
    || "localhost";

  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return "http://localhost";
  }
}

export function stripAgentBrowserDashboardPath(url = "/"): string {
  if (url === AGENT_BROWSER_DASHBOARD_PATH) return "/";
  if (url.startsWith(`${AGENT_BROWSER_DASHBOARD_PATH}/`)) {
    return url.slice(AGENT_BROWSER_DASHBOARD_PATH.length) || "/";
  }
  return url;
}

export function rewriteAgentBrowserDashboardAsset(body: Buffer, publicOrigin: string): Buffer {
  let source = body.toString("utf8").replaceAll(DASHBOARD_BUILD_ORIGIN, publicOrigin);
  for (const rootPath of DASHBOARD_ROOT_PATHS) {
    source = source.replaceAll(rootPath, `${AGENT_BROWSER_DASHBOARD_PATH}${rootPath}`);
  }
  return Buffer.from(source, "utf8");
}

export interface AgentBrowserDashboardProxy {
  middleware: RequestHandler;
  handleUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
}

/**
 * Mount the loopback-only dashboard under /browser on Sylph's own HTTP server.
 * Dashboard assets use root-relative URLs, so textual assets are rewritten to
 * keep assets, API requests, and WebSocket streams inside that path prefix.
 */
export function createAgentBrowserDashboardProxy(): AgentBrowserDashboardProxy {
  const proxy = httpProxy.createProxyServer({
    target: AGENT_BROWSER_DASHBOARD_URL,
    ws: true,
    selfHandleResponse: true,
  });

  proxy.on("proxyReq", (proxyReq) => {
    // The embedded server currently sends uncompressed assets. Keep that
    // invariant explicit so textual path rewriting remains byte-safe.
    proxyReq.removeHeader("accept-encoding");
  });

  proxy.on("proxyRes", (proxyRes, req, res) => {
    const response = res as ServerResponse;
    const contentType = String(proxyRes.headers["content-type"] || "").toLowerCase();
    const shouldRewrite = REWRITABLE_CONTENT_TYPES.some((type) => contentType.includes(type));

    if (!shouldRewrite) {
      response.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(response);
      return;
    }

    const chunks: Buffer[] = [];
    proxyRes.on("data", (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    proxyRes.on("end", () => {
      const body = rewriteAgentBrowserDashboardAsset(Buffer.concat(chunks), requestOrigin(req));
      const headers = { ...proxyRes.headers, "content-length": String(body.length) };
      delete headers["transfer-encoding"];
      response.writeHead(proxyRes.statusCode || 502, headers);
      response.end(body);
    });
    proxyRes.on("error", () => {
      if (!response.headersSent) response.writeHead(502);
      response.end("Agent Browser dashboard proxy failed.");
    });
  });

  proxy.on("error", (error, _req, target) => {
    if (target && "writeHead" in target) {
      const response = target as ServerResponse;
      if (!response.headersSent) response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      response.end(`Agent Browser dashboard is unavailable: ${error.message}`);
      return;
    }
    if (target && "destroy" in target) target.destroy();
  });

  const middleware: RequestHandler = (req, res, next) => {
    const pathname = req.path;
    if (pathname !== AGENT_BROWSER_DASHBOARD_PATH && !pathname.startsWith(`${AGENT_BROWSER_DASHBOARD_PATH}/`)) {
      next();
      return;
    }

    if (pathname === AGENT_BROWSER_DASHBOARD_PATH) {
      const query = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
      res.redirect(308, `${AGENT_BROWSER_DASHBOARD_PATH}/${query}`);
      return;
    }

    req.url = stripAgentBrowserDashboardPath(req.url);
    proxy.web(req, res);
  };

  const handleUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const pathname = (req.url || "/").split("?", 1)[0];
    if (!pathname.startsWith(`${AGENT_BROWSER_DASHBOARD_PATH}/`)) return;
    req.url = stripAgentBrowserDashboardPath(req.url);
    proxy.ws(req, socket, head);
  };

  return { middleware, handleUpgrade };
}
