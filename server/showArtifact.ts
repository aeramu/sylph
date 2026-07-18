// Native `show_artifact` tool for Sylph.
//
// Artifacts are ordinary files beneath the session's private
// $SYLPH_ARTIFACTS_DIR. This tool does not create or persist metadata; it only
// validates a completed file and asks the browser to open it.

import fs from "fs";
import { Type, type Static } from "typebox";
import type { AgentToolResult, ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { resolveArtifactPath } from "./artifacts.ts";

export const ShowArtifactParamsSchema = Type.Object({
  path: Type.String({
    description: "Path relative to $SYLPH_ARTIFACTS_DIR of the artifact to show to the user.",
  }),
});

export type ShowArtifactParams = Static<typeof ShowArtifactParamsSchema>;

function textResult(text: string, details: Record<string, unknown>): AgentToolResult<Record<string, unknown>> {
  return { content: [{ type: "text", text }], details };
}

export const showArtifactExtension: ExtensionFactory = (pi: ExtensionAPI) => {
  pi.registerTool({
    name: "show_artifact",
    label: "Show Artifact",
    description: "Show a completed file from $SYLPH_ARTIFACTS_DIR to the user in Sylph's Artifacts panel. Create the file first, then call this tool with its path relative to the artifact directory.",
    promptSnippet: "Open a completed file from $SYLPH_ARTIFACTS_DIR in the user's Artifacts panel",
    promptGuidelines: [
      "Put user-facing deliverables in $SYLPH_ARTIFACTS_DIR and call show_artifact after the file is complete; keep temporary and intermediate files elsewhere in $SYLPH_SCRATCH_DIR.",
    ],
    parameters: ShowArtifactParamsSchema,
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      const sessionId = ctx.sessionManager.getSessionId();
      let resolved: ReturnType<typeof resolveArtifactPath>;
      try {
        resolved = resolveArtifactPath(sessionId, (params as ShowArtifactParams).path);
      } catch (error) {
        return textResult(error instanceof Error ? error.message : "Invalid artifact path", { shown: false });
      }
      if (!fs.existsSync(resolved.absolutePath) || !fs.statSync(resolved.absolutePath).isFile()) {
        return textResult(`Artifact not found: ${resolved.relativePath}`, { shown: false, path: resolved.relativePath });
      }

      const show = (ctx.ui as any)?.showArtifact;
      if (!ctx.hasUI || typeof show !== "function") {
        return textResult(`Artifact created: ${resolved.relativePath}`, { shown: false, path: resolved.relativePath });
      }
      show(resolved.relativePath);
      return textResult(`Showing artifact: ${resolved.relativePath}`, { shown: true, path: resolved.relativePath });
    },
  });
};

export default showArtifactExtension;
