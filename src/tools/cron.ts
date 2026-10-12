import { z } from "zod";
import { confirm, tail } from "../guard.js";
import type { Ctx } from "../registry.js";

const cronId = z.number().int().positive().describe("Task id from list_cron_jobs");

export function register({ tool, api }: Ctx) {
  tool(
    "list_cron_jobs",
    { title: "Scheduled tasks", description: "Cron jobs configured in aaPanel (backups, scripts, URL calls).", input: z.object({}), level: "read" },
    () => api.call("crontab", "GetCrontab"),
  );

  tool(
    "cron_job_log",
    { title: "Scheduled task log", description: "Execution log of a cron job.", input: z.object({ id: cronId }), level: "read" },
    async ({ id }) => {
      const r = await api.call<{ msg?: string }>("crontab", "GetLogs", { id });
      return tail(typeof r === "string" ? r : String(r?.msg ?? JSON.stringify(r)));
    },
  );

  tool(
    "run_cron_job",
    { title: "Run task now", description: "Run an existing cron job immediately.", input: z.object({ id: cronId }), level: "write" },
    ({ id }) => api.call("crontab", "StartTask", { id }),
  );

  tool(
    "toggle_cron_job",
    { title: "Enable/disable task", description: "Toggle a cron job between enabled and paused.", input: z.object({ id: cronId }), level: "write" },
    ({ id }) => api.call("crontab", "set_cron_status", { id }),
  );

  tool(
    "delete_cron_job",
    {
      title: "Delete scheduled task",
      description: "DESTRUCTIVE. Delete a cron job. Only after user approval, with confirm = the task name.",
      input: z.object({ id: cronId, name: z.string(), confirm: z.string() }),
      level: "write",
      destructive: true,
    },
    ({ id, name, confirm: c }) => {
      confirm(name, c, `delete task ${name}`);
      return api.call("crontab", "DelCrontab", { id });
    },
  );

  // A shell cron job runs arbitrary commands as root, so it needs the shell level.
  tool(
    "add_cron_shell_job",
    {
      title: "Add shell cron job",
      description:
        "Create a cron job that runs a shell script as root. Schedule: day (daily at hour:minute), day-n (every N days), hour (hourly at :minute), hour-n (every N hours), minute-n (every N minutes), week (weekday 0-6 at hour:minute), month (day N at hour:minute).",
      input: z.object({
        name: z.string().min(1).max(100),
        schedule: z.enum(["day", "day-n", "hour", "hour-n", "minute-n", "week", "month"]),
        n: z.number().int().min(1).max(31).optional().describe("N for day-n / hour-n / minute-n, or day of month for month"),
        hour: z.number().int().min(0).max(23).default(0),
        minute: z.number().int().min(0).max(59).default(0),
        weekday: z.number().int().min(0).max(6).optional(),
        script: z.string().min(1).max(20_000),
      }),
      level: "shell",
    },
    ({ name, schedule, n, hour, minute, weekday, script }) =>
      api.call("crontab", "AddCrontab", {
        name,
        type: schedule,
        where1: n ?? "",
        hour,
        minute,
        week: weekday ?? "",
        sType: "toShell",
        sBody: script,
        sName: "",
        backupTo: "localhost",
        save: "",
        urladdress: "",
      }),
  );
}
