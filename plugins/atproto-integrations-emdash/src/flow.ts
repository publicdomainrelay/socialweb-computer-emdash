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
import { COLLECTION, clientConfig, clientMetadata, type IntegrationRef, parseRecord, recordUri } from "./record";
import { grantedGroupKeys, requestedScope } from "./scopes";

async function fetchRecord(ctx: PluginContext, pds: string, ref: IntegrationRef) {
	const response = await requireHttp(ctx).fetch(xrpcUrl(pds, "com.atproto.repo.getRecord", { repo: ref.did, collection: COLLECTION, rkey: ref.rkey }));
	if (!response.ok) throw new Error(`Integration ${recordUri(ref)} not found`);
	const { value, cid } = (await response.json()) as { value: unknown; cid: string };
	return { record: parseRecord(value), cid };
}

const clientEntry = async (ctx: PluginContext, ref: IntegrationRef) => (await ctx.storage.clients.get(clientKey(ref))) as ClientEntry | null;

export async function servedMetadata(ctx: PluginContext, ref: IntegrationRef) {
	const entry = await clientEntry(ctx, ref);
	return entry ? clientMetadata(entry.origin, ref, entry.record) : undefined;
}

export async function listIntegrations(ctx: PluginContext, userId: string, did: string) {
	const actor = await resolveActor(ctx, did);
	const response = await requireHttp(ctx).fetch(xrpcUrl(actor.pds, "com.atproto.repo.listRecords", { repo: actor.did, collection: COLLECTION, limit: "100" }));
	if (!response.ok) throw new Error(`Could not list integrations for ${did}`);
	const { records } = (await response.json()) as { records: Array<{ uri: string; value: unknown }> };
	const sessions = await ctx.storage.sessions.query({ where: { userId }, limit: 100 });
	const modules = await listModules(ctx, actor.pds, actor.did);
	const connected = new Map(sessions.items.map(({ data }) => [clientKey(data as SessionEntry), data as SessionEntry]));
	const handle = actor.handle === "handle.invalid" ? undefined : actor.handle;
	return records.flatMap(({ uri, value }) => {
		try {
			const record = parseRecord(value);
			const ref = { did: actor.did, rkey: uri.split("/").pop() ?? "" };
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
					session: session ? { handle, scope: session.scope, updatedAt: session.updatedAt } : null,
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
}

export async function beginConnect(ctx: PluginContext, userId: string, origin: string, ref: IntegrationRef, groupKeys: string[]) {
	const actor = await resolveActor(ctx, ref.did);
	const { record, cid } = await fetchRecord(ctx, actor.pds, ref);
	const entry: ClientEntry = { ...ref, origin: clientConfig(origin, ref, record).origin, cid, record };
	await ctx.storage.clients.put(clientKey(ref), entry);
	const { url } = await oauthClient(ctx, entry, userId).authorize({
		target: { type: "account", identifier: actor.did },
		scope: requestedScope(record.clientMetadata.scope, record.scopeGroups, groupKeys),
		state: { ...ref, userId } satisfies AuthorizeState,
	});
	return url.href;
}

export async function completeConnect(ctx: PluginContext, params: Record<string, string | undefined>) {
	const pending = (await ctx.storage.pending.get(params.state ?? "")) as PendingEntry | null;
	if (!pending) throw new Error("Unknown or expired authorization request");
	const ref = { did: pending.did, rkey: pending.rkey };
	const entry = await clientEntry(ctx, ref);
	if (!entry) throw new Error(`Integration ${recordUri(ref)} is no longer configured`);
	const query = new URLSearchParams(Object.entries(params).filter((pair): pair is [string, string] => pair[1] !== undefined));
	await oauthClient(ctx, entry, pending.userId).callback(query);
	return ref;
}

export async function disconnect(ctx: PluginContext, userId: string, ref: IntegrationRef) {
	const entry = await clientEntry(ctx, ref);
	if (entry) await oauthClient(ctx, entry, userId).revoke(ref.did as Did).catch(() => undefined);
	await ctx.storage.sessions.delete(sessionKey(userId, ref));
}

export async function sessionAgent(ctx: PluginContext, userId: string, ref: IntegrationRef) {
	const entry = await clientEntry(ctx, ref);
	if (!entry || !(await ctx.storage.sessions.exists(sessionKey(userId, ref)))) return undefined;
	const session = await oauthClient(ctx, entry, userId).restore(ref.did as Did);
	const call = async <T>(nsid: string, init: { params?: Record<string, string>; input?: unknown } = {}): Promise<T> => {
		const response = await session.handle(
			`/xrpc/${nsid}${init.params ? `?${new URLSearchParams(init.params)}` : ""}`,
			init.input === undefined
				? { method: "GET" }
				: { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(init.input) },
		);
		const body = (await response.json().catch(() => ({}))) as T & { error?: string };
		if (!response.ok) throw new Error(`${nsid} failed with ${body.error ?? response.status}`);
		return body;
	};
	return {
		scope: async () => (await session.getTokenInfo(false)).scope,
		call,
	};
}

export type SessionAgent = NonNullable<Awaited<ReturnType<typeof sessionAgent>>>;

export async function sessionOwner(ctx: PluginContext, ref: IntegrationRef) {
	const { items } = await ctx.storage.sessions.query({ where: { did: ref.did }, orderBy: { updatedAt: "desc" }, limit: 50 });
	return items.map((item) => item.data as SessionEntry).find((entry) => entry.rkey === ref.rkey)?.userId;
}
