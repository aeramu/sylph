import fs from "fs";
import path from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

// Mirror of pi's stripJsonComments (not exported from the package): strip `//`
// line comments and trailing commas while leaving string literals untouched,
// so we accept exactly the same models.json files pi does.
export function stripJsonComments(input: string) {
  return input
    .replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*/g, (m) => (m[0] === '"' ? m : ""))
    .replace(/"(?:\\.|[^"\\])*"|,(\s*[}\]])/g, (m, tail) => tail ?? (m[0] === '"' ? m : ""));
}

export function readModelsJson(): any {
  const modelsPath = path.join(getAgentDir(), "models.json");
  if (!fs.existsSync(modelsPath)) return { providers: {} };
  const text = fs.readFileSync(modelsPath, "utf8");
  const parsed = JSON.parse(stripJsonComments(text));
  if (!parsed.providers || typeof parsed.providers !== "object") parsed.providers = {};
  return parsed;
}

export function writeModelsJson(config: any) {
  const modelsPath = path.join(getAgentDir(), "models.json");
  fs.mkdirSync(path.dirname(modelsPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(modelsPath, JSON.stringify(config, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  try { fs.chmodSync(modelsPath, 0o600); } catch { /* ignore chmod failures */ }
}
