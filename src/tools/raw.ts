import { z } from "zod";
import type { Ctx } from "../registry.js";

/** Escape hatch for panel features without a dedicated tool (SSL, redirects, proxies, PHP config, plugins…). */
export function register({ tool, api }: Ctx) {
  tool(
    "api_call",
    {
      title: "Raw aaPanel API call",
      description:
        'Call any aaPanel API action directly, e.g. path "site" + action "GetSSL" + params {siteName}, or path "datalist/data/get_data_list". Read the result carefully; many actions change the server. Prefer the dedicated tools when one exists.',
      input: z.object({
        path: z.string().regex(/^[A-Za-z0-9_\-/]+$/, "Route only, e.g. site, files, v2/site").describe("Route, e.g. site, files, database, ajax, config, plugin"),
        action: z.string().regex(/^[A-Za-z0-9_]+$/).optional().describe("Value for ?action="),
        params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
      }),
      level: "raw",
    },
    ({ path, action, params }) => api.call(path, action ?? null, params),
  );
}
