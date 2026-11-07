import { type PluginContext, pluginResponse, pluginRoute, type SandboxedPlugin, type SandboxedRouteContext } from "emdash/plugin";
import { beginConnect, completeConnect, disconnect, listIntegrations, servedMetadata, sessionAgent } from "./flow";
import { runModule } from "./modules";
import { parseRef } from "./record";

const PERMISSION = "auth:manage_own_credentials" as const;

type Input = Record<string, unknown>;

const inputOf = (routeCtx: SandboxedRouteContext): Input =>
	typeof routeCtx.input === "object" && routeCtx.input !== null ? (routeCtx.input as Input) : {};

const origin = (ctx: PluginContext, routeCtx: SandboxedRouteContext) => ctx.site.url || new URL(routeCtx.request.url).origin;

function callerId(routeCtx: SandboxedRouteContext) {
	if (!routeCtx.user) throw new Error("Sign in first");
	return routeCtx.user.id;
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const userRoute = (handler: (input: Input, userId: string, ctx: PluginContext, routeCtx: SandboxedRouteContext) => Promise<unknown>) => ({
	methods: ["POST" as const],
	permission: PERMISSION,
	handler: async (routeCtx: SandboxedRouteContext, ctx: PluginContext) => handler(inputOf(routeCtx), callerId(routeCtx), ctx, routeCtx),
});

const plugin: SandboxedPlugin = {
	routes: {
		integrations: userRoute(async (input, userId, ctx) => {
			if (typeof input.did !== "string") throw new Error("did is required");
			return { integrations: await listIntegrations(ctx, userId, input.did) };
		}),
		connect: userRoute(async (input, userId, ctx, routeCtx) => {
			const groups = Array.isArray(input.groups) ? input.groups.filter((item): item is string => typeof item === "string") : [];
			return { url: await beginConnect(ctx, userId, origin(ctx, routeCtx), parseRef(input), groups) };
		}),
		disconnect: userRoute(async (input, userId, ctx) => {
			await disconnect(ctx, userId, parseRef(input));
			return { ok: true };
		}),
		run: userRoute(async (input, userId, ctx) => {
			if (typeof input.entry !== "string") throw new Error("entry is required");
			const values = typeof input.input === "object" && input.input !== null ? (input.input as Record<string, unknown>) : {};
			return runModule(ctx, userId, parseRef(input), input.entry, values);
		}),
		verify: userRoute(async (input, userId, ctx) => {
			const agent = await sessionAgent(ctx, userId, parseRef(input));
			if (!agent) throw new Error("Not connected");
			const session = await agent.call<{ did: string; handle: string }>("com.atproto.server.getSession");
			return { did: session.did, handle: session.handle, scope: agent.scope };
		}),
		"client-metadata": pluginRoute({
			public: true,
			methods: ["GET"],
			request: { body: "none" },
			handler: async (routeCtx, ctx) => {
				const metadata = await servedMetadata(ctx, parseRef({ did: first(routeCtx.input.did), rkey: first(routeCtx.input.rkey) }));
				return metadata ?? { error: "NOT_FOUND" };
			},
		}),
		"oauth/callback": pluginRoute({
			public: true,
			methods: ["GET"],
			request: { body: "none" },
			response: "raw",
			handler: async (routeCtx, ctx) => {
				const params = Object.fromEntries(Object.entries(routeCtx.input).map(([key, value]) => [key, first(value)]));
				const query = await completeConnect(ctx, params).then(
					(ref) => new URLSearchParams({ connected: ref.rkey }),
					(error: unknown) => new URLSearchParams({ error: error instanceof Error ? error.message : "Authorization failed" }),
				);
				return pluginResponse({ status: 303, headers: { location: `/integrations?${query}` } });
			},
		}),
	},
};

export default plugin;
