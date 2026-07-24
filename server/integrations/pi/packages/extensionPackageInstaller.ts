import {
  DefaultPackageManager,
  SettingsManager,
  getAgentDir,
  type ProgressEvent,
} from "@earendil-works/pi-coding-agent";

export interface InstallExtensionPackageOptions {
  cwd?: string;
  agentDir?: string;
  onProgress?: (event: ProgressEvent) => void;
}

let installQueue: Promise<void> = Promise.resolve();

async function performInstall(source: string, options: InstallExtensionPackageOptions) {
  const cwd = options.cwd ?? process.cwd();
  const agentDir = options.agentDir ?? getAgentDir();
  const settingsManager = SettingsManager.create(cwd, agentDir);
  const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager });
  packageManager.setProgressCallback(options.onProgress);
  await packageManager.installAndPersist(source);
  await settingsManager.flush();
}

/** Install a Pi package globally and persist it in the user's Pi settings. */
export function installExtensionPackage(source: string, options: InstallExtensionPackageOptions = {}): Promise<void> {
  const operation = installQueue.catch(() => {}).then(() => performInstall(source, options));
  installQueue = operation.then(() => {}, () => {});
  return operation;
}
