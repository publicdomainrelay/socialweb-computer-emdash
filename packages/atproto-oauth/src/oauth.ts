import type { PluginContext } from "emdash/plugin";
import { clientConfig, type Integration } from "./client";
import { createDpopKey, type DpopKey, dpopFetch } from "./dpop";
import { requireHttp } from "./http";
import { resolveIdentity } from "./identity";
import { randomToken, sha256 } from "./jwt";
import { BASE_SCOPE, requestedScope } from "./scopes";
import { authorizationServerFor } from "./server";
import {
	clearPending,
	clearSession,
	type Endpoints,
	loadPending,
	loadSession,
	type Session,
	savePending,
	saveSession,
} from "./store";

const PENDING_TTL_MS = 10 * 60 * 1000;

interface TokenResponse {
	access_token: string;
	refresh_token: string;
	expires_in: number;
	scope: string;
	sub: string;
	error?: string;
	error_description?: string;
}

const form = (fields: Record<string, string>) => ({
	method: "POST" as const,
	headers: { "Content-Type": "application/x-www-form-urlencoded" },
	body: new URLSearchParams(fields).toString(),
});

async function requestToken(
	ctx: PluginContext,
	endpoints: Endpoints,
	dpop: DpopKey,
	fields: Record<string, string>,
): Promise<TokenResponse> {
	const response = await dpopFetch(requireHttp(ctx), dpop, endpoints.tokenEndpoint, form(fields));
	const token = (await response.json()) as TokenResponse;
	if (!response.ok) throw new Error(`Token request failed: ${token.error_description ?? token.error ?? response.status}`);
	if (!token.scope?.split(" ").includes(BASE_SCOPE)) throw new Error("Token response is missing the atproto scope");
	return token;
}

export async function beginAuthorization(
	ctx: PluginContext,
	integration: Integration,
	identifier: string,
	groupIds: string[],
) {
	const http = requireHttp(ctx);
	const identity = await resolveIdentity(http, identifier);
	const server = await authorizationServerFor(http, identity.pds);
	const { clientId, redirectUri } = clientConfig(ctx, integration);
	const dpop = await createDpopKey();
	const verifier = randomToken(32);
	const state = randomToken(16);
	const response = await dpopFetch(
		http,
		dpop,
		server.pushed_authorization_request_endpoint,
		form({
			client_id: clientId,
			response_type: "code",
			redirect_uri: redirectUri,
			scope: requestedScope(integration.groups, groupIds),
			state,
			code_challenge: await sha256(verifier),
			code_challenge_method: "S256",
			login_hint: identity.handle ?? identity.did,
		}),
	);
	const par = (await response.json()) as { request_uri?: string; error?: string; error_description?: string };
	if (!response.ok || !par.request_uri) {
		throw new Error(`Authorization request failed: ${par.error_description ?? par.error ?? response.status}`);
	}
	await savePending(ctx, {
		...identity,
		state,
		verifier,
		dpop,
		issuer: server.issuer,
		tokenEndpoint: server.token_endpoint,
		revocationEndpoint: server.revocation_endpoint,
		createdAt: Date.now(),
	});
	return `${server.authorization_endpoint}?${new URLSearchParams({ client_id: clientId, request_uri: par.request_uri })}`;
}

export async function completeAuthorization(
	ctx: PluginContext,
	integration: Integration,
	params: Record<string, string | undefined>,
) {
	const pending = await loadPending(ctx);
	if (!pending || pending.state !== params.state) throw new Error("Unknown or replaced authorization request");
	await clearPending(ctx);
	if (Date.now() - pending.createdAt > PENDING_TTL_MS) throw new Error("Authorization request expired");
	if (params.error) throw new Error(`Authorization denied: ${params.error_description ?? params.error}`);
	if (params.iss !== pending.issuer) throw new Error("Authorization response issuer mismatch");
	if (!params.code) throw new Error("Authorization response has no code");
	const { clientId, redirectUri } = clientConfig(ctx, integration);
	const token = await requestToken(ctx, pending, pending.dpop, {
		grant_type: "authorization_code",
		code: params.code,
		redirect_uri: redirectUri,
		code_verifier: pending.verifier,
		client_id: clientId,
	});
	if (token.sub !== pending.did) throw new Error("Token subject does not match the requested account");
	const session: Session = {
		did: pending.did,
		handle: pending.handle,
		pds: pending.pds,
		issuer: pending.issuer,
		tokenEndpoint: pending.tokenEndpoint,
		revocationEndpoint: pending.revocationEndpoint,
		scope: token.scope,
		accessToken: token.access_token,
		refreshToken: token.refresh_token,
		expiresAt: Date.now() + token.expires_in * 1000,
		dpop: pending.dpop,
	};
	await saveSession(ctx, session);
	return session;
}

export async function refreshSession(ctx: PluginContext, integration: Integration, session: Session) {
	const token = await requestToken(ctx, session, session.dpop, {
		grant_type: "refresh_token",
		refresh_token: session.refreshToken,
		client_id: clientConfig(ctx, integration).clientId,
	});
	if (token.sub !== session.did) throw new Error("Refreshed token subject changed");
	const refreshed: Session = {
		...session,
		scope: token.scope,
		accessToken: token.access_token,
		refreshToken: token.refresh_token,
		expiresAt: Date.now() + token.expires_in * 1000,
	};
	await saveSession(ctx, refreshed);
	return refreshed;
}

export async function disconnect(ctx: PluginContext, integration: Integration) {
	const session = await loadSession(ctx);
	await clearSession(ctx);
	if (!session?.revocationEndpoint) return;
	await dpopFetch(
		requireHttp(ctx),
		session.dpop,
		session.revocationEndpoint,
		form({ token: session.refreshToken, client_id: clientConfig(ctx, integration).clientId }),
	).catch(() => undefined);
}
