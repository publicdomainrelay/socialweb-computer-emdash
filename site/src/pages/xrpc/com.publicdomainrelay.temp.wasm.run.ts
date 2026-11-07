import type { APIRoute } from "astro";
import { postPublicPlugin } from "../../utils/integrations";

export const prerender = false;

const BEARER = /^Bearer\s+(\S+)$/i;

const xrpcError = (status: number, error: string, message: string) => Response.json({ error, message }, { status });

export const POST: APIRoute = async ({ request, locals, url }) => {
	const token = BEARER.exec(request.headers.get("authorization") ?? "")?.[1];
	if (!token) return xrpcError(401, "AuthenticationRequired", "Service auth token required");
	const body: unknown = await request.json().catch(() => null);
	if (typeof body !== "object" || body === null || Array.isArray(body)) return xrpcError(400, "InvalidRequest", "Body must be a JSON object");
	const result = await postPublicPlugin<Record<string, unknown>>(locals, url, "service/run", { ...body, token }).catch((error: unknown) => ({
		error: "InternalServerError",
		message: error instanceof Error ? error.message : "Run failed",
	}));
	if (typeof result.error === "string") {
		const status = result.error === "AuthenticationRequired" ? 401 : result.error === "InvalidRequest" ? 400 : 500;
		return xrpcError(status, result.error, String(result.message ?? result.error));
	}
	return Response.json(result);
};

export const GET: APIRoute = () => xrpcError(405, "InvalidRequest", "Use POST");
