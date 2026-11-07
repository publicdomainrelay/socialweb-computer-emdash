import { type PluginContext, pluginResponse, pluginRoute, type SandboxedPlugin, type SandboxedRouteContext } from "emdash/plugin";
import { beginConnect, completeConnect, disconnect, listIntegrations, servedMetadata, sessionAgent, sessionOwner } from "./flow";
import { runModule } from "./modules";
import { parseRef } from "./record";
import { RUN_NSID, ServiceAuthError, siteDid, siteDidDocument, verifyServiceAuth } from "./service-auth";

const PERMISSION = "auth:manage_own_credentials" as const;

type Input = Record<string, unknown>;

const inputOf = (routeCtx: SandboxedRouteContext): Input =>
	typeof routeCtx.input === "object" && routeCtx.input !== null ? (routeCtx.input as Input) : {};

const origin = (ctx: PluginContext, routeCtx: SandboxedRouteContext) => ctx.site.url || new URL(routeCtx.request.url).origin;

function callerId(routeCtx: SandboxedRouteContext) {
	if (!routeCtx.user) throw new Error("Sign in first");
	return routeCtx.user.id;
}

const AT_URI = /^at:\/\/(did:[^/]+)\/([^/]+)\/([^/]+)$/;

function parseModuleUri(value: unknown) {
	const match = typeof value === "string" ? AT_URI.exec(value) : null;
	if (!match) throw new Error("module must be an at:// URI of a wasm.module record");
	return { did: match[1], rkey: match[3] };
}

const runInput = (input: Input) => {
	if (typeof input.entry !== "string") throw new Error("entry is required");
	const values = typeof input.input === "object" && input.input !== null ? (input.input as Record<string, unknown>) : {};
	return { entry: input.entry, values };
};

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
			const { entry, values } = runInput(input);
			return runModule(ctx, (session) => sessionAgent(ctx, userId, session), parseRef(input), entry, values);
		}),
		"service/run": pluginRoute({
			public: true,
			methods: ["POST"],
			request: { body: "json" },
			handler: async (routeCtx, ctx) => {
				const input = inputOf(routeCtx);
				try {
					if (typeof input.token !== "string") throw new ServiceAuthError("Service auth token required");
					const did = await verifyServiceAuth(ctx, input.token, siteDid(origin(ctx, routeCtx)), RUN_NSID);
					const { entry, values } = runInput(input);
					const ran = await runModule(
						ctx,
						async (session) => {
							if (session.did !== did) throw new ServiceAuthError("This module uses another account's session");
							const userId = await sessionOwner(ctx, session);
							return userId ? sessionAgent(ctx, userId, session) : undefined;
						},
						parseModuleUri(input.module),
						entry,
						values,
					);
					return { ...ran, did };
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					return { error: error instanceof ServiceAuthError ? "AuthenticationRequired" : "InvalidRequest", message };
				}
			},
		}),
		"service/did": pluginRoute({
			public: true,
			methods: ["GET"],
			request: { body: "none" },
			handler: async (routeCtx, ctx) => siteDidDocument(origin(ctx, routeCtx)),
		}),
		verify: userRoute(async (input, userId, ctx) => {
			const agent = await sessionAgent(ctx, userId, parseRef(input));
			if (!agent) throw new Error("Not connected");
			const session = await agent.call<{ did: string; handle: string }>("com.atproto.server.getSession");
			return { did: session.did, handle: session.handle, scope: await agent.scope() };
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
