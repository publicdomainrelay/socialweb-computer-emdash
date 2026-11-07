import type { PluginContext } from "emdash/plugin";
import { createDpopKey, type DpopKey, dpopFetch } from "./oauth/dpop";
import { requireHttp } from "./oauth/http";
import { resolveIdentity } from "./oauth/identity";
import { randomToken, sha256 } from "./oauth/jwt";
import { BASE_SCOPE, grantedGroupKeys, requestedScope } from "./oauth/scopes";
import { authorizationServerFor } from "./oauth/server";
import {
	COLLECTION,
	clientConfig,
	clientMetadata,
	type IntegrationRecord,
	type IntegrationRef,
	parseRecord,
	recordUri,
} from "./record";
import { listModules } from "./modules";
import { type Sealed, seal, unseal } from "./seal";

const PENDING_TTL_MS = 10 * 60 * 1000;
const REFRESH_MARGIN_MS = 60 * 1000;

interface ClientEntry extends IntegrationRef {
	origin: string;
	cid: string;
	record: IntegrationRecord;
}

interface Endpoints {
	issuer: string;
	tokenEndpoint: string;
	revocationEndpoint?: string;
	clientId: string;
}

interface PendingSecret extends Endpoints {
	verifier: string;
	redirectUri: string;
	dpop: DpopKey;
	pds: string;
}

interface PendingEntry extends IntegrationRef {
	userId: string;
	createdAt: number;
	sealed: Sealed;
}

interface SessionSecret extends Endpoints {
	pds: string;
	accessToken: string;
	refreshToken: string;
	expiresAt: number;
	dpop: DpopKey;
}

interface SessionEntry extends IntegrationRef {
	userId: string;
	handle?: string;
	scope: string;
	updatedAt: string;
	sealed: Sealed;
}

interface TokenResponse {
	access_token: string;
	refresh_token: string;
	expires_in: number;
	scope: string;
	sub: string;
	error?: string;
	error_description?: string;
}

const clientKey = ({ did, rkey }: IntegrationRef) => `${did}/${rkey}`;
const sessionKey = (userId: string, ref: IntegrationRef) => `${userId}/${clientKey(ref)}`;

const form = (fields: Record<string, string>) => ({
	method: "POST" as const,
	headers: { "Content-Type": "application/x-www-form-urlencoded" },
	body: new URLSearchParams(fields).toString(),
});

async function requestToken(ctx: PluginContext, endpoints: Endpoints, dpop: DpopKey, fields: Record<string, string>) {
	const response = await dpopFetch(requireHttp(ctx), dpop, endpoints.tokenEndpoint, form({ ...fields, client_id: endpoints.clientId }));
	const token = (await response.json()) as TokenResponse;
	if (!response.ok) throw new Error(`Token request failed: ${token.error_description ?? token.error ?? response.status}`);
	if (!token.scope?.split(" ").includes(BASE_SCOPE)) throw new Error("Token response is missing the atproto scope");
	return token;
}

async function fetchRecord(ctx: PluginContext, pds: string, ref: IntegrationRef) {
	const query = new URLSearchParams({ repo: ref.did, collection: COLLECTION, rkey: ref.rkey });
	const response = await requireHttp(ctx).fetch(`${pds}/xrpc/com.atproto.repo.getRecord?${query}`);
	if (!response.ok) throw new Error(`Integration ${recordUri(ref)} not found`);
	const { value, cid } = (await response.json()) as { value: unknown; cid: string };
	return { record: parseRecord(value), cid };
}

export async function servedMetadata(ctx: PluginContext, ref: IntegrationRef) {
	const entry = (await ctx.storage.clients.get(clientKey(ref))) as ClientEntry | null;
	return entry ? clientMetadata(entry.origin, ref, entry.record) : undefined;
}

