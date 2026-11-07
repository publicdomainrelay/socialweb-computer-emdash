import type { APIRoute } from "astro";
import { apiError, apiSuccess, getPublicOrigin, handleError, isParseError, parseBody } from "emdash/api/route-utils";
import { atprotoLoginBody } from "emdash/api/schemas";
import { authorizeTarget, oauthClient } from "../client";
import { RETURN_TO_KEY, safeReturnTo } from "../policy";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, session }) => {
	const { emdash } = locals;
	if (!emdash?.db) return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	try {
		const body = await parseBody(request, atprotoLoginBody);
		if (isParseError(body)) return body;
		const url = new URL(request.url);
		const returnTo = safeReturnTo(url.searchParams.get("returnTo"));
		if (returnTo) session?.set(RETURN_TO_KEY, returnTo);
		else session?.delete(RETURN_TO_KEY);
		const client = await oauthClient(emdash, getPublicOrigin(url, emdash.config));
		const { url: authorizeUrl } = await client.authorize({ target: authorizeTarget(body.handle) });
		return apiSuccess({ url: authorizeUrl.toString() });
	} catch (error) {
		return handleError(error, "Failed to start Atmosphere login", "ATPROTO_LOGIN_ERROR");
	}
};
