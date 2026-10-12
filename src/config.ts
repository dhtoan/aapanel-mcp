/** Configuration from environment variables. Secrets are never logged. */
import path from "node:path";

function flag(name: string, fallback = false) {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function list(name: string, fallback: string[]) {
  const v = process.env[name];
  if (!v) return fallback;
  return v.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
}

export interface Config {
  url: string;
  apiKey: string;
  insecureTls: boolean;
  timeoutMs: number;
  allowWrite: boolean;
  allowShell: boolean;
  allowRaw: boolean;
  remoteRoots: string[];
  localRoots: string[];
}

export function loadConfig(): Config {
  const url = (process.env.AAPANEL_URL || "").trim().replace(/\/+$/, "");
  const apiKey = (process.env.AAPANEL_API_KEY || "").trim();
  if (!/^https?:\/\/[^/]+$/i.test(url)) {
    throw new Error("AAPANEL_URL must be the panel origin without the security entry, e.g. https://1.2.3.4:8888");
  }
  if (!apiKey) throw new Error("AAPANEL_API_KEY is required (aaPanel → Settings → API interface).");
  return {
    url,
    apiKey,
    insecureTls: flag("AAPANEL_INSECURE_TLS"),
    timeoutMs: Math.max(5_000, Number(process.env.AAPANEL_TIMEOUT_MS) || 60_000),
    allowWrite: flag("AAPANEL_ALLOW_WRITE"),
    allowShell: flag("AAPANEL_ALLOW_SHELL"),
    allowRaw: flag("AAPANEL_ALLOW_RAW"),
    remoteRoots: list("AAPANEL_PATHS", ["/www"]).map((p) => p.replace(/\/+$/, "") || "/"),
    localRoots: list("AAPANEL_LOCAL_DIRS", [process.cwd()]).map((p) => path.resolve(p)),
  };
}
