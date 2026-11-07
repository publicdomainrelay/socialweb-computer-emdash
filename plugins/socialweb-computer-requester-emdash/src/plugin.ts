import { handleConnect, oauthRoutes, parseInteraction } from "atproto-oauth-sandbox";
import type { SandboxedPlugin } from "emdash/plugin";
import { integration } from "./integration";
import { handleRequester } from "./requester";

const plugin: SandboxedPlugin = {
	routes: {
		...oauthRoutes(integration),
		admin: {
			handler: async (routeCtx, ctx) => {
				const interaction = parseInteraction(routeCtx.input);
				if (!interaction) return { blocks: [] };
				return (
					(await handleConnect(ctx, integration, interaction)) ??
					(await handleRequester(ctx, interaction)) ?? { blocks: [] }
				);
			},
		},
	},
};

export default plugin;
