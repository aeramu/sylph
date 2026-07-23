import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { SessionHistoryPort } from "../../features/sessions/lifecycle/sessionHistoryPort.ts";

export const piSessionHistory: SessionHistoryPort = {
  open: (filePath) => SessionManager.open(filePath),
  create: (cwd) => SessionManager.create(cwd),
  list: (cwd) => SessionManager.list(cwd),
  listAll: () => SessionManager.listAll(),
};
