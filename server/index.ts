import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { HOST, PORT, ALLOWED_HOSTS } from "./config.ts";
import { createRouter } from "./routes.ts";
import { startEvictionTimer } from "./runtimes.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, "../dist");

const app = express();
app.use(express.json({ limit: '25mb' }));

// Reject requests whose Host header isn't local (defends against DNS rebinding).
app.use((req, res, next) => {
  const host = (req.headers.host || "").replace(/:\d+$/, "");
  if (!ALLOWED_HOSTS.has(host)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
});

app.use(createRouter());

// In production/local-preview mode, serve the built frontend from the same
// origin as the API. This lets /sw.js register correctly and keeps frontend
// fetch('/api/...') calls on the backend server without a separate proxy.
app.use(express.static(distDir));

// SPA fallback: non-API routes should load the frontend entry point so client
// routing keeps working on refresh. API routes are mounted above, so missing
// /api paths still return the router's 404/response instead of index.html.
app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

startEvictionTimer();

app.listen(PORT, HOST, () => {
  console.log(`Backend server listening on http://${HOST}:${PORT}`);
});
