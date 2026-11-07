import type { Did } from "@atcute/lexicons";
import {
	type AuthorizationServerMetadataCache,
	MemoryStore,
	OAuthClient,
	type ProtectedResourceMetadataCache,
	type PublicClientMetadata,
	type Store,
	type StoredSession,
	type StoredState,
} from "@atcute/oauth-node-client";
import type { PluginContext } from "emdash/plugin";
import { resolvers } from "./identity";
import { storageLock } from "./lock";
import { clientConfig, type IntegrationRecord, type IntegrationRef } from "./record";
import { type Sealed, seal, unseal } from "./seal";

export interface ClientEntry extends IntegrationRef {
	origin: string;
	cid: string;
	record: IntegrationRecord;
}

export interface PendingEntry extends IntegrationRef {
	userId: string;
	account?: string;
	createdAt: number;
	sealed: Sealed;
}

export interface SessionEntry extends IntegrationRef {
	userId: string;
	account?: string;
	scope: string;
	updatedAt: string;
	sealed: Sealed;
}

export interface AuthorizeState extends IntegrationRef {
	userId: string;
	account: string;
}

export const clientKey = ({ did, rkey }: IntegrationRef) => `${did}/${rkey}`;
export const sessionKey = (userId: string, ref: IntegrationRef) => `${userId}/${clientKey(ref)}`;

const METADATA_TTL_MS = 10 * 60 * 1000;
const asMetadata: AuthorizationServerMetadataCache = new MemoryStore({ maxSize: 100, ttl: METADATA_TTL_MS });
const prMetadata: ProtectedResourceMetadataCache = new MemoryStore({ maxSize: 100, ttl: METADATA_TTL_MS });

const WRONG_ACCOUNT = "This session belongs to another account";

function stateStore(ctx: PluginContext): Store<string, StoredState> {
	return {
		async get(id) {
			const entry = (await ctx.storage.pending.get(id)) as PendingEntry | null;
			return entry ? unseal<StoredState>(ctx, `pending/${id}`, entry.sealed) : undefined;
		},
		async set(id, value) {
			const { did, rkey, userId, account } = value.userState as AuthorizeState;
			await ctx.storage.pending.put(id, {
				did,
				rkey,
				userId,
				account,
				createdAt: Date.now(),
				sealed: await seal(ctx, `pending/${id}`, value),
			} satisfies PendingEntry);
		},
		async delete(id) {
			await ctx.storage.pending.delete(id);
		},
		async clear() {
			for (;;) {
				const { items } = await ctx.storage.pending.query({ limit: 100 });
				if (!items.length) return;
				await ctx.storage.pending.deleteMany(items.map((item) => item.id));
			}
		},
	};
}

function sessionStore(ctx: PluginContext, userId: string, ref: IntegrationRef, account: string): Store<Did, StoredSession> {
	const id = sessionKey(userId, ref);
	return {
		async get(sub) {
			const entry = sub === account ? ((await ctx.storage.sessions.get(id)) as SessionEntry | null) : null;
			return entry && (entry.account ?? entry.did) === account ? unseal<StoredSession>(ctx, `sessions/${id}`, entry.sealed) : undefined;
		},
		async set(sub, value) {
			if (sub !== account) throw new Error(WRONG_ACCOUNT);
			await ctx.storage.sessions.put(id, {
				did: ref.did,
				rkey: ref.rkey,
				userId,
				account,
				scope: value.tokenSet.scope,
				updatedAt: new Date().toISOString(),
				sealed: await seal(ctx, `sessions/${id}`, value),
			} satisfies SessionEntry);
		},
		async delete(sub) {
			if (sub === account) await ctx.storage.sessions.delete(id);
		},
		async clear() {
			await ctx.storage.sessions.delete(id);
		},
	};
}

function publicMetadata(entry: ClientEntry): PublicClientMetadata {
	const { clientId, redirectUri, scope } = clientConfig(entry.origin, entry, entry.record);
	const redirect_uris: [string] = [redirectUri];
	return (clientId.startsWith("http://localhost")
		? { redirect_uris, scope }
		: { client_id: clientId, redirect_uris, scope }) as PublicClientMetadata;
}

export function oauthClient(ctx: PluginContext, entry: ClientEntry, userId: string, account: string = entry.did) {
	const { fetch, actors } = resolvers(ctx);
	return new OAuthClient({
		metadata: publicMetadata(entry),
		actorResolver: actors,
		stores: { sessions: sessionStore(ctx, userId, entry, account), states: stateStore(ctx), asMetadata, prMetadata },
		requestLock: storageLock(ctx, sessionKey(userId, entry)),
		fetch,
	});
}
