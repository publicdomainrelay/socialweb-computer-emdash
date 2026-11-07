import type { APIRoute } from "astro";
import {
	apiError,
	apiSuccess,
	getPublicOrigin,
	handleError,
	isParseError,
	OptionsRepository,
	parseBody,
} from "emdash/api/route-utils";
import { setupAtprotoAdminBody } from "emdash/api/schemas";
import { authorizeTarget, oauthClient } from "../client";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
	const { emdash } = locals;
	if (!emdash?.db) return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	try {
		const options = new OptionsRepository(emdash.db);
		const setupComplete = await options.get("emdash:setup_complete");
		if (setupComplete === true || setupComplete === "true") return apiError("SETUP_COMPLETE", "Setup already complete", 400);
		const body = await parseBody(request, setupAtprotoAdminBody);
		if (isParseError(body)) return body;
		const state = (await options.get<Record<string, unknown>>("emdash:setup_state")) ?? {};
		await options.set("emdash:setup_state", { ...state, step: "atproto_admin", handle: body.handle });
		const client = await oauthClient(emdash, getPublicOrigin(new URL(request.url), emdash.config));
		const { url } = await client.authorize({ target: authorizeTarget(body.handle) });
		return apiSuccess({ url: url.toString() });
	} catch (error) {
		return handleError(error, "Failed to start Atmosphere setup", "SETUP_ATPROTO_ERROR");
	}
};
