import { open, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { PanelError } from "../client.js";
import { confirm, localPath, remotePath } from "../guard.js";
import type { Ctx } from "../registry.js";

const rpath = z.string().min(1).max(4096).describe("Absolute path on the server, e.g. /www/wwwroot/example.com");
const CHUNK = 512 * 1024;

export function register({ tool, api, cfg }: Ctx) {
  const R = (p: string) => remotePath(cfg, p);

  tool(
    "list_dir",
    {
      title: "List directory",
      description: "Files and folders in a server directory with size, permissions, owner and modification time.",
      input: z.object({
        path: rpath,
        search: z.string().max(100).optional(),
        page: z.number().int().min(1).default(1),
        per_page: z.number().int().min(1).max(500).default(200),
      }),
      level: "read",
    },
    ({ path: p, search, page, per_page }) => api.call("files", "GetDir", { path: R(p), p: page, showRow: per_page, search }),
  );

  tool(
    "read_file",
    {
      title: "Read text file",
      description: "Read a text file on the server (configs, code, logs; up to ~3 MB). Returns content, encoding and size.",
      input: z.object({ path: rpath }),
      level: "read",
    },
    async ({ path: p }) => {
      const r = await api.call<{ data?: string; encoding?: string; size?: number; only_read?: boolean }>("files", "GetFileBody", { path: R(p) });
      return `# ${p} (${r.size ?? "?"} bytes, ${r.encoding ?? "?"}${r.only_read ? ", read-only: file too large to edit" : ""})\n\n${r.data ?? ""}`;
    },
  );

  tool(
    "path_size",
    { title: "Directory size", description: "Total size of a file or directory.", input: z.object({ path: rpath }), level: "read" },
    ({ path: p }) => api.call("files", "get_path_size", { path: R(p) }),
  );

  tool(
    "download_file",
    {
      title: "Download file to this computer",
      description: "Download a file from the server (e.g. a backup) to a local path under AAPANEL_LOCAL_DIRS.",
      input: z.object({ remote_path: rpath, local_path: z.string().min(1).describe("Local destination file path") }),
      level: "read",
    },
    async ({ remote_path, local_path }) => {
      const dest = localPath(cfg, local_path);
      const bytes = await api.download(R(remote_path), dest);
      return `Saved ${bytes} bytes to ${dest}`;
    },
  );

  // ---- write ----
  tool(
    "write_file",
    {
      title: "Write text file",
      description: "Create or overwrite a UTF-8 text file on the server. Overwrites existing content: read it first when editing.",
      input: z.object({ path: rpath, content: z.string().max(3_000_000) }),
      level: "write",
      destructive: true,
      idempotent: true,
    },
    async ({ path: p, content }) => {
      const target = R(p);
      try {
        await api.call("files", "SaveFileBody", { path: target, data: content, encoding: "utf-8" });
      } catch (e) {
        if (!(e instanceof PanelError) || !/not exist|exist/i.test(e.message)) throw e;
        await api.call("files", "CreateFile", { path: target });
        await api.call("files", "SaveFileBody", { path: target, data: content, encoding: "utf-8" });
      }
      return `Saved ${Buffer.byteLength(content)} bytes to ${target}`;
    },
  );

  tool(
    "create_dir",
    { title: "Create directory", description: "Create a directory on the server.", input: z.object({ path: rpath }), level: "write" },
    ({ path: p }) => api.call("files", "CreateDir", { path: R(p) }),
  );

  tool(
    "move_path",
    {
      title: "Move / rename",
      description: "Move or rename a file or directory on the server.",
      input: z.object({ source: rpath, destination: rpath }),
      level: "write",
      destructive: true,
    },
    ({ source, destination }) => api.call("files", "MvFile", { sfile: R(source), dfile: R(destination), rename: "true" }),
  );

  tool(
    "copy_path",
    {
      title: "Copy file or directory",
      description: "Copy a file or directory on the server.",
      input: z.object({ source: rpath, destination: rpath, directory: z.boolean().default(false).describe("true when source is a directory") }),
      level: "write",
    },
    ({ source, destination, directory }) => api.call("files", directory ? "CopyDir" : "CopyFile", { sfile: R(source), dfile: R(destination) }),
  );

  tool(
    "compress",
    {
      title: "Compress files",
      description: "Create a zip or tar.gz archive from files/folders inside one directory.",
      input: z.object({
        directory: rpath.describe("Directory that contains the items"),
        items: z.array(z.string().regex(/^[^/\\]+$/, "Item names only, no slashes")).min(1).describe("File/folder names inside directory"),
        archive: rpath.describe("Archive path to create, e.g. /www/backup/site.zip"),
        format: z.enum(["zip", "tar.gz"]).default("zip"),
      }),
      level: "write",
    },
    ({ directory, items, archive, format }) =>
      api.call("files", "Zip", { path: R(directory), sfile: items.join(","), dfile: R(archive), z_type: format }),
  );

  tool(
    "extract",
    {
      title: "Extract archive",
      description: "Extract a zip / tar.gz / rar archive on the server into a directory (existing files may be overwritten).",
      input: z.object({ archive: rpath, destination: rpath, password: z.string().max(200).optional() }),
      level: "write",
      destructive: true,
    },
    ({ archive, destination, password }) =>
      api.call("files", "UnZip", { sfile: R(archive), dfile: R(destination), password, coding: "UTF-8", type: archive.endsWith(".zip") ? "zip" : "tar" }),
  );

  tool(
    "set_permissions",
    {
      title: "Set permissions / owner",
      description: "chmod/chown a file or directory (e.g. 755 www).",
      input: z.object({
        path: rpath,
        mode: z.string().regex(/^[0-7]{3,4}$/).default("755"),
        owner: z.string().regex(/^[a-z_][a-z0-9_-]{0,31}$/).default("www"),
        recursive: z.boolean().default(false),
      }),
      level: "write",
    },
    ({ path: p, mode, owner, recursive }) =>
      api.call("files", "SetFileAccess", { filename: R(p), access: mode, user: owner, all: recursive ? "True" : "False" }),
  );

  tool(
    "upload_file",
    {
      title: "Upload file from this computer",
      description: "Upload a local file (under AAPANEL_LOCAL_DIRS) to a server directory, in chunks. Replaces a file with the same name.",
      input: z.object({
        local_path: z.string().min(1),
        remote_dir: rpath,
        remote_name: z.string().regex(/^[^/\\]+$/).optional().describe("Default: local file name"),
      }),
      level: "write",
      destructive: true,
    },
    async ({ local_path, remote_dir, remote_name }) => {
      const src = localPath(cfg, local_path);
      const dir = R(remote_dir);
      const name = remote_name || path.basename(src);
      R(`${dir}/${name}`);
      const size = (await stat(src)).size;
      const fh = await open(src, "r");
      try {
        let start = 0;
        const buf = Buffer.alloc(CHUNK);
        for (let guard = 0; guard < 100_000; guard++) {
          const { bytesRead } = await fh.read(buf, 0, CHUNK, start);
          const r = await api.call<unknown>("files", "upload", {
            f_path: dir,
            f_name: name,
            f_size: size,
            f_start: start,
            b64_data: buf.subarray(0, bytesRead).toString("base64"),
          });
          // The panel answers with the bytes received so far, or a status object once complete.
          if (typeof r === "number" || (typeof r === "string" && /^\d+$/.test(r))) {
            const next = Number(r);
            if (next <= start && bytesRead > 0) throw new PanelError(`Upload stalled at byte ${start}`);
            start = next;
            continue;
          }
          return `Uploaded ${size} bytes to ${dir}/${name}`;
        }
        throw new PanelError("Upload did not finish");
      } finally {
        await fh.close();
      }
    },
  );

  tool(
    "fetch_url_to_server",
    {
      title: "Download URL onto the server",
      description: "Have the server download a file from a URL into a directory (runs as a panel background task).",
      input: z.object({ url: z.string().url().regex(/^https?:\/\//), directory: rpath, filename: z.string().regex(/^[^/\\]+$/) }),
      level: "write",
    },
    ({ url, directory, filename }) => api.call("files", "DownloadFile", { url, path: R(directory), filename }),
  );

  tool(
    "delete_path",
    {
      title: "Delete file or directory",
      description:
        "DESTRUCTIVE. Delete a file or directory (goes to the panel recycle bin if it is enabled). Only after explicit user approval, with confirm = the exact path.",
      input: z.object({ path: rpath, directory: z.boolean().default(false), confirm: z.string().describe("Must equal path") }),
      level: "write",
      destructive: true,
    },
    ({ path: p, directory, confirm: c }) => {
      const target = R(p);
      if (cfg.remoteRoots.includes(target) || target.split("/").length < 4) {
        throw new PanelError(`Refusing to delete top-level path ${target}`);
      }
      confirm(p, c, `delete ${target}`);
      return api.call("files", directory ? "DeleteDir" : "DeleteFile", { path: target });
    },
  );
}
