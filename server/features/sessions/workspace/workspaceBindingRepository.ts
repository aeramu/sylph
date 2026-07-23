import path from "path";
import { SESSION_BINDINGS_FILE } from "../../../config.ts";
import { JsonFileStore } from "../../../platform/filesystem/jsonFileStore.ts";
import type { SessionBinding } from "./workspaceTypes.ts";

function normalizeBindings(value: unknown): SessionBinding[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is SessionBinding => !!entry && typeof entry === "object" && typeof entry.sessionId === "string" && typeof entry.cwd === "string")
    : [];
}

const bindingStore = new JsonFileStore<SessionBinding[]>({
  filePath: SESSION_BINDINGS_FILE,
  defaultValue: () => [],
  normalize: normalizeBindings,
});

export function getSessionBindings(): SessionBinding[] {
  return bindingStore.read();
}

export function getSessionBinding(sessionId: unknown): SessionBinding | undefined {
  if (typeof sessionId !== "string") return undefined;
  return getSessionBindings().find((binding) => binding.sessionId === sessionId);
}

export function getProjectSessionBindings(projectId: unknown): SessionBinding[] {
  if (typeof projectId !== "string") return [];
  return getSessionBindings().filter((binding) => binding.projectId === projectId);
}

function writeSessionBindings(bindings: SessionBinding[]) {
  bindingStore.write(bindings);
}

export function saveSessionBinding(binding: SessionBinding) {
  const bindings = getSessionBindings();
  const index = bindings.findIndex((entry) => entry.sessionId === binding.sessionId);
  if (index >= 0) bindings[index] = binding;
  else bindings.push(binding);
  writeSessionBindings(bindings);
}

export function deleteSessionBinding(sessionId: unknown) {
  if (typeof sessionId !== "string") return;
  writeSessionBindings(getSessionBindings().filter((binding) => binding.sessionId !== sessionId));
}

export function sessionProjectPath(projectPath: string, binding: SessionBinding | undefined) {
  return binding ? { path: path.resolve(binding.cwd) } : { path: path.resolve(projectPath) };
}
