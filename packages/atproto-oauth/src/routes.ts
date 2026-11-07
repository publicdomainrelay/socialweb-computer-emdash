import type { BlockResponse } from "@emdash-cms/blocks";
import { type PluginContext, pluginResponse, pluginRoute, type RouteEntry } from "emdash/plugin";
import { adminPath, clientMetadata, type Integration } from "./client";
import { CONNECT_PAGE, handleConnect } from "./connect";
import { type Interaction, parseInteraction } from "./interaction";
import { completeAuthorization } from "./oauth";
import { setNotice } from "./store";

export type PageHandler = (ctx: PluginContext, interaction: Interaction) => Promise<BlockResponse | undefined>;

const asParams = (input: Record<string, string | string[]>) =>
	Object.fromEntries(Object.entries(input).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));

const withRequestOrigin = (ctx: PluginContext, requestUrl: string): PluginContext =>
	ctx.site.url ? ctx : Object.create(ctx, { site: { value: { ...ctx.site, url: new URL(requestUrl).origin } } });

export function integrationRoutes(integration: Integration, ...pages: PageHandler[]): Record<string, RouteEntry> {
	const handlers: PageHandler[] = [(ctx, interaction) => handleConnect(ctx, integration, interaction), ...pages];
	return {
		"oauth/client-metadata": pluginRoute({
			public: true,
			methods: ["GET"],
			request: { body: "none" },
			response: "raw",
			cacheControl: "public, max-age=300",
			handler: async (routeCtx, ctx) =>
				pluginResponse({
					status: 200,
					headers: { "content-type": "application/json" },
					body: {
						kind: "text",
						value: JSON.stringify(clientMetadata(withRequestOrigin(ctx, routeCtx.request.url), integration)),
					},
				}),
		}),
		"oauth/callback": pluginRoute({
			public: true,
			methods: ["GET"],
			request: { body: "none" },
			response: "raw",
			handler: async (routeCtx, ctx) => {
				const scoped = withRequestOrigin(ctx, routeCtx.request.url);
				try {
					const session = await completeAuthorization(scoped, integration, asParams(routeCtx.input));
					await setNotice(scoped, `Connected as ${session.handle ?? session.did}`);
				} catch (error) {
					await setNotice(scoped, error instanceof Error ? error.message : "Authorization failed");
				}
				return pluginResponse({ status: 303, headers: { location: adminPath(scoped, CONNECT_PAGE) } });
			},
		}),
		admin: {
			handler: async (routeCtx, ctx) => {
				const interaction = parseInteraction(routeCtx.input);
				if (!interaction) return { blocks: [] };
				const scoped = withRequestOrigin(ctx, routeCtx.request.url);
				for (const handle of handlers) {
					const response = await handle(scoped, interaction);
					if (response) return response;
				}
				return { blocks: [] };
			},
		},
	};
}
