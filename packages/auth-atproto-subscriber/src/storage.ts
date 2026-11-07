import type { Store } from "@atcute/oauth-node-client";
import type { AuthProviderDescriptor } from "emdash";
import { PROVIDER_ID, STORAGE } from "./policy";

export type EmDash = NonNullable<App.Locals["emdash"]>;

interface Collection<T> {
	get(id: string): Promise<T | null>;
	put(id: string, data: T): Promise<void>;
	delete(id: string): Promise<boolean>;
	deleteMany(ids: string[]): Promise<number>;
	query(options?: { limit?: number }): Promise<{ items: Array<{ id: string; data: T }> }>;
}

interface Entry<V> {
	value: V;
	expiresAt: number | null;
}

export function providerConfig(emdash: EmDash) {
	const providers = (emdash.config as { authProviders?: AuthProviderDescriptor[] } | undefined)?.authProviders;
	return providers?.find((provider) => provider.id === PROVIDER_ID);
}

export async function statesCollection<V>(emdash: EmDash) {
	const { getAuthProviderStorage } = await import("emdash/api/route-utils");
	const storage = getAuthProviderStorage(emdash.db, PROVIDER_ID, STORAGE);
	return storage.states as unknown as Collection<Entry<V>>;
}

export function dbStore<K extends string, V>(collection: Collection<Entry<V>>): Store<K, V> {
	return {
		async get(key) {
			const entry = await collection.get(key);
			if (!entry) return undefined;
			if (entry.expiresAt && Date.now() > entry.expiresAt * 1000) {
				await collection.delete(key);
				return undefined;
			}
			return entry.value;
		},
		async set(key, value) {
			await collection.put(key, { value, expiresAt: (value as { expiresAt?: number }).expiresAt ?? null });
		},
		async delete(key) {
			await collection.delete(key);
		},
		async clear() {
			const { items } = await collection.query({ limit: 10000 });
			if (items.length) await collection.deleteMany(items.map((item) => item.id));
		},
	};
}
