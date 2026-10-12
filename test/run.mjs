// End-to-end test: starts the mock panel, launches dist/index.js over stdio and calls the tools.
// Run: npm run build && npm test
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startMockPanel } from "./mock-panel.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KEY = "test-key-123";
const local = mkdtempSync(path.join(tmpdir(), "aapanel-mcp-"));
let failed = 0;
const check = (name, ok, info = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  — " + String(info).slice(0, 140).replace(/\n/g, " ") : ""}`);
  if (!ok) failed++;
};

function startServer(env) {
  const child = spawn(process.execPath, [path.join(root, "dist/index.js")], {
    env: { ...process.env, AAPANEL_LOCAL_DIRS: local, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buf = "";
  const pending = new Map();
  let id = 0;
  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      pending.get(msg.id)?.(msg);
    }
  });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  const rpc = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      const t = setTimeout(() => reject(new Error(`timeout ${method}; stderr: ${stderr}`)), 30_000);
      pending.set(n, (m) => (clearTimeout(t), m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n");
    });
  const init = async () => {
    await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  };
  const call = async (name, args = {}) => {
    const r = await rpc("tools/call", { name, arguments: args });
    return { error: !!r.isError, text: r.content?.[0]?.text ?? "" };
  };
  return { child, rpc, init, call, stop: () => child.kill(), stderr: () => stderr };
}

const panel = await startMockPanel(KEY);

// 1) Read-only (default): no write/shell tools exposed.
{
  const s = startServer({ AAPANEL_URL: panel.url, AAPANEL_API_KEY: KEY });
  await s.init();
  const { tools } = await s.rpc("tools/list");
  const names = tools.map((t) => t.name);
  check("read-only mode hides write/shell/raw tools", !names.includes("write_file") && !names.includes("run_command") && !names.includes("api_call"), names.length + " tools");
  check("all read-only tools have readOnlyHint", tools.every((t) => t.annotations?.readOnlyHint === true));
  let r = await s.call("system_status");
  check("system_status", !r.error && r.text.includes("Ubuntu"), r.text);
  r = await s.call("list_sites");
  check("list_sites", !r.error && r.text.includes("a.com"));
  r = await s.call("list_databases");
  check("list_databases masks passwords", !r.error && !r.text.includes("secret-pass") && r.text.includes("a_db"));
  r = await s.call("read_file", { path: "/www/wwwroot/a.com/index.php" });
  check("read_file", !r.error && r.text.includes("echo 'hi'"));
  r = await s.call("read_file", { path: "/etc/shadow" });
  check("path outside AAPANEL_PATHS rejected", r.error && r.text.includes("outside"), r.text);
  r = await s.call("read_file", { path: "/www/server/panel/config/api.json" });
  check("panel internals blocked", r.error && r.text.includes("panel"), r.text);
  r = await s.call("read_file", { path: "/www/wwwroot/../../etc/passwd" });
  check("'..' rejected", r.error, r.text);
  r = await s.call("site_logs", { site: "a.com" });
  check("site_logs", !r.error && r.text.includes("GET /"));
  r = await s.call("list_firewall_rules");
  check("list_firewall_rules", !r.error && r.text.includes("SSH"));
  r = await s.call("aapanel_permissions");
  check("aapanel_permissions", !r.error && r.text.includes('"write": false'));
  s.stop();
}

// 2) Wrong key → readable auth error.
{
  const s = startServer({ AAPANEL_URL: panel.url, AAPANEL_API_KEY: "wrong" });
  await s.init();
  const r = await s.call("list_sites");
  check("wrong key gives clear error", r.error && /API is enabled|whitelist/.test(r.text), r.text);
  s.stop();
}

