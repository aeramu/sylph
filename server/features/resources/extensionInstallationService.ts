import { installExtensionPackage, uninstallExtensionPackage } from "../../integrations/pi/packages/extensionPackageInstaller.ts";
import { getIntrospectionRuntime } from "../../integrations/pi/runtime/runtimeManager.ts";
import { badRequest, conflict, notFound } from "../../platform/http/errors.ts";
import { extensionDisplayName, getLoadedExtensions } from "./resourceIntrospection.ts";

function extensionNames(session: any): string[] {
  return getLoadedExtensions(session).map((extension: any) => extensionDisplayName(extension));
}

function installedUserPackageSource(extension: any): string | undefined {
  const sourceInfo = extension?.sourceInfo;
  return sourceInfo?.origin === "package" && sourceInfo?.scope === "user" && typeof sourceInfo?.source === "string"
    ? sourceInfo.source
    : undefined;
}

export function extensionPackageInfo(extension: any, extensions: any[]) {
  const source = installedUserPackageSource(extension);
  if (!source) return undefined;
  return {
    source,
    scope: "user" as const,
    extensions: extensions
      .filter((candidate) => installedUserPackageSource(candidate) === source)
      .map((candidate) => extensionDisplayName(candidate)),
  };
}

export async function installExtension(sourceInput: unknown) {
  if (typeof sourceInput !== "string" || !sourceInput.trim()) badRequest("source is required");
  const source = sourceInput.trim();
  if (/\r|\n|\0/.test(source)) badRequest("source must be a single package reference or path");

  await installExtensionPackage(source);
  const runtime = await getIntrospectionRuntime();
  await runtime.session.reload();

  return { source, extensions: extensionNames(runtime.session) };
}

export async function uninstallExtension(name: string) {
  const runtime = await getIntrospectionRuntime();
  const extensions = getLoadedExtensions(runtime.session);
  const extension = extensions.find((entry: any) => extensionDisplayName(entry) === name);
  if (!extension) notFound("Extension not found");
  const packageInfo = extensionPackageInfo(extension, extensions);
  if (!packageInfo) badRequest("Only extensions from globally installed Pi packages can be uninstalled here");

  const removed = await uninstallExtensionPackage(packageInfo.source);
  if (!removed) conflict(`Package ${packageInfo.source} is no longer configured`);
  await runtime.session.reload();

  return { source: packageInfo.source, removedExtensions: packageInfo.extensions, extensions: extensionNames(runtime.session) };
}