export async function listIntegrations(ctx: PluginContext, userId: string, did: string) {
	const identity = await resolveIdentity(requireHttp(ctx), did);
	const query = new URLSearchParams({ repo: identity.did, collection: COLLECTION, limit: "100" });
	const response = await requireHttp(ctx).fetch(`${identity.pds}/xrpc/com.atproto.repo.listRecords?${query}`);
	if (!response.ok) throw new Error(`Could not list integrations for ${did}`);
	const { records } = (await response.json()) as { records: Array<{ uri: string; value: unknown }> };
	const sessions = await ctx.storage.sessions.query({ where: { userId }, limit: 100 });
	const modules = await listModules(ctx, identity.pds, identity.did);
	const connected = new Map(sessions.items.map(({ data }) => [clientKey(data as SessionEntry), data as SessionEntry]));
	return records.flatMap(({ uri, value }) => {
		try {
			const record = parseRecord(value);
			const ref = { did: identity.did, rkey: uri.split("/").pop() ?? "" };
			const session = connected.get(clientKey(ref));
			const granted = session ? grantedGroupKeys(record.scopeGroups, session.scope) : [];
			return [
				{
					...ref,
					uri,
					name: record.name,
					description: record.description,
					declaredScope: record.clientMetadata.scope,
					groups: record.scopeGroups.map((group) => ({ ...group, granted: granted.includes(group.key) })),
					session: session ? { handle: session.handle, scope: session.scope, updatedAt: session.updatedAt } : null,
					modules: modules
						.filter((module) => module.session.did === ref.did && module.session.rkey === ref.rkey)
						.map(({ did: moduleDid, rkey, uri: moduleUri, name, description, actions }) => ({
							did: moduleDid,
							rkey,
							uri: moduleUri,
							name,
							description,
							actions,
						})),
				},
			];
		} catch (error) {
			ctx.log.warn("Skipping invalid integration record", { uri, error: error instanceof Error ? error.message : String(error) });
			return [];
		}
	});
}

