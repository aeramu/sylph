import express from "express";
import {
  backgroundJobService, type BackgroundJobServicePort,
} from "./backgroundJobService.ts";
import { badRequest, notFound } from "../../platform/http/errors.ts";
import { asyncRoute } from "../../platform/http/routeError.ts";

const MAX_VISIBLE_LOG_BYTES = 50 * 1024;
const JOB_ID_PATTERN = /^bg-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type BackgroundJobQueryService = Pick<BackgroundJobServicePort, "getJob" | "readLogs">;

function requestedLogBytes(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^\d+$/.test(value)) badRequest("maxBytes must be a positive integer");
  const parsed = Number(value);
  if (parsed < 1 || parsed > MAX_VISIBLE_LOG_BYTES) {
    badRequest(`maxBytes must be between 1 and ${MAX_VISIBLE_LOG_BYTES}`);
  }
  return parsed;
}

/** Session-scoped, bounded background-job output for lazy timeline disclosure. */
export function registerBackgroundJobRoutes(
  router: express.Router,
  service: BackgroundJobQueryService = backgroundJobService,
): void {
  router.get("/api/sessions/:sessionId/background-jobs/:jobId/logs", asyncRoute(async (req, res) => {
    const sessionId = String(req.params.sessionId);
    const jobId = String(req.params.jobId);
    if (!JOB_ID_PATTERN.test(jobId)) badRequest("Invalid background job id");
    if (!service.getJob(sessionId, jobId)) notFound(`Background job ${jobId} was not found in this session`);
    res.json(service.readLogs(sessionId, jobId, requestedLogBytes(req.query.maxBytes)));
  }));
}
