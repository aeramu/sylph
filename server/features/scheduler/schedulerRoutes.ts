import express from "express";
import { handleError } from "../../platform/http/routeError.ts";
import { getSessionBinding } from "../sessions/workspace/workspaceBindingRepository.ts";
import { runSchedule } from "./schedulerRunner.ts";
import {
  createSchedule, deleteSchedule, getScheduleForProject, listAllSchedules, listSchedules, updateSchedule,
} from "./schedulerService.ts";

function stringId(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function ownershipForSession(value: unknown): { projectId?: string; directoryId?: string } {
  const binding = getSessionBinding(value);
  return {
    ...(binding?.projectId ? { projectId: binding.projectId } : {}),
    ...(binding?.projectId && binding.directoryId ? { directoryId: binding.directoryId } : {}),
  };
}

export function registerSchedulerRoutes(router: express.Router): void {
  router.get("/api/schedules", (req, res) => {
    const scope = req.query.scope === "all" ? "all" : "project";
    res.json({ schedules: scope === "all" ? listAllSchedules() : listSchedules(stringId(req.query.projectId)) });
  });

  router.get("/api/schedules/:id", (req, res) => {
    try {
      res.json(getScheduleForProject(req.params.id, stringId(req.query.projectId)));
    } catch (error) {
      handleError(res, error);
    }
  });

  router.post("/api/schedules", (req, res) => {
    try {
      res.status(201).json(createSchedule(req.body ?? {}, ownershipForSession(req.body?.sessionId)));
    } catch (error) {
      handleError(res, error);
    }
  });

  router.patch("/api/schedules/:id", (req, res) => {
    try {
      res.json(updateSchedule(req.params.id, req.body ?? {}, stringId(req.body?.projectId)));
    } catch (error) {
      handleError(res, error);
    }
  });

  router.delete("/api/schedules/:id", (req, res) => {
    try {
      deleteSchedule(req.params.id, stringId(req.query.projectId));
      res.json({ success: true });
    } catch (error) {
      handleError(res, error);
    }
  });

  router.post("/api/schedules/:id/run", async (req, res) => {
    try {
      getScheduleForProject(req.params.id, stringId(req.body?.projectId));
      const result = await runSchedule(req.params.id);
      res.json(result);
    } catch (error) {
      handleError(res, error);
    }
  });
}
