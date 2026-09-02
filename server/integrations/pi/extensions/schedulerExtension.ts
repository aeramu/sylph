import { StringEnum } from "@earendil-works/pi-ai";
import type { AgentToolResult, ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { getSessionBinding } from "../../../features/sessions/workspace/workspaceBindingRepository.ts";
import {
  createSchedule, deleteSchedule, listSchedules, updateSchedule,
} from "../../../features/scheduler/schedulerService.ts";
import type { Schedule } from "../../../features/scheduler/schedulerTypes.ts";

const CreateScheduleParams = Type.Object({
  name: Type.String({ description: "Short descriptive schedule name." }),
  prompt: Type.String({ description: "Self-contained instructions for the future agent run." }),
  kind: StringEnum(["once", "cron"] as const),
  runAt: Type.Optional(Type.String({ description: "ISO 8601 timestamp including an offset for kind=once." })),
  cron: Type.Optional(Type.String({ description: "Five-field cron expression for kind=cron (minute hour day-of-month month day-of-week)." })),
  timezone: Type.String({ description: "IANA timezone, for example America/Toronto or Europe/London." }),
});

const ListScheduleParams = Type.Object({});
const UpdateScheduleParams = Type.Object({
  id: Type.String(),
  name: Type.Optional(Type.String()),
  prompt: Type.Optional(Type.String()),
  kind: Type.Optional(StringEnum(["once", "cron"] as const)),
  runAt: Type.Optional(Type.String()),
  cron: Type.Optional(Type.String()),
  timezone: Type.Optional(Type.String()),
  enabled: Type.Optional(Type.Boolean()),
});
const DeleteScheduleParams = Type.Object({ id: Type.String() });

function result(text: string, details: Record<string, unknown> = {}): AgentToolResult<Record<string, unknown>> {
  return { content: [{ type: "text", text }], details };
}

function ownership(ctx: any): { projectId?: string; directoryId?: string } {
  const binding = getSessionBinding(ctx.sessionManager.getSessionId());
  return {
    ...(binding?.projectId ? { projectId: binding.projectId } : {}),
    ...(binding?.projectId && binding.directoryId ? { directoryId: binding.directoryId } : {}),
  };
}

function describe(schedule: Schedule): string {
  const timing = schedule.kind === "once" ? `once at ${schedule.runAt}` : `${schedule.cron} (${schedule.timezone})`;
  return `${schedule.enabled ? "enabled" : "disabled"} ${schedule.id}: ${schedule.name} — ${timing}; next: ${schedule.nextRunAt ?? "none"}`;
}

const GUIDELINES = [
  "Use create_schedule when the user explicitly asks for work to happen later or recur; do not merely promise to remember it.",
  "Before create_schedule, ask for clarification when the requested time, recurrence, or timezone is ambiguous.",
  "Make create_schedule prompts self-contained because every execution starts a new chat.",
  "Schedule tools automatically use the current chat's project and starting directory; never ask for or invent project IDs.",
];

/** Pi adapters for Sylph's persistent server-level scheduler. */
export const schedulerExtension: ExtensionFactory = (pi: ExtensionAPI) => {
  pi.registerTool({
    name: "create_schedule",
    label: "Create Schedule",
    description: "Create a persistent one-time or recurring agent task. The schedule automatically inherits this chat's project and starting directory; projectless chats create projectless schedules.",
    promptSnippet: "Create persistent one-time or recurring agent tasks",
    promptGuidelines: GUIDELINES,
    parameters: CreateScheduleParams,
    execute: async (_id, params, _signal, _update, ctx) => {
      const schedule = createSchedule(params, ownership(ctx));
      return result(`Created ${describe(schedule)}`, { schedule });
    },
  });

  pi.registerTool({
    name: "list_schedules",
    label: "List Schedules",
    description: "List schedules belonging to the current chat's project. In a projectless chat, lists projectless schedules.",
    promptSnippet: "List schedules for the current chat's project",
    parameters: ListScheduleParams,
    execute: async (_id, _params, _signal, _update, ctx) => {
      const schedules = listSchedules(ownership(ctx).projectId);
      return result(schedules.length ? schedules.map(describe).join("\n") : "No schedules for this chat's project.", { schedules });
    },
  });

  pi.registerTool({
    name: "update_schedule",
    label: "Update Schedule",
    description: "Update, enable, or disable a schedule belonging to the current chat's project. Use list_schedules to find its ID.",
    promptSnippet: "Update or pause schedules for the current chat's project",
    parameters: UpdateScheduleParams,
    execute: async (_id, params, _signal, _update, ctx) => {
      const schedule = updateSchedule(params.id, params, ownership(ctx).projectId);
      return result(`Updated ${describe(schedule)}`, { schedule });
    },
  });

  pi.registerTool({
    name: "delete_schedule",
    label: "Delete Schedule",
    description: "Permanently delete a schedule belonging to the current chat's project. Use list_schedules to find its ID.",
    promptSnippet: "Delete schedules for the current chat's project",
    parameters: DeleteScheduleParams,
    execute: async (_id, params, _signal, _update, ctx) => {
      deleteSchedule(params.id, ownership(ctx).projectId);
      return result(`Deleted schedule ${params.id}.`, { id: params.id, deleted: true });
    },
  });
};

export default schedulerExtension;
