/** Tool registration with permission levels; errors become readable tool errors. */
import type { McpServer } from "@modelcontextprotocol/server";
import type { z } from "zod";
import { AaPanelClient, PanelError } from "./client.js";
import type { Config } from "./config.js";
import { GuardError, show } from "./guard.js";

/** read: always on · write: AAPANEL_ALLOW_WRITE · shell: AAPANEL_ALLOW_SHELL · raw: AAPANEL_ALLOW_RAW */
export type Level = "read" | "write" | "shell" | "raw";

export interface ToolSpec<S extends z.ZodObject> {
  title: string;
  description: string;
  input: S;
  level: Level;
  /** Deletes or overwrites data, or can lock users out. */
  destructive?: boolean;
  idempotent?: boolean;
}

export interface Ctx {
  api: AaPanelClient;
  cfg: Config;
  tool<S extends z.ZodObject>(name: string, spec: ToolSpec<S>, run: (args: z.infer<S>) => Promise<unknown>): void;
  registered: Record<Level, string[]>;
}

export function createCtx(server: McpServer, api: AaPanelClient, cfg: Config): Ctx {
  const enabled: Record<Level, boolean> = { read: true, write: cfg.allowWrite, shell: cfg.allowShell, raw: cfg.allowRaw };
  const registered: Record<Level, string[]> = { read: [], write: [], shell: [], raw: [] };
  return {
    api,
    cfg,
    registered,
    tool(name, spec, run) {
      if (!enabled[spec.level]) return;
      registered[spec.level].push(name);
      server.registerTool(
        name,
        {
          title: spec.title,
          description: spec.description,
          inputSchema: spec.input,
          annotations: {
            readOnlyHint: spec.level === "read",
            destructiveHint: spec.level === "read" ? false : !!spec.destructive || spec.level !== "write",
            idempotentHint: spec.idempotent ?? spec.level === "read",
            openWorldHint: true,
          },
        },
        (async (args: z.infer<typeof spec.input>) => {
          try {
            const out = await run(args);
            return { content: [{ type: "text" as const, text: show(out ?? "Done.") }] };
          } catch (e) {
            const known = e instanceof PanelError || e instanceof GuardError;
            const msg = known ? (e as Error).message : `Unexpected error: ${(e as Error).message}`;
            return { content: [{ type: "text" as const, text: msg }], isError: true };
          }
        }) as never,
      );
    },
  };
}