export async function beginConnect(ctx: PluginContext, userId: string, origin: string, ref: IntegrationRef, groupKeys: string[]) {
	const http = requireHttp(ctx);
	const identity = await resolveIdentity(http, ref.did);
	const { record, cid } = await fetchRecord(ctx, identity.pds, ref);
	const client = clientConfig(origin, ref, record);
	await ctx.storage.clients.put(clientKey(ref), { ...ref, origin: client.origin, cid, record } satisfies ClientEntry);
	const server = await authorizationServerFor(http, identity.pds);
	const dpop = await createDpopKey();
	const verifier = randomToken(32);
	const state = randomToken(16);
	const response = await dpopFetch(
		http,
		dpop,
		server.pushed_authorization_request_endpoint,
		form({
			client_id: client.clientId,
			response_type: "code",
			redirect_uri: client.redirectUri,
			scope: requestedScope(record.clientMetadata.scope, record.scopeGroups, groupKeys),
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
	const secret: PendingSecret = {
		verifier,
		dpop,
		pds: identity.pds,
		issuer: server.issuer,
		tokenEndpoint: server.token_endpoint,
		revocationEndpoint: server.revocation_endpoint,
		clientId: client.clientId,
		redirectUri: client.redirectUri,
	};
	await ctx.storage.pending.put(state, {
		...ref,
		userId,
		createdAt: Date.now(),
		sealed: await seal(ctx, `pending/${state}`, secret),
	} satisfies PendingEntry);
	return `${server.authorization_endpoint}?${new URLSearchParams({ client_id: client.clientId, request_uri: par.request_uri })}`;
}

export async function completeConnect(ctx: PluginContext, params: Record<string, string | undefined>) {
	const state = params.state ?? "";
	const pending = (await ctx.storage.pending.get(state)) as PendingEntry | null;
	if (!pending) throw new Error("Unknown or expired authorization request");
	await ctx.storage.pending.delete(state);
	const ref = { did: pending.did, rkey: pending.rkey };
	if (Date.now() - pending.createdAt > PENDING_TTL_MS) throw new Error("Authorization request expired");
	if (params.error) throw new Error(`Authorization denied: ${params.error_description ?? params.error}`);
	const secret = await unseal<PendingSecret>(ctx, `pending/${state}`, pending.sealed);
	if (params.iss !== secret.issuer) throw new Error("Authorization response issuer mismatch");
	if (!params.code) throw new Error("Authorization response has no code");
	const token = await requestToken(ctx, secret, secret.dpop, {
		grant_type: "authorization_code",
		code: params.code,
		redirect_uri: secret.redirectUri,
		code_verifier: secret.verifier,
	});
	if (token.sub !== pending.did) throw new Error("An integration record can only authorize the account that published it");
	const identity = await resolveIdentity(requireHttp(ctx), pending.did);
	await saveSession(ctx, pending.userId, ref, identity.handle, {
		pds: secret.pds,
		issuer: secret.issuer,
		tokenEndpoint: secret.tokenEndpoint,
		revocationEndpoint: secret.revocationEndpoint,
		clientId: secret.clientId,
		accessToken: token.access_token,
		refreshToken: token.refresh_token,
		expiresAt: Date.now() + token.expires_in * 1000,
		dpop: secret.dpop,
	}, token.scope);
	return ref;
}

async function saveSession(ctx: PluginContext, userId: string, ref: IntegrationRef, handle: string | undefined, secret: SessionSecret, scope: string) {
	const id = sessionKey(userId, ref);
	await ctx.storage.sessions.put(id, {
		...ref,
		userId,
		handle,
		scope,
		updatedAt: new Date().toISOString(),
		sealed: await seal(ctx, `sessions/${id}`, secret),
	} satisfies SessionEntry);
}

async function loadSession(ctx: PluginContext, userId: string, ref: IntegrationRef) {
	const id = sessionKey(userId, ref);
	const entry = (await ctx.storage.sessions.get(id)) as SessionEntry | null;
	if (!entry) return undefined;
	return { entry, secret: await unseal<SessionSecret>(ctx, `sessions/${id}`, entry.sealed) };
}

export async function disconnect(ctx: PluginContext, userId: string, ref: IntegrationRef) {
	const loaded = await loadSession(ctx, userId, ref);
	await ctx.storage.sessions.delete(sessionKey(userId, ref));
	if (!loaded?.secret.revocationEndpoint) return;
	await dpopFetch(
		requireHttp(ctx),
		loaded.secret.dpop,
		loaded.secret.revocationEndpoint,
		form({ token: loaded.secret.refreshToken, client_id: loaded.secret.clientId }),
	).catch(() => undefined);
}

export async function sessionAgent(ctx: PluginContext, userId: string, ref: IntegrationRef) {
	const loaded = await loadSession(ctx, userId, ref);
	if (!loaded) return undefined;
	let { entry, secret } = loaded;
	const refresh = async () => {
		const token = await requestToken(ctx, secret, secret.dpop, { grant_type: "refresh_token", refresh_token: secret.refreshToken });
		if (token.sub !== ref.did) throw new Error("Refreshed token subject changed");
		secret = { ...secret, accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: Date.now() + token.expires_in * 1000 };
		entry = { ...entry, scope: token.scope };
		await saveSession(ctx, userId, ref, entry.handle, secret, token.scope);
	};
	const call = async <T>(nsid: string, init: { params?: Record<string, string>; input?: unknown } = {}): Promise<T> => {
		if (secret.expiresAt - REFRESH_MARGIN_MS < Date.now()) await refresh();
		const send = () =>
			dpopFetch(
				requireHttp(ctx),
				secret.dpop,
				`${secret.pds}/xrpc/${nsid}${init.params ? `?${new URLSearchParams(init.params)}` : ""}`,
				init.input === undefined
					? { method: "GET" }
					: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(init.input) },
				secret.accessToken,
			);
		let response = await send();
		if (response.status === 401 && /invalid_token/.test(response.headers.get("www-authenticate") ?? "")) {
			await refresh();
			response = await send();
		}
		const body = (await response.json().catch(() => ({}))) as T & { error?: string };
		if (!response.ok) throw new Error(`${nsid} failed with ${body.error ?? response.status}`);
		return body;
	};
	return {
		get scope() {
			return entry.scope;
		},
		call,
	};
}

export type SessionAgent = NonNullable<Awaited<ReturnType<typeof sessionAgent>>>;

export async function sessionOwner(ctx: PluginContext, ref: IntegrationRef) {
	const { items } = await ctx.storage.sessions.query({ where: { did: ref.did }, orderBy: { updatedAt: "desc" }, limit: 50 });
	const match = items.map((item) => item.data as SessionEntry).find((entry) => entry.rkey === ref.rkey);
	return match?.userId;
}
