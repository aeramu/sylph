import { installExtensionPackage } from "../../integrations/pi/packages/extensionPackageInstaller.ts";
import { getIntrospectionRuntime } from "../../integrations/pi/runtime/runtimeManager.ts";
import { badRequest } from "../../platform/http/errors.ts";
import { extensionDisplayName, getLoadedExtensions } from "./resourceIntrospection.ts";

function extensionNames(session: any): string[] {
  return getLoadedExtensions(session).map((extension: any) => extensionDisplayName(extension));
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
