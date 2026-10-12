import { z } from "zod";
import { confirm, remotePath, tail } from "../guard.js";
import type { Ctx } from "../registry.js";

const domain = z.string().regex(/^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(:\d{1,5})?$/i, "Invalid domain");
const siteName = z.string().min(1).max(253).describe("Site name as shown in aaPanel (usually the main domain)");
const siteId = z.number().int().positive().describe("Site id from list_sites");
const phpVersion = z.string().regex(/^(\d{2,3}|00|other)$/).describe('PHP version without dot, e.g. "82" for 8.2; "00" = static site');

export function register({ tool, api, cfg }: Ctx) {
  tool(
    "list_sites",
    {
      title: "List websites",
      description: "Websites in aaPanel with id, name, path, status, PHP version, expiry and remark.",
      input: z.object({
        search: z.string().max(100).optional(),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(500).default(100),
      }),
      level: "read",
    },
    ({ search, page, limit }) => api.call("data", "getData", { table: "sites", type: -1, p: page, limit, search, order: "id desc", tojs: "" }),
  );

  tool(
    "list_site_domains",
    {
      title: "Site domains",
      description: "Domains bound to a site.",
      input: z.object({ site_id: siteId }),
      level: "read",
    },
    ({ site_id }) => api.call("data", "getData", { table: "domain", list: "True", search: site_id }),
  );

  tool(
    "site_logs",
    {
      title: "Site access / error log",
      description: "Last lines of a site's web server access log or error log.",
      input: z.object({ site: siteName, kind: z.enum(["access", "error"]).default("access") }),
      level: "read",
    },
    async ({ site, kind }) => {
      const r = await api.call<{ msg?: string }>("site", kind === "access" ? "GetSiteLogs" : "get_site_err_log", { siteName: site });
      return tail(typeof r === "string" ? r : String(r?.msg ?? JSON.stringify(r)));
    },
  );

  tool(
    "list_php_versions",
    { title: "Installed PHP versions", description: "PHP versions installed on the server.", input: z.object({}), level: "read" },
    () => api.call("site", "GetPHPVersion"),
  );

  tool(
    "get_site_php_version",
    { title: "Site PHP version", description: "PHP version used by a site.", input: z.object({ site: siteName }), level: "read" },
    ({ site }) => api.call("site", "GetSitePHPVersion", { siteName: site }),
  );

  tool(
    "list_backups",
    {
      title: "List backups",
      description: "Backups of one site or database (from backup_site / backup_database or scheduled tasks).",
      input: z.object({ kind: z.enum(["site", "database"]), id: z.number().int().positive().describe("Site or database id") }),
      level: "read",
    },
    ({ kind, id }) => api.call("data", "getData", { table: "backup", search: id, type: kind === "site" ? 0 : 1, limit: 100, p: 1, tojs: "" }),
  );

  // ---- write ----
  tool(
    "create_site",
    {
      title: "Create website",
      description: "Create a website (nginx/apache vhost + directory), optionally with a MySQL database.",
      input: z.object({
        domains: z.array(domain).min(1).max(50).describe("First is the main domain"),
        path: z.string().optional().describe("Web root; default /www/wwwroot/<main domain>"),
        php_version: phpVersion.default("00"),
        port: z.number().int().min(1).max(65535).default(80),
        remark: z.string().max(200).optional(),
        database: z
          .object({
            name: z.string().regex(/^[A-Za-z0-9_]{1,64}$/),
            user: z.string().regex(/^[A-Za-z0-9_]{1,32}$/),
            password: z.string().min(8).max(64),
          })
          .optional()
          .describe("Also create a MySQL database for the site"),
      }),
      level: "write",
    },
    ({ domains, path, php_version, port, remark, database }) => {
      const [main, ...rest] = domains;
      const root = remotePath(cfg, path || `/www/wwwroot/${main.split(":")[0]}`);
      return api.call("site", "AddSite", {
        webname: JSON.stringify({ domain: main, domainlist: rest, count: rest.length }),
        path: root,
        type_id: 0,
        type: "PHP",
        version: php_version,
        port,
        ps: remark || main,
        ftp: "false",
        sql: database ? "MySQL" : "false",
        datauser: database?.user,
        datapassword: database?.password,
        codeing: "utf8mb4",
        need_index: 0,
        need_404: 0,
        add_dns_record: "false",
      });
    },
  );

  tool(
    "set_site_running",
    {
      title: "Start or stop a site",
      description: "Stop (show the 'site stopped' page) or start a website.",
      input: z.object({ site_id: siteId, site: siteName, running: z.boolean() }),
      level: "write",
      destructive: true,
    },
    ({ site_id, site, running }) => api.call("site", running ? "SiteStart" : "SiteStop", { id: site_id, name: site }),
  );

  tool(
    "add_site_domains",
    {
      title: "Add domains to a site",
      description: "Bind extra domains (optionally domain:port) to a site.",
      input: z.object({ site_id: siteId, site: siteName, domains: z.array(domain).min(1).max(50) }),
      level: "write",
    },
    ({ site_id, site, domains }) => api.call("site", "AddDomain", { id: site_id, webname: site, domain: domains.join(",") }),
  );

  tool(
    "remove_site_domain",
    {
      title: "Remove a domain from a site",
      description: "Unbind one domain from a site.",
      input: z.object({ site_id: siteId, site: siteName, domain, port: z.number().int().default(80) }),
      level: "write",
      destructive: true,
    },
    ({ site_id, site, domain, port }) => api.call("site", "DelDomain", { id: site_id, webname: site, domain: domain.split(":")[0], port }),
  );

  tool(
    "set_site_php_version",
    {
      title: "Change site PHP version",
      description: "Switch a site to another installed PHP version (see list_php_versions).",
      input: z.object({ site: siteName, php_version: phpVersion }),
      level: "write",
    },
    ({ site, php_version }) => api.call("site", "SetPHPVersion", { siteName: site, version: php_version }),
  );

  tool(
    "set_force_https",
    {
      title: "Force HTTPS",
      description: "Turn HTTP→HTTPS redirection on or off for a site that already has SSL.",
      input: z.object({ site: siteName, enabled: z.boolean() }),
      level: "write",
    },
    ({ site, enabled }) => api.call("site", enabled ? "HttpToHttps" : "CloseToHttps", { siteName: site }),
  );

  tool(
    "backup_site",
    {
      title: "Back up a site",
      description: "Create a compressed backup of the site files (stored in the panel backup directory).",
      input: z.object({ site_id: siteId }),
      level: "write",
    },
    ({ site_id }) => api.call("site", "ToBackup", { id: site_id }),
  );

  tool(
    "delete_site",
    {
      title: "Delete website",
      description:
        "DESTRUCTIVE. Remove a site's vhost; optionally also its files, database and FTP account. Only call after the user explicitly approves, with confirm = the site name.",
      input: z.object({
        site_id: siteId,
        site: siteName,
        delete_files: z.boolean().default(false),
        delete_database: z.boolean().default(false),
        delete_ftp: z.boolean().default(false),
        confirm: z.string().describe("Must equal the site name"),
      }),
      level: "write",
      destructive: true,
    },
    ({ site_id, site, delete_files, delete_database, delete_ftp, confirm: c }) => {
      confirm(site, c, `delete site ${site}`);
      return api.call("site", "DeleteSite", {
        id: site_id,
        webname: site,
        ...(delete_files ? { path: 1 } : {}),
        ...(delete_database ? { database: 1 } : {}),
        ...(delete_ftp ? { ftp: 1 } : {}),
      });
    },
  );
}
