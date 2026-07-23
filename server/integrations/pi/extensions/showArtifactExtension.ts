import { Type, type Static } from "typebox";
import type { AgentToolResult, ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { presentArtifact } from "../../../features/artifacts/artifactPresentation.ts";

export const ShowArtifactParamsSchema = Type.Object({
  path: Type.String({ description: "Path relative to $SYLPH_ARTIFACTS_DIR of the artifact to show to the user." }),
});
export type ShowArtifactParams = Static<typeof ShowArtifactParamsSchema>;

function textResult(text: string, details: Record<string, unknown>): AgentToolResult<Record<string, unknown>> {
  return { content: [{ type: "text", text }], details };
}

/** Pi tool adapter for the artifact feature's presentation use case. */
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
      const show = ctx.hasUI && typeof (ctx.ui as any)?.showArtifact === "function"
        ? (path: string) => (ctx.ui as any).showArtifact(path)
        : undefined;
      const result = presentArtifact(ctx.sessionManager.getSessionId(), (params as ShowArtifactParams).path, show);
      return textResult(result.message, { shown: result.shown, ...(result.path ? { path: result.path } : {}) });
    },
  });
};

export default showArtifactExtension;
