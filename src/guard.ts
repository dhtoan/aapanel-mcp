/** Safety checks shared by the tools: path allowlists, confirmations and output size. */
import path from "node:path";
import type { Config } from "./config.js";

/** Panel internals (API key, panel database, sessions) are never readable or writable through file tools. */
const PANEL_DENY = ["/www/server/panel"];
/** …except the web server vhost configs, which are useful to read and edit. */
const PANEL_ALLOW = ["/www/server/panel/vhost"];

const within = (p: string, root: string) => root === "/" || p === root || p.startsWith(root + "/");

export class GuardError extends Error {}

/** Normalizes a remote (Linux) path and checks it against AAPANEL_PATHS and the panel deny list. */
export function remotePath(cfg: Config, input: string): string {
  const raw = String(input || "").trim().replace(/\\/g, "/");
  if (!raw.startsWith("/")) throw new GuardError(`Path must be absolute: ${input}`);
  if (raw.split("/").includes("..")) throw new GuardError(`Path must not contain "..": ${input}`);
  const p = path.posix.normalize(raw).replace(/\/+$/, "") || "/";
  if (!cfg.remoteRoots.some((r) => within(p, r))) {
    throw new GuardError(`Path ${p} is outside the allowed roots (${cfg.remoteRoots.join(", ")}). Change AAPANEL_PATHS to allow it.`);
  }
  if (PANEL_DENY.some((d) => within(p, d)) && !PANEL_ALLOW.some((a) => within(p, a))) {
    throw new GuardError(`Path ${p} is inside the panel's own files and is blocked (only /www/server/panel/vhost is allowed).`);
  }
  return p;
}

/** Local files (upload source / download target) must live under AAPANEL_LOCAL_DIRS. */
export function localPath(cfg: Config, input: string): string {
  const p = path.resolve(String(input || ""));
  const ok = cfg.localRoots.some((r) => {
    const rel = path.relative(r, p);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  });
  if (!ok) throw new GuardError(`Local path ${p} is outside AAPANEL_LOCAL_DIRS (${cfg.localRoots.join(", ")}).`);
  return p;
}

/** Destructive tools require the caller to repeat the exact target name. */
export function confirm(expected: string, given: string | undefined, what: string) {
  if (given !== expected) {
    throw new GuardError(`Refusing to ${what}: set confirm to exactly "${expected}" after the user has approved it.`);
  }
}

const MAX_TEXT = 60_000;

/** Pretty JSON / text, trimmed so a single tool result stays readable for the model. */
export function show(value: unknown, max = MAX_TEXT): string {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n… [truncated ${text.length - max} characters]`;
}

/** Last part of a long text (logs, command output). */
export function tail(text: string, max = MAX_TEXT): string {
  if (text.length <= max) return text;
  return `[… ${text.length - max} earlier characters omitted]\n` + text.slice(-max);
}
