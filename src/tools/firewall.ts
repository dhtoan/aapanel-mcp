import { z } from "zod";
import { confirm } from "../guard.js";
import type { Ctx } from "../registry.js";

const port = z.string().regex(/^\d{1,5}(:\d{1,5})?$/, 'Port or range, e.g. "8080" or "30000:30100"');
const ip = z.string().regex(/^[0-9a-fA-F:.]+(\/\d{1,3})?$/, "IPv4/IPv6 address or CIDR");

export function register({ tool, api }: Ctx) {
  tool(
    "list_firewall_rules",
    {
      title: "Firewall rules",
      description: "Open ports and blocked IPs managed by aaPanel's firewall (id, port/ip, remark).",
      input: z.object({}),
      level: "read",
    },
    async () => {
      await api.call("firewall", "GetList").catch(() => undefined); // syncs system rules into the panel table
      return api.call("data", "getData", { table: "firewall", p: 1, limit: 500, tojs: "" });
    },
  );

  tool(
    "open_port",
    { title: "Open port", description: "Allow inbound traffic to a TCP/UDP port or range.", input: z.object({ port, remark: z.string().max(100).optional() }), level: "write" },
    ({ port, remark }) => api.call("firewall", "AddAcceptPort", { port, ps: remark || "" }),
  );

  tool(
    "block_ip",
    {
      title: "Block IP",
      description: "Drop all traffic from an IP or CIDR. Never block the IP you manage the server from.",
      input: z.object({ ip, remark: z.string().max(100).optional() }),
      level: "write",
      destructive: true,
    },
    ({ ip, remark }) => api.call("firewall", "AddDropAddress", { port: ip, ps: remark || "" }),
  );

  tool(
    "remove_firewall_rule",
    {
      title: "Remove firewall rule",
      description:
        "DESTRUCTIVE. Close an opened port or unblock an IP. Closing the SSH or panel port can lock everyone out. Only after user approval, with confirm = the port/IP.",
      input: z.object({ id: z.number().int().positive(), kind: z.enum(["port", "ip"]), value: z.string(), confirm: z.string() }),
      level: "write",
      destructive: true,
    },
    ({ id, kind, value, confirm: c }) => {
      confirm(value, c, `remove firewall rule ${value}`);
      return api.call("firewall", kind === "port" ? "DelAcceptPort" : "DelDropAddress", { id, port: value });
    },
  );
}
