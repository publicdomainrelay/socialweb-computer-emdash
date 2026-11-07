import type { APIRoute } from "astro";
import { getPublicOrigin } from "emdash/api/route-utils";
import { clientMetadata } from "../client";

export const prerender = false;

export const GET: APIRoute = async ({ request, locals }) =>
	Response.json(clientMetadata(getPublicOrigin(new URL(request.url), locals.emdash?.config)), {
		headers: { "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" },
	});
