import express from "express";

export function handleError(res: express.Response, err: any) {
  console.error(err);
  res.status(500).json({ error: err?.message || "Internal error" });
}

export function extensionDisplayName(extensionOrPath: string | {
  path: string;
  tools?: Map<string, unknown>;
  commands?: Map<string, unknown>;
}): string {
  const pathStr = typeof extensionOrPath === "string" ? extensionOrPath : extensionOrPath.path;
  if (pathStr.startsWith("<inline:") && typeof extensionOrPath !== "string") {
    const toolNames = Array.from(extensionOrPath.tools?.keys() ?? []);
    if (toolNames.length === 1) return toolNames[0];
    const commandNames = Array.from(extensionOrPath.commands?.keys() ?? []);
    if (commandNames.length === 1) return commandNames[0];
  }
  if (!pathStr.includes("node_modules/")) return pathStr.split(/[\\/]/).pop() || pathStr;
  const parts = pathStr.split("node_modules/")[1].split("/");
  let pkgName = parts[0];
  let restIndex = 1;
  if (pkgName.startsWith("@")) { pkgName = parts[0] + "/" + parts[1]; restIndex = 2; }
  const rest = parts.slice(restIndex);
  if (rest.length === 1 && (rest[0] === "index.ts" || rest[0] === "index.js")) return pkgName;
  const basename = rest[rest.length - 1];
  if (basename === "index.ts" || basename === "index.js") return `${pkgName}:${rest[rest.length - 2]}`;
  return `${pkgName}:${basename}`;
}

export function getLoadedSkills(session: any) {
  return session._resourceLoader?.getSkills()?.skills || [];
}

export function getLoadedExtensions(session: any) {
  return session._resourceLoader?.getExtensions()?.extensions || [];
}

export function introspectionRoute(handler: (session: any) => unknown): express.RequestHandler {
  return async (_req, res) => {
    try {
      const { getIntrospectionRuntime } = await import("../runtime/index.ts");
      const runtime = await getIntrospectionRuntime();
      res.json(handler(runtime.session as any));
    } catch (err) { handleError(res, err); }
  };
}
