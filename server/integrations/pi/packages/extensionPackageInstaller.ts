import {
  DefaultPackageManager,
  SettingsManager,
  getAgentDir,
  type ProgressEvent,
} from "@earendil-works/pi-coding-agent";

export interface ExtensionPackageMutationOptions {
  cwd?: string;
  agentDir?: string;
  onProgress?: (event: ProgressEvent) => void;
}

let mutationQueue: Promise<void> = Promise.resolve();

function enqueueMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const operation = mutationQueue.catch(() => {}).then(mutation);
  mutationQueue = operation.then(() => {}, () => {});
  return operation;
}

function createPackageManager(options: ExtensionPackageMutationOptions) {
  const agentDir = options.agentDir ?? getAgentDir();
  const cwd = options.cwd ?? process.cwd();
  const settingsManager = SettingsManager.create(cwd, agentDir);
  const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager });
  packageManager.setProgressCallback(options.onProgress);
  return { packageManager, settingsManager };
}

/** Install a Pi package globally and persist it in the user's Pi settings. */
export function installExtensionPackage(source: string, options: ExtensionPackageMutationOptions = {}): Promise<void> {
  return enqueueMutation(async () => {
    const { packageManager, settingsManager } = createPackageManager(options);
    await packageManager.installAndPersist(source);
    await settingsManager.flush();
  });
}

/** Remove a globally configured Pi package and its managed installation. */
export function uninstallExtensionPackage(source: string, options: ExtensionPackageMutationOptions = {}): Promise<boolean> {
  return enqueueMutation(async () => {
    const agentDir = options.agentDir ?? getAgentDir();
    // User settings store local package paths relative to agentDir. Resolve the
    // configured source from that same base so local packages match correctly.
    const { packageManager, settingsManager } = createPackageManager({ ...options, cwd: agentDir });
    const removed = await packageManager.removeAndPersist(source);
    await settingsManager.flush();
    return removed;
  });
}
