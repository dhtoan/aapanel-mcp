import { randomBytes } from "node:crypto";
import { z } from "zod";
import { PanelError } from "../client.js";
import { remotePath, tail } from "../guard.js";
import type { Ctx } from "../registry.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MARK = "__AAPANEL_MCP_EXIT__=";

/**
 * Shell commands run through the panel's own terminal endpoint (files?action=ExecShell), which starts
 * the script in the background as root. Output goes to a private file that is polled until the exit marker appears.
 * The panel keeps a single shell script slot, so commands are serialized here.
 */
let queue: Promise<unknown> = Promise.resolve();

export function register({ tool, api, cfg }: Ctx) {
  tool(
    "run_command",
    {
      title: "Run shell command (root)",
      description:
        "Run a non-interactive bash command on the server as root and return its output and exit code. Use for git pull, composer, php scripts, nginx -t, tail logs, disk checks, etc. Show the user the exact command before anything destructive (rm, DROP, chmod -R, firewall/ssh changes). Interactive programs (vim, top, less) are not supported.",
      input: z.object({
        command: z.string().min(1).max(20_000),
        cwd: z.string().default("/www/wwwroot").describe("Working directory (must be under AAPANEL_PATHS)"),
        timeout_seconds: z.number().int().min(5).max(900).default(120),
      }),
      level: "shell",
    },
    ({ command, cwd, timeout_seconds }) => {
      const run = async () => {
        const dir = remotePath(cfg, cwd);
        const out = `/tmp/aapanel-mcp-${randomBytes(8).toString("hex")}.log`;
        const script = `{\n${command}\n} > ${out} 2>&1 < /dev/null; echo "${MARK}$?" >> ${out}`;
        await api.call("files", "ExecShell", { path: dir, shell: script });
        const deadline = Date.now() + timeout_seconds * 1000;
        let text = "";
        let delay = 700;
        while (Date.now() < deadline) {
          await sleep(delay);
          delay = Math.min(delay * 1.5, 4000);
          try {
            const r = await api.call<{ data?: string }>("files", "GetFileBody", { path: out });
            text = typeof r === "string" ? r : (r?.data ?? "");
          } catch (e) {
            if (e instanceof PanelError && /not exist/i.test(e.message)) continue; // not started yet
            throw e;
          }
          const at = text.lastIndexOf(MARK);
          if (at !== -1) {
            const code = Number(text.slice(at + MARK.length).trim().split(/\s/)[0]);
            await api.call("files", "ExecShell", { path: "/tmp", shell: `rm -f ${out}` }).catch(() => undefined);
            return `exit code: ${code}\n\n${tail(text.slice(0, at).trimEnd()) || "(no output)"}`;
          }
        }
        return `Still running after ${timeout_seconds}s (continues in the background).\nOutput file on the server: ${out}\n\n${tail(text) || "(no output yet)"}`;
      };
      const p = queue.then(run, run);
      queue = p.catch(() => undefined);
      return p;
    },
  );
}
