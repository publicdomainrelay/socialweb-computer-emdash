import { pluginResponse, pluginRoute, type RouteEntry } from "emdash/plugin";
import { adminPath, clientMetadata, type Integration } from "./client";
import { CONNECT_PAGE } from "./connect";
import { completeAuthorization } from "./oauth";
import { setNotice } from "./store";

const asParams = (input: Record<string, string | string[]>) =>
	Object.fromEntries(Object.entries(input).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));

export function oauthRoutes(integration: Integration): Record<string, RouteEntry> {
	return {
		"oauth/client-metadata": pluginRoute({
			public: true,
			methods: ["GET"],
			request: { body: "none" },
			response: "raw",
			cacheControl: "public, max-age=300",
			handler: async (_routeCtx, ctx) =>
				pluginResponse({
					status: 200,
					headers: { "content-type": "application/json" },
					body: { kind: "text", value: JSON.stringify(clientMetadata(ctx, integration)) },
				}),
		}),
		"oauth/callback": pluginRoute({
			public: true,
			methods: ["GET"],
			request: { body: "none" },
			response: "raw",
			handler: async (routeCtx, ctx) => {
				try {
					const session = await completeAuthorization(ctx, integration, asParams(routeCtx.input));
					await setNotice(ctx, `Connected as ${session.handle ?? session.did}`);
				} catch (error) {
					await setNotice(ctx, error instanceof Error ? error.message : "Authorization failed");
				}
				return pluginResponse({ status: 303, headers: { location: adminPath(ctx, CONNECT_PAGE) } });
			},
		}),
	};
}
