import path from "path";
import { fileURLToPath } from "url";
import { createApp } from "./app.ts";
import { HOST, PORT } from "./config.ts";
import { startEvictionTimer } from "./runtime/index.ts";
import { startAgentBrowserDashboard } from "./agentBrowserDashboard.ts";
import { createAgentBrowserDashboardProxy } from "./agentBrowserDashboardProxy.ts";

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
server.on("upgrade", dashboardProxy.handleUpgrade);
