// Minimal aaPanel API emulator for tests: same auth check as BTPanel/common.py (md5(request_time + md5(key))),
// form-encoded POST /<module>?action=<name>, GET /download. In-memory state only.
import { createHash } from "node:crypto";
import http from "node:http";

const md5 = (s) => createHash("md5").update(s).digest("hex");

export function startMockPanel(key) {
  const files = new Map([["/www/wwwroot/a.com/index.php", "<?php echo 'hi';"]]);
  const dirs = new Set(["/www", "/www/wwwroot", "/www/wwwroot/a.com", "/tmp", "/www/backup"]);
  const sites = [{ id: 1, name: "a.com", path: "/www/wwwroot/a.com", status: "1", ps: "a.com" }];
  const dbs = [{ id: 1, name: "a_db", username: "a_db", password: "secret-pass", accept: "127.0.0.1" }];
  const firewall = [{ id: 1, port: "22", ps: "SSH" }];
  const calls = [];
  const uploads = new Map();

  const ok = (msg = "Successfully") => ({ status: true, msg });
  const fail = (msg) => ({ status: false, msg });

  const handlers = {
    "system.GetSystemTotal": () => ({ system: "Ubuntu 22.04", version: "7.0.0", cpuNum: 2, memTotal: 3900 }),
    "system.GetDiskInfo": () => [{ path: "/", size: ["40G", "12G", "28G", "30%"] }],
    "system.GetNetWork": () => ({ load: { one: 0.1 }, cpu: [3, 2], mem: { memTotal: 3900 }, up: 1, down: 2, upTotal: 3, downTotal: 4 }),
    "system.ServiceAdmin": (p) => (["nginx", "mysqld"].includes(p.name) || p.name.startsWith("php-fpm") ? ok(`${p.name} ${p.type}`) : fail("unknown service")),
    "data.getData": (p) => {
      const rows = { sites, databases: dbs, firewall, logs: [{ id: 1, type: "API", log: "test" }], backup: [], domain: [{ id: 1, pid: 1, name: "a.com", port: 80 }] }[p.table];
      if (!rows) return fail("bad table");
      return { data: rows.filter((r) => !p.search || JSON.stringify(r).includes(p.search)).map((r) => ({ ...r })), page: "" };
    },
    "site.GetPHPVersion": () => [{ version: "00", name: "Static" }, { version: "82", name: "PHP-82" }],
    "site.GetSitePHPVersion": (p) => ({ phpversion: p.siteName === "a.com" ? "82" : "00" }),
    "site.GetSiteLogs": () => ok("1.2.3.4 - - GET / 200"),
    "site.get_site_err_log": () => ok("no errors"),
    "site.AddSite": (p) => {
      const w = JSON.parse(p.webname);
      if (sites.some((s) => s.name === w.domain)) return fail("Site already exists");
      sites.push({ id: sites.length + 1, name: w.domain, path: p.path, status: "1", ps: p.ps });
      dirs.add(p.path);
      return { siteStatus: true, ftpStatus: false, databaseStatus: p.sql !== "false" };
    },
    "site.SiteStop": () => ok("Site stopped"),
    "site.SiteStart": () => ok("Site started"),
    "site.DeleteSite": (p) => {
      const i = sites.findIndex((s) => String(s.id) === p.id && s.name === p.webname);
      if (i < 0) return fail("Specified site does NOT exist");
      sites.splice(i, 1);
      return ok("Site deleted");
    },
    "site.ToBackup": () => ok("Backup successful"),
    "files.GetDir": (p) => {
      if (!dirs.has(p.path)) return fail("Directory does not exist");
      const kids = (set) => [...set].filter((x) => x !== p.path && x.startsWith(p.path + "/") && !x.slice(p.path.length + 1).includes("/"));
      return { PATH: p.path, DIR: kids(dirs).map((d) => d.split("/").pop()), FILES: kids(new Set(files.keys())).map((f) => f.split("/").pop()) };
    },
    "files.GetFileBody": (p) => (files.has(p.path) ? { status: true, data: files.get(p.path), encoding: "utf-8", size: files.get(p.path).length } : fail("Configuration file not exist")),
    "files.SaveFileBody": (p) => (files.has(p.path) ? (files.set(p.path, p.data), ok("File saved")) : fail("Configuration file not exist")),
    "files.CreateFile": (p) => (files.set(p.path, ""), ok("File created")),
    "files.CreateDir": (p) => (dirs.add(p.path), ok("Directory created")),
    "files.DeleteFile": (p) => (files.delete(p.path) ? ok("Deleted") : fail("File does not exist")),
    "files.get_path_size": () => ({ size: 1234 }),
    "files.upload": (p) => {
      const tmpKey = `${p.f_path}/${p.f_name}`;
      const have = uploads.get(tmpKey) ?? Buffer.alloc(0);
      if (have.length !== Number(p.f_start)) return have.length;
      const next = Buffer.concat([have, Buffer.from(p.b64_data, "base64")]);
      if (next.length !== Number(p.f_size)) {
        uploads.set(tmpKey, next);
        return next.length;
      }
      uploads.delete(tmpKey);
      files.set(tmpKey, next.toString("latin1"));
      return ok("Upload success");
    },
    "files.ExecShell": (p) => {
      // Emulates the background run: extract "{\n<cmd>\n} > <out> ..." and fake a few commands.
      const m = /^\{\n([\s\S]*)\n\} > (\/tmp\/aapanel-mcp-[0-9a-f]+\.log)/.exec(p.shell);
      if (m) {
        const [, cmd, out] = m;
        let output = `ran in ${p.path}: ${cmd}\n`;
        let code = 0;
        if (cmd === "exit 3") code = 3;
        if (cmd.startsWith("echo ")) output = cmd.slice(5) + "\n";
        setTimeout(() => files.set(out, `${output}__AAPANEL_MCP_EXIT__=${code}\n`), cmd === "sleep" ? 60_000 : 400);
      } else if (p.shell.startsWith("rm -f ")) {
        files.delete(p.shell.slice(6));
      }
      return ok("Command sent");
    },
    "database.AddDatabase": (p) => (dbs.push({ id: dbs.length + 1, name: p.name, username: p.db_user, password: p.password, accept: p.address }), ok("Database added")),
    "database.DeleteDatabase": (p) => {
      const i = dbs.findIndex((d) => String(d.id) === p.id && d.name === p.name);
      if (i < 0) return fail("Database does not exist");
      dbs.splice(i, 1);
      return ok("Database deleted");
    },
    "crontab.GetCrontab": () => [{ id: 1, name: "Backup a.com", type: "day" }],
    "crontab.AddCrontab": (p) => ({ status: true, msg: "Added", id: 2, body: p.sBody }),
    "firewall.GetList": () => null,
    "firewall.AddAcceptPort": (p) => (firewall.push({ id: firewall.length + 1, port: p.port, ps: p.ps }), ok("Port opened")),
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    let body = "";
    for await (const c of req) body += c;
    const form = Object.fromEntries(new URLSearchParams(body));
    const q = Object.fromEntries(url.searchParams);
    const p = { ...q, ...form };
    const send = (code, data, type = "application/json") => {
      res.writeHead(code, { "Content-Type": type });
      res.end(typeof data === "string" ? data : JSON.stringify(data));
    };
    if (!p.request_time || p.request_token !== md5(p.request_time + md5(key))) {
      return send(200, "<!doctype html><html><body>login</body></html>", "text/html");
    }
    const module = url.pathname.replace(/^\//, "");
    calls.push({ module, action: p.action, params: p });
    if (module === "download") {
      if (!files.has(p.filename)) return send(200, fail("File not exists"));
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      return res.end(Buffer.from(files.get(p.filename), "latin1"));
    }
    const h = handlers[`${module}.${p.action}`];
    if (!h) return send(200, fail(`unknown action ${module}.${p.action}`));
    send(200, h(p));
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${server.address().port}`, server, calls, files, sites, dbs, firewall })),
  );
}
