import { z } from "zod";
import type { Ctx } from "../registry.js";

const SERVICE = /^(nginx|apache|httpd|openlitespeed|mysqld|redis|memcached|pure-ftpd|php-fpm-\d{2,3}|webserver)$/;

export function register({ tool, api }: Ctx) {
  tool(
    "system_status",
    {
      title: "Server status",
      description: "CPU, memory, load, disk usage, network and OS/panel versions of the aaPanel server.",
      input: z.object({}),
      level: "read",
    },
    async () => {
      const [total, disks, network] = await Promise.all([
        api.call("system", "GetSystemTotal"),
        api.call("system", "GetDiskInfo"),
        api.call<Record<string, unknown>>("system", "GetNetWork"),
      ]);
      const { load, cpu, mem, up, down, upTotal, downTotal } = network ?? {};
      return { system: total, disks, network: { load, cpu, mem, up, down, upTotal, downTotal } };
    },
  );

  tool(
    "panel_logs",
    {
      title: "Panel operation logs",
      description: "Recent aaPanel operation logs (logins, site/database changes, API actions).",
      input: z.object({
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(30),
        search: z.string().max(100).optional().describe("Filter text"),
      }),
      level: "read",
    },
    ({ page, limit, search }) => api.call("data", "getData", { table: "logs", p: page, limit, search, tojs: "" }),
  );

  tool(
    "service_control",
    {
      title: "Start/stop/restart a service",
      description:
        "Control a server service: nginx, apache, openlitespeed, mysqld, redis, memcached, pure-ftpd or php-fpm-XX (e.g. php-fpm-82). Use reload for config changes; restart/stop briefly interrupts traffic.",
      input: z.object({
        service: z.string().regex(SERVICE, "Unsupported service name").describe("e.g. nginx, mysqld, php-fpm-82"),
        action: z.enum(["start", "stop", "restart", "reload"]),
      }),
      level: "write",
      destructive: true,
    },
    ({ service, action }) => api.call("system", "ServiceAdmin", { name: service, type: action }),
  );
}
