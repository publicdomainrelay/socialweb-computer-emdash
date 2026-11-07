import { connectedAgent, handleConnect, MissingScopeError, oauthRoutes, parseInteraction } from "atproto-oauth-sandbox";
import type { SandboxedPlugin } from "emdash/plugin";
import { integration } from "./integration";
import { handleStatus, postStatus } from "./status";

const plugin: SandboxedPlugin = {
	hooks: {
		"content:afterPublish": {
			handler: async (event, ctx) => {
				const emoji = await ctx.settings.get<string>("publishEmoji");
				const agent = emoji ? await connectedAgent(ctx, integration) : undefined;
				if (!emoji || !agent) return;
				try {
					const uri = await postStatus(ctx, agent, emoji);
					ctx.log.info("Status posted on publish", { collection: event.collection, uri });
				} catch (error) {
					if (!(error instanceof MissingScopeError)) throw error;
					ctx.log.warn("Status on publish needs the status permission");
				}
			},
		},
	},
	routes: {
		...oauthRoutes(integration),
		admin: {
			handler: async (routeCtx, ctx) => {
				const interaction = parseInteraction(routeCtx.input);
				if (!interaction) return { blocks: [] };
				return (
					(await handleConnect(ctx, integration, interaction)) ??
					(await handleStatus(ctx, interaction)) ?? { blocks: [] }
				);
			},
		},
	},
};

export default plugin;
