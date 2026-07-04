import fs from "fs";
import { SYLPH_DIR, PROJECTS_FILE } from "./config.ts";

export interface Project {
  id: string;
  name: string;
  path: string;
}

if (!fs.existsSync(SYLPH_DIR)) {
  fs.mkdirSync(SYLPH_DIR, { recursive: true });
}
if (!fs.existsSync(PROJECTS_FILE)) {
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify([]));
}

export function getProjects(): Project[] {
  try {
    return JSON.parse(fs.readFileSync(PROJECTS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

export function saveProjects(projects: Project[]) {
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));
}
