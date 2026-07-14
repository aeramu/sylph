import { execFile } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export const AGENT_BROWSER_DASHBOARD_PORT = Number(process.env.AGENT_BROWSER_DASHBOARD_PORT) || 4848;
export const AGENT_BROWSER_DASHBOARD_URL = process.env.AGENT_BROWSER_DASHBOARD_URL
  || `http://127.0.0.1:${AGENT_BROWSER_DASHBOARD_PORT}`;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Prefer the project dependency: unlike some source-built system packages,
// the npm release includes the dashboard assets embedded in its native binary.
const LOCAL_AGENT_BROWSER_BIN = path.resolve(__dirname, "../node_modules/.bin/agent-browser");
const AGENT_BROWSER_BIN = process.env.AGENT_BROWSER_BIN || LOCAL_AGENT_BROWSER_BIN;

export interface AgentBrowserDashboardStatus {
  available: boolean;
  running: boolean;
  url: string;
  error?: string;
}

let startPromise: Promise<AgentBrowserDashboardStatus> | null = null;

async function probeDashboard(): Promise<AgentBrowserDashboardStatus> {
  try {
    const response = await fetch(`${AGENT_BROWSER_DASHBOARD_URL}/`, {
      signal: AbortSignal.timeout(1_500),
    });
    const body = await response.text();
    if (!response.ok) {
      return {
        available: false,
        running: true,
        url: AGENT_BROWSER_DASHBOARD_URL,
        error: `Dashboard returned HTTP ${response.status}.`,
      };
    }
    if (body.includes("Dashboard not built")) {
      return {
        available: false,
        running: true,
        url: AGENT_BROWSER_DASHBOARD_URL,
        error: "The installed agent-browser package does not include the dashboard bundle. Upgrade agent-browser and restart Sylph.",
      };
    }
    return { available: true, running: true, url: AGENT_BROWSER_DASHBOARD_URL };
  } catch {
    return {
      available: false,
      running: false,
      url: AGENT_BROWSER_DASHBOARD_URL,
      error: `Dashboard is not responding on port ${AGENT_BROWSER_DASHBOARD_PORT}.`,
    };
  }
}

export async function getAgentBrowserDashboardStatus(): Promise<AgentBrowserDashboardStatus> {
  return probeDashboard();
}

export function startAgentBrowserDashboard(): Promise<AgentBrowserDashboardStatus> {
  if (startPromise) return startPromise;

  startPromise = (async () => {
    const existing = await probeDashboard();
    if (existing.available) return existing;

    try {
      // A system-installed binary may already own the port while lacking the
      // embedded frontend assets. Stop it before launching the known-good
      // project dependency.
      if (existing.running) {
        await execFileAsync(AGENT_BROWSER_BIN, ["dashboard", "stop"], { timeout: 10_000 }).catch(() => undefined);
      }
      const { stdout, stderr } = await execFileAsync(
        AGENT_BROWSER_BIN,
        ["dashboard", "start", "--port", String(AGENT_BROWSER_DASHBOARD_PORT)],
        { timeout: 10_000 },
      );
      const output = `${stdout || ""}${stderr || ""}`.trim();
      if (output) console.log(`[agent-browser] ${output}`);
    } catch (error: any) {
      const message = error?.code === "ENOENT"
        ? "agent-browser is not installed or is not on PATH."
        : (error?.stderr || error?.message || "Failed to start agent-browser dashboard.").trim();
      return {
        available: false,
        running: false,
        url: AGENT_BROWSER_DASHBOARD_URL,
        error: message,
      };
    }

    // The command launches the dashboard as a background process. Give the
    // listener a short window to bind before reporting its final status.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const status = await probeDashboard();
      if (status.running) return status;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return probeDashboard();
  })().finally(() => {
    startPromise = null;
  });

  return startPromise;
}
