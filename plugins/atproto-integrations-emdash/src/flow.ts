import type { Did } from "@atcute/lexicons";
import type { PluginContext } from "emdash/plugin";
import { requireHttp, xrpcUrl } from "./http";
import { resolveActor } from "./identity";
import { listModules } from "./modules";
import {
	type AuthorizeState,
	type ClientEntry,
	clientKey,
	oauthClient,
	type PendingEntry,
	type SessionEntry,
	sessionKey,
} from "./oauth";
import { COLLECTION, clientConfig, clientMetadata, type IntegrationRecord, type IntegrationRef, parseRecord, recordUri } from "./record";
import { grantedGroupKeys, requestedScope } from "./scopes";
import { isSiteIntegration } from "./site";

const FOREIGN_RECORD = "Only the account that published an integration record, or any account for an integration this site offers, can connect it";

export async function fetchRecord(ctx: PluginContext, ref: IntegrationRef) {
	const actor = await resolveActor(ctx, ref.did);
	const response = await requireHttp(ctx).fetch(xrpcUrl(actor.pds, "com.atproto.repo.getRecord", { repo: ref.did, collection: COLLECTION, rkey: ref.rkey }));
	if (!response.ok) throw new Error(`Integration ${recordUri(ref)} not found`);
	const { value, cid } = (await response.json()) as { value: unknown; cid: string };
	return { record: parseRecord(value), cid };
}

const clientEntry = async (ctx: PluginContext, ref: IntegrationRef) => (await ctx.storage.clients.get(clientKey(ref))) as ClientEntry | null;

const sessionEntry = async (ctx: PluginContext, userId: string, ref: IntegrationRef) =>
	(await ctx.storage.sessions.get(sessionKey(userId, ref))) as SessionEntry | null;

const accountOf = (entry: SessionEntry) => entry.account ?? entry.did;

export async function servedMetadata(ctx: PluginContext, ref: IntegrationRef) {
	const entry = await clientEntry(ctx, ref);
	return entry ? clientMetadata(entry.origin, ref, entry.record) : undefined;
}

function describe(ref: IntegrationRef, uri: string, record: IntegrationRecord, session: SessionEntry | undefined, handle: string | undefined) {
	const granted = session ? grantedGroupKeys(record.scopeGroups, session.scope) : [];
	return {
		...ref,
		uri,
		name: record.name,
		description: record.description,
		declaredScope: record.clientMetadata.scope,
		groups: record.scopeGroups.map((group) => ({ ...group, granted: granted.includes(group.key) })),
		session: session ? { handle, scope: session.scope, updatedAt: session.updatedAt } : null,
	};
}

export async function listIntegrations(ctx: PluginContext, userId: string, did: string, site: IntegrationRef[]) {
	const actor = await resolveActor(ctx, did);
	const response = await requireHttp(ctx).fetch(xrpcUrl(actor.pds, "com.atproto.repo.listRecords", { repo: actor.did, collection: COLLECTION, limit: "100" }));
	if (!response.ok) throw new Error(`Could not list integrations for ${did}`);
	const { records } = (await response.json()) as { records: Array<{ uri: string; value: unknown }> };
	const sessions = await ctx.storage.sessions.query({ where: { userId }, limit: 100 });
	const modules = await listModules(ctx, actor.pds, actor.did);
	const connected = new Map(sessions.items.map(({ data }) => [clientKey(data as SessionEntry), data as SessionEntry]));
	const handle = actor.handle === "handle.invalid" ? undefined : actor.handle;
	const own = records.flatMap(({ uri, value }) => {
		try {
			const ref = { did: actor.did, rkey: uri.split("/").pop() ?? "" };
			return [
				{
					...describe(ref, uri, parseRecord(value), connected.get(clientKey(ref)), handle),
					site: false,
					modules: modules
						.filter((module) => module.session.did === ref.did && module.session.rkey === ref.rkey)
						.map(({ did: moduleDid, rkey, uri: moduleUri, name, description, actions, source }) => ({
							did: moduleDid,
							rkey,
							uri: moduleUri,
							name,
							description,
							actions,
							source,
						})),
				},
			];
		} catch (error) {
			ctx.log.warn("Skipping invalid integration record", { uri, error: error instanceof Error ? error.message : String(error) });
			return [];
		}
	});
	const offered = await Promise.all(
		site
			.filter((ref) => ref.did !== actor.did)
			.map(async (ref) => {
				try {
					const { record } = await fetchRecord(ctx, ref);
					const session = connected.get(clientKey(ref));
					const mine = session && accountOf(session) === actor.did ? session : undefined;
					return [{ ...describe(ref, recordUri(ref), record, mine, handle), site: true, modules: [] }];
				} catch (error) {
					ctx.log.warn("Skipping unavailable site integration", { uri: recordUri(ref), error: error instanceof Error ? error.message : String(error) });
					return [];
				}
			}),
	);
	return [...offered.flat(), ...own];
}

