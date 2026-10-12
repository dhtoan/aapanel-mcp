import { z } from "zod";
import { confirm, remotePath } from "../guard.js";
import type { Ctx } from "../registry.js";

const dbName = z.string().regex(/^[A-Za-z0-9_]{1,64}$/, "Letters, digits and _ only");
const dbId = z.number().int().positive().describe("Database id from list_databases");

export function register({ tool, api, cfg }: Ctx) {
  tool(
    "list_databases",
    {
      title: "List MySQL databases",
      description: "MySQL databases managed by aaPanel (id, name, user, access host, remark, backups count).",
      input: z.object({ search: z.string().max(100).optional(), page: z.number().int().min(1).default(1), limit: z.number().int().min(1).max(500).default(100) }),
      level: "read",
    },
    async ({ search, page, limit }) => {
      const r = await api.call<{ data?: Record<string, unknown>[] }>("data", "getData", { table: "databases", p: page, limit, search, tojs: "" });
      // Never echo stored database passwords back to the model.
      if (r && Array.isArray(r.data)) for (const row of r.data) if ("password" in row) row.password = "••••";
      return r;
    },
  );

  tool(
    "mysql_info",
    { title: "MySQL server info", description: "MySQL version, data directory and port.", input: z.object({}), level: "read" },
    () => api.call("database", "GetMySQLInfo"),
  );

  // ---- write ----
  tool(
    "create_database",
    {
      title: "Create database",
      description: "Create a MySQL database and user (utf8mb4).",
      input: z.object({
        name: dbName,
        user: z.string().regex(/^[A-Za-z0-9_]{1,32}$/).optional().describe("Default: same as name"),
        password: z.string().min(8).max(64),
        access: z.string().max(255).default("127.0.0.1").describe('Allowed host: "127.0.0.1" (local), "%" (anywhere) or an IP'),
        remark: z.string().max(200).optional(),
      }),
      level: "write",
    },
    ({ name, user, password, access, remark }) =>
      api.call("database", "AddDatabase", {
        name,
        db_user: user || name,
        password,
        address: access,
        dataAccess: access === "127.0.0.1" ? "127.0.0.1" : access === "%" ? "%" : "ip",
        codeing: "utf8mb4",
        dtype: "MySQL",
        ps: remark || name,
        sid: 0,
      }),
  );

  tool(
    "backup_database",
    { title: "Back up database", description: "Create a SQL dump backup of a database.", input: z.object({ database_id: dbId }), level: "write" },
    ({ database_id }) => api.call("database", "ToBackup", { id: database_id }),
  );

  tool(
    "import_sql",
    {
      title: "Import SQL file",
      description: "Import a .sql / .sql.gz / .zip file that is already on the server into a database (overwrites tables it contains).",
      input: z.object({ database: dbName, file: z.string().describe("Server path of the SQL file") }),
      level: "write",
      destructive: true,
    },
    ({ database, file }) => api.call("database", "InputSql", { name: database, file: remotePath(cfg, file) }),
  );

  tool(
    "set_database_password",
    {
      title: "Change database password",
      description: "Set a new password for a database user. Apps using the old password stop connecting until updated.",
      input: z.object({ database_id: dbId, database: dbName, password: z.string().min(8).max(64) }),
      level: "write",
      destructive: true,
    },
    ({ database_id, database, password }) => api.call("database", "ResDatabasePassword", { id: database_id, name: database, password }),
  );

  tool(
    "delete_database",
    {
      title: "Delete database",
      description: "DESTRUCTIVE. Drop a database and its user. Only after explicit user approval, with confirm = the database name.",
      input: z.object({ database_id: dbId, database: dbName, confirm: z.string() }),
      level: "write",
      destructive: true,
    },
    ({ database_id, database, confirm: c }) => {
      confirm(database, c, `delete database ${database}`);
      return api.call("database", "DeleteDatabase", { id: database_id, name: database });
    },
  );
}
