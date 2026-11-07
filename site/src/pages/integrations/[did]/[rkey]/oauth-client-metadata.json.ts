import type { APIRoute } from "astro";
import { callPublicPlugin } from "../../../../utils/integrations";

export const prerender = false;

export const GET: APIRoute = async ({ params, locals, url }) => {
	const metadata = await callPublicPlugin<Record<string, unknown>>(locals, url, "client-metadata", {
		did: params.did ?? "",
		rkey: params.rkey ?? "",
	}).catch(() => ({ error: "NOT_FOUND" }));
	return Response.json(metadata, {
		status: "error" in metadata ? 404 : 200,
		headers: { "cache-control": "public, max-age=60" },
	});
};
