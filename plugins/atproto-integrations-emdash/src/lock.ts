import type { LockFunction } from "@atcute/oauth-node-client";
import type { PluginContext } from "emdash/plugin";

const LEASE_MS = 30_000;
const WAIT_MS = 35_000;
const POLL_MS = 100;

interface Lease {
	expiresAt: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function acquire(ctx: PluginContext, name: string) {
	const deadline = Date.now() + WAIT_MS;
	for (;;) {
		const now = Date.now();
		const held = await ctx.storage.locks.getVersioned(name);
		if (!held || (held.value as Lease).expiresAt < now) {
			const claimed = await ctx.storage.locks.compareAndSet(name, held?.revision ?? null, { expiresAt: now + LEASE_MS } satisfies Lease);
			if (claimed.applied) return claimed.revision;
		}
		if (now > deadline) throw new Error(`Timed out waiting for ${name}`);
		await sleep(POLL_MS);
	}
}

export function storageLock(ctx: PluginContext, scope: string): LockFunction {
	return async (name, fn) => {
		const key = `${scope} ${name}`;
		const revision = await acquire(ctx, key);
		try {
			return await fn();
		} finally {
			await ctx.storage.locks.compareAndDelete(key, revision).catch(() => undefined);
		}
	};
}
