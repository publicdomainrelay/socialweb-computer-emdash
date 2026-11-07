import type { APIRoute } from "astro";
import { callPublicPlugin } from "../../utils/integrations";

export const prerender = false;

export const GET: APIRoute = async ({ locals, url }) =>
	Response.json(await callPublicPlugin<Record<string, unknown>>(locals, url, "service/did", {}), {
		headers: { "cache-control": "public, max-age=300" },
	});
