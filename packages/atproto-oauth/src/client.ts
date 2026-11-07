import type { PluginContext } from "emdash/plugin";
import { declaredScope, type ScopeGroup } from "./scopes";

export interface Integration {
	name: string;
	groups: ScopeGroup[];
}

const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function siteOrigin(ctx: PluginContext) {
	const site = new URL(ctx.site.url);
	if (site.hostname === "localhost") site.hostname = "127.0.0.1";
	return site.origin;
}

export const pluginRoute = (ctx: PluginContext, name: string) =>
	`${siteOrigin(ctx)}/_emdash/api/plugins/${ctx.plugin.id}/${name}`;

export const adminPage = (ctx: PluginContext, path: string) =>
	`${siteOrigin(ctx)}/_emdash/admin/plugins/${ctx.plugin.id}${path}`;

export function clientConfig(ctx: PluginContext, integration: Integration) {
	const redirectUri = pluginRoute(ctx, "oauth/callback");
	const scope = declaredScope(integration.groups);
	const loopback = loopbackHosts.has(new URL(siteOrigin(ctx)).hostname);
	const clientId = loopback
		? `http://localhost?${new URLSearchParams({ redirect_uri: redirectUri, scope })}`
		: pluginRoute(ctx, "oauth-client-metadata.json");
	return { clientId, redirectUri, scope, loopback };
}

export function clientMetadata(ctx: PluginContext, integration: Integration) {
	const { clientId, redirectUri, scope } = clientConfig(ctx, integration);
	return {
		client_id: clientId,
		client_name: integration.name,
		client_uri: siteOrigin(ctx),
		redirect_uris: [redirectUri],
		scope,
		grant_types: ["authorization_code", "refresh_token"],
		response_types: ["code"],
		application_type: "web",
		token_endpoint_auth_method: "none",
		dpop_bound_access_tokens: true,
	};
}
