import express from "express";
import { handleError } from "./routeHelpers.ts";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { getIntrospectionRuntime } from "../runtime/index.ts";
import { COMMIT_MESSAGE_THINKING_LEVELS, getSettings, updateSettings, type CommitMessageThinkingLevel } from "../settings.ts";
import { findAvailableModel } from "../modelSelection.ts";

export function registerSettingsRoutes(router: express.Router): void {
  router.get("/api/settings", (_req, res) => {
    res.json(getSettings());
  });

  router.patch("/api/settings", async (req, res) => {
    const { commitMessageModel, commitMessageThinkingLevel, commitMessagePrompt } = req.body ?? {};
    if (commitMessageModel !== undefined && typeof commitMessageModel !== "string") {
      return res.status(400).json({ error: "commitMessageModel must be a string" });
    }
    if (commitMessageThinkingLevel !== undefined
      && (typeof commitMessageThinkingLevel !== "string"
        || !COMMIT_MESSAGE_THINKING_LEVELS.includes(commitMessageThinkingLevel as CommitMessageThinkingLevel))) {
      return res.status(400).json({ error: "Invalid commitMessageThinkingLevel" });
    }
    if (commitMessagePrompt !== undefined && (typeof commitMessagePrompt !== "string" || !commitMessagePrompt.trim())) {
      return res.status(400).json({ error: "commitMessagePrompt must be a non-empty string" });
    }

    const current = getSettings();
    const requestedModel = commitMessageModel ?? current.commitMessageModel;
    const requestedThinkingLevel = (commitMessageThinkingLevel ?? current.commitMessageThinkingLevel) as CommitMessageThinkingLevel;
    if (requestedModel) {
      try {
        const runtime = await getIntrospectionRuntime();
        const available = runtime.session.modelRegistry.getAvailable();
        const model = findAvailableModel(available, requestedModel);
        if (!model) return res.status(400).json({ error: `Unknown or unavailable model: ${requestedModel}` });
        const thinkingLevels = getSupportedThinkingLevels(model as any);
        if (!thinkingLevels.includes(requestedThinkingLevel)) {
          return res.status(400).json({
            error: `Thinking level ${requestedThinkingLevel} is not supported by ${model.id}`,
            availableThinkingLevels: thinkingLevels,
          });
        }
      } catch (err) {
        return handleError(res, err);
      }
    }
    res.json(updateSettings({
      commitMessageModel: requestedModel,
      commitMessageThinkingLevel: requestedThinkingLevel,
      commitMessagePrompt: commitMessagePrompt ?? current.commitMessagePrompt,
    }));
  });

  router.get("/api/models", async (_req, res) => {
    try {
      // Use the introspection runtime's session registry, not a standalone
      // ModelRegistry. Extension-registered providers (e.g. pi-9router-ext)
      // call pi.registerProvider() at session_start, which adds their models
      // to the session's registry only. A standalone registry would only see
      // built-in models and models.json — missing all extension providers.
      const runtime = await getIntrospectionRuntime();
      const available = runtime.session.modelRegistry.getAvailable();
      res.json({
        models: available.map((m: any) => ({
          id: m.id,
          provider: m.provider,
          value: `${m.provider}/${m.id}`,
          label: m.id,
          reasoning: !!m.reasoning,
          thinkingLevels: getSupportedThinkingLevels(m),
        })),
      });
    } catch (err) {
      handleError(res, err);
    }
  });

}
