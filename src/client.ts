/**
 * aaPanel API client.
 * Auth (BTPanel/common.py → get_sk): POST form fields request_time + request_token,
 * request_token = md5(request_time + md5(api_key)). The caller's IP must be in the API whitelist,
 * and 20 consecutive failures lock the IP out for one hour.
 */
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Agent, fetch, type Dispatcher } from "undici";
import type { Config } from "./config.js";

const md5 = (s: string) => createHash("md5").update(s).digest("hex");

export class PanelError extends Error {}

export type Params = Record<string, string | number | boolean | undefined>;

export class AaPanelClient {
  private dispatcher?: Dispatcher;
  private keyHash: string;

  constructor(private cfg: Config) {
    this.keyHash = md5(cfg.apiKey);
    // Self-signed panel certificates: relax TLS for this client only, never process-wide.
    if (cfg.insecureTls) this.dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
  }

  private auth() {
    const time = String(Math.floor(Date.now() / 1000));
    return { request_time: time, request_token: md5(time + this.keyHash) };
  }

  /** POST /<module>?action=<action> (classic routes) or any path such as "datalist/data/get_data_list". */
  async call<T = unknown>(pathOrModule: string, action: string | null, params: Params = {}): Promise<T> {
    const path = pathOrModule.replace(/^\/+/, "");
    const url = `${this.cfg.url}/${path}${action ? `${path.includes("?") ? "&" : "?"}action=${encodeURIComponent(action)}` : ""}`;
    const body = new URLSearchParams(this.auth());
    for (const [k, v] of Object.entries(params)) if (v !== undefined) body.set(k, String(v));
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body,
        dispatcher: this.dispatcher,
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
        redirect: "manual",
      });
    } catch (e) {
      const cause = (e as { cause?: { code?: string } }).cause?.code;
      if (cause && /CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(cause)) {
        throw new PanelError(`TLS error (${cause}). The panel uses a self-signed certificate: set AAPANEL_INSECURE_TLS=1.`);
      }
      throw new PanelError(`Cannot reach the panel at ${this.cfg.url}: ${(e as Error).message}`);
    }
    if (res.status >= 300 && res.status < 400) {
      throw new PanelError("The panel redirected to its login page: the API is disabled, the key is wrong, or this IP is not whitelisted.");
    }
    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      if (/<html|<!doctype/i.test(text)) {
        throw new PanelError("The panel returned an HTML page instead of JSON: check that the API is enabled, the key, and the IP whitelist.");
      }
      return text as T; // some actions return plain strings
    }
    if (data && typeof data === "object" && !Array.isArray(data) && (data as { status?: unknown }).status === false) {
      throw new PanelError(stripHtml(String((data as { msg?: unknown }).msg ?? "Request failed")));
    }
    if (!res.ok) throw new PanelError(`HTTP ${res.status}`);
    return data as T;
  }

  /** Download a remote file (GET /download) to a local path. Returns bytes written. */
  async download(remotePath: string, localPath: string): Promise<number> {
    const q = new URLSearchParams({ ...this.auth(), filename: remotePath });
    const res = await fetch(`${this.cfg.url}/download?${q}`, {
      dispatcher: this.dispatcher,
      signal: AbortSignal.timeout(Math.max(this.cfg.timeoutMs, 300_000)),
      redirect: "manual",
    });
    const type = res.headers.get("content-type") || "";
    if (!res.ok || !res.body || type.includes("application/json") || type.includes("text/html")) {
      const text = res.body ? await res.text() : "";
      let msg = `Download failed (HTTP ${res.status})`;
      try {
        msg = String(JSON.parse(text).msg ?? msg);
      } catch {
        /* keep */
      }
      throw new PanelError(stripHtml(msg));
    }
    let bytes = 0;
    const counter = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream);
    counter.on("data", (c: Buffer) => (bytes += c.length));
    await pipeline(counter, createWriteStream(localPath));
    return bytes;
  }
}

export function stripHtml(s: string) {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
