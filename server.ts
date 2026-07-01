import express from "express";
import fs from "fs";
import path from "path";
import os from "os";
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

const SYLPH_DIR = path.join(os.homedir(), '.sylph');
const PROJECTS_FILE = path.join(SYLPH_DIR, 'projects.json');

if (!fs.existsSync(SYLPH_DIR)) {
  fs.mkdirSync(SYLPH_DIR, { recursive: true });
}
if (!fs.existsSync(PROJECTS_FILE)) {
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify([]));
}

interface Project {
  id: string;
  name: string;
  path: string;
}

function getProjects(): Project[] {
  try {
    return JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveProjects(projects: Project[]) {
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));
}

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

const activeRuntimes = new Map<string, any>();
const clients: Set<express.Response> = new Set();

async function getOrInitRuntime(sessionId?: string, projectId?: string) {
  if (sessionId && activeRuntimes.has(sessionId)) {
    return activeRuntimes.get(sessionId);
  }

  let sessionManager;
  const projects = getProjects();
  let targetCwd = process.cwd();

  if (sessionId) {
    let found = false;
    for (const proj of projects) {
      if (!fs.existsSync(proj.path)) continue;
      try {
        const sessions = await SessionManager.list(proj.path);
        const sessionInfo = sessions.find((s) => s.id === sessionId);
        if (sessionInfo) {
          sessionManager = SessionManager.open(sessionInfo.path);
          targetCwd = proj.path;
          found = true;
          break;
        }
      } catch (e) {}
    }
    if (!found) {
      try {
        const sessions = await SessionManager.list(process.cwd());
        const sessionInfo = sessions.find((s) => s.id === sessionId);
        if (sessionInfo) {
          sessionManager = SessionManager.open(sessionInfo.path);
        } else {
          throw new Error(`Session ${sessionId} not found in any project`);
        }
      } catch {
        throw new Error(`Session ${sessionId} not found in any project`);
      }
    }
  } else {
    // New session
    if (projectId) {
      const proj = projects.find(p => p.id === projectId);
      if (proj) {
        targetCwd = proj.path;
      }
    }
    sessionManager = SessionManager.create(targetCwd);
  }

  const runtime = await createAgentSessionRuntime(createRuntime, {
    cwd: targetCwd,
    agentDir: getAgentDir(),
    sessionManager,
  });

  const session = runtime.session;
  await session.bindExtensions({});
  
  // Broadcast event to all SSE clients with sessionId injected
  session.subscribe((event: AgentSessionEvent) => {
    const payload = {
      sessionId: sessionManager.getSessionId(),
      ...event
    };
    const data = JSON.stringify(payload);
    for (const client of clients) {
      client.write(`data: ${data}\n\n`);
    }
  });

  const resolvedSessionId = sessionManager.getSessionId();
  activeRuntimes.set(resolvedSessionId, runtime);
  return runtime;
}

app.get("/api/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  res.write(`data: ${JSON.stringify({ type: "connection_established" })}\n\n`);

  const keepAlive = setInterval(() => {
    res.write(": keepalive\n\n");
  }, 15000);

  clients.add(res);
  
  req.on("close", () => {
    clients.delete(res);
    clearInterval(keepAlive);
  });
});

app.get("/api/projects", (req, res) => {
  res.json({ projects: getProjects() });
});

app.post("/api/projects", (req, res) => {
  const { path: dirPath, name } = req.body;
  if (!dirPath || !fs.existsSync(dirPath)) {
    return res.status(400).json({ error: "Invalid path" });
  }
  const projects = getProjects();
  const newProj: Project = {
    id: "proj-" + Date.now().toString(),
    name: name || path.basename(dirPath),
    path: dirPath
  };
  projects.push(newProj);
  saveProjects(projects);
  res.json(newProj);
});

app.delete("/api/projects/:id", (req, res) => {
  const projects = getProjects();
  const filtered = projects.filter(p => p.id !== req.params.id);
  saveProjects(filtered);
  res.json({ success: true });
});

app.get("/api/fs/list", async (req, res) => {
  try {
    const dirPath = (req.query.path as string) || os.homedir();
    if (!fs.existsSync(dirPath)) {
      return res.status(404).json({ error: "Directory not found" });
    }
    
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    const directories = entries
      .filter(dirent => dirent.isDirectory() && !dirent.name.startsWith('.'))
      .map(dirent => ({
        name: dirent.name,
        path: path.join(dirPath, dirent.name)
      }));
      
    directories.sort((a, b) => a.name.localeCompare(b.name));
    
    res.json({ directories, currentPath: dirPath });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/sessions", async (req, res) => {
  try {
    const projectId = req.query.project_id as string;
    let targetDir = process.cwd();
    
    if (projectId) {
      const projects = getProjects();
      const proj = projects.find(p => p.id === projectId);
      if (proj) {
        targetDir = proj.path;
      } else {
        return res.status(404).json({ error: "Project not found" });
      }
    }

    if (!fs.existsSync(targetDir)) {
       return res.json({ sessions: [] });
    }

    const sessions = await SessionManager.list(targetDir);
    sessions.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
    res.json({ sessions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/history", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  if (!sessionId) {
    return res.json({ messages: [] });
  }
  try {
    const runtime = await getOrInitRuntime(sessionId);
    res.json({ messages: runtime.session.messages || [] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/commands", async (req, res) => {
  try {
    const projects = getProjects();
    const firstProjId = projects.length > 0 ? projects[0].id : undefined;
    const runtime = await getOrInitRuntime(undefined, firstProjId);
    
    const session = runtime.session as any;
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
  try {
    const projects = getProjects();
    const firstProjId = projects.length > 0 ? projects[0].id : undefined;
    const runtime = await getOrInitRuntime(undefined, firstProjId);
    const session = runtime.session as any;
    
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
  const { prompt, sessionId, project_id } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: "Prompt is required" });
  }

  try {
    const runtime = await getOrInitRuntime(sessionId, project_id);
    const resolvedSessionId = runtime.session.sessionId;
    
    // Find the projectId based on the runtime's cwd
    const projects = getProjects();
    const resolvedProject = projects.find(p => p.path === runtime.session.cwd);
    const resolvedProjectId = resolvedProject ? resolvedProject.id : undefined;
    
    if (runtime.session.isStreaming) {
      runtime.session.steer(prompt).catch((err: any) => {
        console.error("Prompt error:", err);
      });
    } else {
      runtime.session.prompt(prompt).catch((err: any) => {
        console.error("Prompt error:", err);
      });
    }

    res.json({ success: true, sessionId: resolvedSessionId, projectId: resolvedProjectId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Backend server listening on port ${PORT}`);
});
