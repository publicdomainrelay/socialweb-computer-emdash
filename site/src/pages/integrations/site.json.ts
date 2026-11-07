import type { APIRoute } from "astro";

export const prerender = false;

export const GET: APIRoute = () =>
	Response.json(
		{ integrations: (process.env.EMDASH_SITE_INTEGRATIONS ?? "").split(/\s+/).filter((uri) => uri.startsWith("at://")) },
		{ headers: { "cache-control": "public, max-age=300" } },
	);
