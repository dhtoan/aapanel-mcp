#!/usr/bin/env node
/**
 * aaPanel MCP server (stdio). Lets Claude manage an aaPanel server through the panel API.
 * Permission levels: read (always), write (AAPANEL_ALLOW_WRITE=1), shell (AAPANEL_ALLOW_SHELL=1), raw API (AAPANEL_ALLOW_RAW=1).
 */
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { AaPanelClient } from "./client.js";
import { loadConfig } from "./config.js";
import { createCtx } from "./registry.js";
import * as cron from "./tools/cron.js";
import * as databases from "./tools/databases.js";
import * as files from "./tools/files.js";
import * as firewall from "./tools/firewall.js";
import * as raw from "./tools/raw.js";
import * as shell from "./tools/shell.js";
import * as sites from "./tools/sites.js";
import * as system from "./tools/system.js";

const VERSION = "1.0.0";

async function main() {
  const cfg = loadConfig();
  const api = new AaPanelClient(cfg);
  const server = new McpServer(
    { name: "aapanel", version: VERSION },
    {
      instructions:
        "Tools for managing an aaPanel Linux server (websites, files, MySQL, services, cron, firewall, shell). " +
        "Read before you change anything. Before any destructive action (delete, overwrite, stop, firewall change, risky shell command) " +
        "tell the user exactly what will happen and wait for their approval. Make a backup (backup_site / backup_database) before risky changes. " +
        "After editing nginx config run `nginx -t` (run_command) before reloading.",
    },
  );
  const ctx = createCtx(server, api, cfg);
  for (const m of [system, sites, files, databases, cron, firewall, shell, raw]) m.register(ctx);

  ctx.tool(
    "aapanel_permissions",
    {
      title: "Enabled permissions",
      description: "Which permission levels and tools this aaPanel MCP server has enabled, and the allowed paths.",
      input: z.object({}),
      level: "read",
    },
    async () => ({
      panel: cfg.url,
      write: cfg.allowWrite,
      shell: cfg.allowShell,
      raw_api: cfg.allowRaw,
      remote_paths: cfg.remoteRoots,
      local_dirs: cfg.localRoots,
      tools: ctx.registered,
    }),
  );

  await server.connect(new StdioServerTransport());
  const n = Object.values(ctx.registered).flat().length;
  console.error(`aapanel-mcp ${VERSION} ready: ${n} tools (write=${cfg.allowWrite} shell=${cfg.allowShell} raw=${cfg.allowRaw})`);
}

main().catch((e) => {
  console.error(`aapanel-mcp: ${(e as Error).message}`);
  process.exit(1);
});