// 3) Write + shell + raw.
{
  const s = startServer({ AAPANEL_URL: panel.url, AAPANEL_API_KEY: KEY, AAPANEL_ALLOW_WRITE: "1", AAPANEL_ALLOW_SHELL: "1", AAPANEL_ALLOW_RAW: "1" });
  await s.init();
  const { tools } = await s.rpc("tools/list");
  check("full mode exposes write/shell/raw tools", ["write_file", "run_command", "api_call", "delete_site"].every((n) => tools.some((t) => t.name === n)), tools.length + " tools");
  check("delete tools marked destructive", tools.filter((t) => t.name.startsWith("delete_")).every((t) => t.annotations?.destructiveHint === true));

  let r = await s.call("write_file", { path: "/www/wwwroot/a.com/new.txt", content: "hello world" });
  check("write_file creates new file", !r.error && panel.files.get("/www/wwwroot/a.com/new.txt") === "hello world", r.text);
  r = await s.call("write_file", { path: "/www/wwwroot/a.com/new.txt", content: "v2" });
  check("write_file overwrites", !r.error && panel.files.get("/www/wwwroot/a.com/new.txt") === "v2");

  r = await s.call("create_site", { domains: ["b.com", "www.b.com"], php_version: "82" });
  const added = panel.calls.find((c) => c.action === "AddSite");
  check("create_site sends webname JSON + default path", !r.error && JSON.parse(added.params.webname).domainlist[0] === "www.b.com" && added.params.path === "/www/wwwroot/b.com", r.text);

  r = await s.call("delete_site", { site_id: 2, site: "b.com", confirm: "wrong" });
  check("delete_site requires exact confirm", r.error && panel.sites.length === 2, r.text);
  r = await s.call("delete_site", { site_id: 2, site: "b.com", confirm: "b.com" });
  check("delete_site with confirm", !r.error && panel.sites.length === 1, r.text);
  const del = panel.calls.find((c) => c.action === "DeleteSite");
  check("delete_site keeps files unless asked", del && del.params.path === undefined);

  r = await s.call("delete_path", { path: "/www/wwwroot", confirm: "/www/wwwroot", directory: true });
  check("delete_path refuses top-level dirs", r.error, r.text);

  r = await s.call("create_database", { name: "shop", password: "S3cure-pass!" });
  check("create_database", !r.error && panel.dbs.some((d) => d.name === "shop"), r.text);
  r = await s.call("delete_database", { database_id: 2, database: "shop", confirm: "shop" });
  check("delete_database", !r.error && !panel.dbs.some((d) => d.name === "shop"), r.text);

  r = await s.call("service_control", { service: "nginx", action: "reload" });
  check("service_control", !r.error, r.text);
  r = await s.call("service_control", { service: "nginx; rm -rf /", action: "reload" });
  check("service_control rejects bad names", r.error);

  r = await s.call("open_port", { port: "8080", remark: "test" });
  check("open_port", !r.error && panel.firewall.some((f) => f.port === "8080"));

  // Chunked upload (1.3 MB → 3 chunks) and download round trip.
  const big = Buffer.alloc(1_300_000, 0x61);
  big.write("START", 0);
  big.write("END", big.length - 3);
  const src = path.join(local, "big.bin");
  writeFileSync(src, big);
  r = await s.call("upload_file", { local_path: src, remote_dir: "/www/wwwroot/a.com" });
  const stored = panel.files.get("/www/wwwroot/a.com/big.bin");
  check("upload_file chunked", !r.error && stored?.length === big.length && stored.endsWith("END"), r.text);
  const uploadCalls = panel.calls.filter((c) => c.action === "upload").length;
  check("upload used multiple chunks", uploadCalls >= 3, uploadCalls + " calls");
  r = await s.call("upload_file", { local_path: "C:/Windows/win.ini", remote_dir: "/www/wwwroot/a.com" });
  check("upload_file rejects local paths outside AAPANEL_LOCAL_DIRS", r.error, r.text);
  const dest = path.join(local, "copy.bin");
  r = await s.call("download_file", { remote_path: "/www/wwwroot/a.com/big.bin", local_path: dest });
  check("download_file", !r.error && readFileSync(dest).equals(big), r.text);

  r = await s.call("run_command", { command: "echo hello-from-server", cwd: "/www/wwwroot/a.com" });
  check("run_command output + exit code", !r.error && r.text.includes("exit code: 0") && r.text.includes("hello-from-server"), r.text);
  r = await s.call("run_command", { command: "exit 3" });
  check("run_command non-zero exit", !r.error && r.text.includes("exit code: 3"), r.text);
  r = await s.call("run_command", { command: "echo x", cwd: "/etc" });
  check("run_command cwd guarded", r.error, r.text);

  r = await s.call("add_cron_shell_job", { name: "cleanup", schedule: "day", hour: 3, script: "find /tmp -mtime +7 -delete" });
  check("add_cron_shell_job", !r.error && panel.calls.some((c) => c.action === "AddCrontab" && c.params.sType === "toShell"), r.text);

  r = await s.call("api_call", { path: "site", action: "GetPHPVersion" });
  check("api_call raw", !r.error && r.text.includes("PHP-82"), r.text);
  s.stop();
}

// 4) Requests carry valid signatures and never the raw key.
check("api key never sent in clear", !panel.calls.some((c) => JSON.stringify(c.params).includes(KEY)));

panel.server.close();
console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
