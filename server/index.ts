import path from "path";
import { fileURLToPath } from "url";
import { createApp } from "./app.ts";
import { HOST, PORT } from "./config.ts";
import { startEvictionTimer } from "./integrations/pi/runtime/runtimeManager.ts";
import { startAgentBrowserDashboard } from "./integrations/agent-browser/dashboard.ts";
import { createAgentBrowserDashboardProxy } from "./integrations/agent-browser/dashboardProxy.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, "../dist");
const dashboardProxy = createAgentBrowserDashboardProxy();
const app = createApp({ dashboardMiddleware: dashboardProxy.middleware, distDir });

startEvictionTimer();
void startAgentBrowserDashboard().then((status) => {
  if (!status.available) console.warn(`[agent-browser] Dashboard unavailable: ${status.error}`);
});

const server = app.listen(PORT, HOST, () => {
  console.log(`Backend server listening on http://${HOST}:${PORT}`);
});
server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`[server] Port ${PORT} is already in use. Stop the process holding it (\`lsof -tiTCP:${PORT} -sTCP:LISTEN | xargs kill\`) and restart.`);
  } else {
    console.error("[server] Failed to start:", error);
  }
  process.exit(1);
});
server.on("upgrade", dashboardProxy.handleUpgrade);