export async function authorize(ctx: PluginContext, userId: string, entry: ClientEntry, scope: string, account: string) {
	await ctx.storage.clients.put(clientKey(entry), entry);
	const { url } = await oauthClient(ctx, entry, userId, account).authorize({
		target: { type: "account", identifier: account as Did },
		scope,
		state: { did: entry.did, rkey: entry.rkey, userId, account } satisfies AuthorizeState,
	});
	return url.href;
}

export async function beginConnect(
	ctx: PluginContext,
	userId: string,
	origin: string,
	ref: IntegrationRef,
	groupKeys: string[],
	account: string,
	site: IntegrationRef[],
) {
	if (account !== ref.did && !isSiteIntegration(site, ref)) throw new Error(FOREIGN_RECORD);
	const { did } = await resolveActor(ctx, account);
	const { record, cid } = await fetchRecord(ctx, ref);
	const entry: ClientEntry = { ...ref, origin: clientConfig(origin, ref, record).origin, cid, record };
	return authorize(ctx, userId, entry, requestedScope(record.clientMetadata.scope, record.scopeGroups, groupKeys), did);
}

export async function completeConnect(ctx: PluginContext, params: Record<string, string | undefined>) {
	const pending = (await ctx.storage.pending.get(params.state ?? "")) as PendingEntry | null;
	if (!pending) throw new Error("Unknown or expired authorization request");
	const ref = { did: pending.did, rkey: pending.rkey };
	const account = pending.account ?? pending.did;
	const entry = await clientEntry(ctx, ref);
	if (!entry) throw new Error(`Integration ${recordUri(ref)} is no longer configured`);
	const query = new URLSearchParams(Object.entries(params).filter((pair): pair is [string, string] => pair[1] !== undefined));
	await oauthClient(ctx, entry, pending.userId, account).callback(query);
	return { ref, account };
}

export async function disconnect(ctx: PluginContext, userId: string, ref: IntegrationRef) {
	const [entry, session] = await Promise.all([clientEntry(ctx, ref), sessionEntry(ctx, userId, ref)]);
	if (entry && session) {
		const account = accountOf(session);
		await oauthClient(ctx, entry, userId, account)
			.revoke(account as Did)
			.catch(() => undefined);
	}
	await ctx.storage.sessions.delete(sessionKey(userId, ref));
}

export async function sessionAgent(ctx: PluginContext, userId: string, ref: IntegrationRef) {
	const [entry, stored] = await Promise.all([clientEntry(ctx, ref), sessionEntry(ctx, userId, ref)]);
	if (!entry || !stored) return undefined;
	const account = accountOf(stored);
	const session = await oauthClient(ctx, entry, userId, account).restore(account as Did);
	const send = async <T>(nsid: string, path: string, init: RequestInit): Promise<T> => {
		const response = await session.handle(path, init);
		const body = (await response.json().catch(() => ({}))) as T & { error?: string; message?: string };
		if (!response.ok) throw new Error(`${nsid} failed with ${body.error ?? response.status}${body.message ? `: ${body.message}` : ""}`);
		return body;
	};
	const call = <T>(nsid: string, init: { params?: Record<string, string>; input?: unknown } = {}) =>
		send<T>(
			nsid,
			`/xrpc/${nsid}${init.params ? `?${new URLSearchParams(init.params)}` : ""}`,
			init.input === undefined
				? { method: "GET" }
				: { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(init.input) },
		);
	const upload = <T>(nsid: string, body: Uint8Array<ArrayBuffer>, contentType: string) =>
		send<T>(nsid, `/xrpc/${nsid}`, { method: "POST", headers: { "content-type": contentType }, body });
	return {
		account,
		scope: async () => (await session.getTokenInfo(false)).scope,
		call,
		upload,
	};
}

export type SessionAgent = NonNullable<Awaited<ReturnType<typeof sessionAgent>>>;

export async function ownSessionAgent(ctx: PluginContext, userId: string, ref: IntegrationRef) {
	const stored = await sessionEntry(ctx, userId, ref);
	return stored && accountOf(stored) === ref.did ? sessionAgent(ctx, userId, ref) : undefined;
}

export async function sessionOwner(ctx: PluginContext, ref: IntegrationRef) {
	const { items } = await ctx.storage.sessions.query({ where: { did: ref.did }, orderBy: { updatedAt: "desc" }, limit: 50 });
	return items.map((item) => item.data as SessionEntry).find((entry) => entry.rkey === ref.rkey && accountOf(entry) === ref.did)?.userId;
}
