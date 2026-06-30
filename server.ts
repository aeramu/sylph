import express from "express";
import {
  createAgentSessionRuntime,
  createAgentSessionServices,
  createAgentSessionFromServices,
  getAgentDir,
  SessionManager,
  type CreateAgentSessionRuntimeFactory,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";

const app = express();
app.use(express.json());

const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
  const services = await createAgentSessionServices({ cwd });
  return {
    ...(await createAgentSessionFromServices({
      services,
      sessionManager,
      sessionStartEvent,
    })),
    services,
    diagnostics: services.diagnostics,
  };
};

let runtime: any = null;
let currentSession: any = null;
let sessionUnsubscribe: (() => void) | undefined;
const clients: Set<express.Response> = new Set();

async function initAgent() {
  runtime = await createAgentSessionRuntime(createRuntime, {
    cwd: process.cwd(),
    agentDir: getAgentDir(),
    sessionManager: SessionManager.create(process.cwd()),
  });

  currentSession = await bindSession();
  console.log("Pi Agent Session Initialized:", currentSession.sessionFile);
}

async function bindSession() {
  sessionUnsubscribe?.();
  const session = runtime.session;
  await session.bindExtensions({});
  sessionUnsubscribe = session.subscribe((event: AgentSessionEvent) => {
    // Broadcast event to all SSE clients
    const data = JSON.stringify(event);
    for (const client of clients) {
      client.write(`data: ${data}\n\n`);
    }
  });
  return session;
}

// Ensure the agent is initialized before processing requests
let initPromise = initAgent();

app.get("/api/stream", async (req, res) => {
  await initPromise;
  
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // Send an initial event to let the client know we are connected
  res.write(`data: ${JSON.stringify({ type: "connection_established" })}\n\n`);

  // Keep connection alive
  const keepAlive = setInterval(() => {
    res.write(": keepalive\n\n");
  }, 15000);

  clients.add(res);
  
  req.on("close", () => {
    clients.delete(res);
    clearInterval(keepAlive);
  });
});

app.get("/api/history", (req, res) => {
  res.json({ messages: currentSession.messages || [] });
});

app.get("/api/commands", async (req, res) => {
  await initPromise;
  try {
    const session = currentSession as any;
    const extensionCommands = session.extensionRunner.getRegisteredCommands().map((c: any) => ({
      name: c.invocationName,
      description: c.description,
      source: "extension",
    }));
    const templates = (session.promptTemplates || []).map((t: any) => ({
      name: t.name,
      description: t.description,
      source: "prompt",
    }));
    const skills = (session._resourceLoader?.getSkills()?.skills || []).map((s: any) => ({
      name: `skill:${s.name}`,
      description: s.description,
      source: "skill",
    }));
    
    res.json({ commands: [...extensionCommands, ...templates, ...skills] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/resources", async (req, res) => {
  await initPromise;
  try {
    const session = currentSession as any;
    
    const extensions = (session._resourceLoader?.getExtensions()?.extensions || []).map((e: any) => {
      let name;
      const pathStr = e.path;
      
      if (pathStr.includes('node_modules/')) {
        const parts = pathStr.split('node_modules/')[1].split('/');
        let pkgName = parts[0];
        let restIndex = 1;
        if (pkgName.startsWith('@')) {
          pkgName = parts[0] + '/' + parts[1];
          restIndex = 2;
        }
        
        const rest = parts.slice(restIndex);
        if (rest.length === 1 && (rest[0] === 'index.ts' || rest[0] === 'index.js')) {
          name = pkgName;
        } else {
          const basename = rest[rest.length - 1];
          if (basename === 'index.ts' || basename === 'index.js') {
             name = `${pkgName}:${rest[rest.length - 2]}`;
          } else {
             name = `${pkgName}:${basename}`;
          }
        }
      } else {
        name = pathStr.split(/[\\/]/).pop();
      }
      
      return {
        name,
        source: "extension",
      };
    });
    
    const templates = (session.promptTemplates || []).map((t: any) => ({
      name: t.name,
      description: t.description,
      source: "prompt",
    }));
    
    const skills = (session._resourceLoader?.getSkills()?.skills || []).map((s: any) => ({
      name: s.name,
      description: s.description,
      source: "skill",
    }));
    
    res.json({ resources: [...extensions, ...templates, ...skills] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/chat", async (req, res) => {
  await initPromise;
  
  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: "Prompt is required" });
  }

  // Handle steer/followUp if isStreaming
  if (currentSession.isStreaming) {
    currentSession.steer(prompt).catch((err: any) => {
      console.error("Prompt error:", err);
    });
  } else {
    currentSession.prompt(prompt).catch((err: any) => {
      console.error("Prompt error:", err);
    });
  }

  res.json({ success: true });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Backend server listening on port ${PORT}`);
});
