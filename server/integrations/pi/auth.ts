import {
  AuthStorage,
  ModelRegistry,
} from "@earendil-works/pi-coding-agent";

// Use Pi's default agent directory so Sylph shares credentials and models with
// the Pi TUI: ~/.pi/agent/auth.json and ~/.pi/agent/models.json.
export const authStorage = AuthStorage.create();
export const modelRegistry = ModelRegistry.create(authStorage);

export function refreshAuthState() {
  authStorage.reload();
  modelRegistry.refresh();
}
