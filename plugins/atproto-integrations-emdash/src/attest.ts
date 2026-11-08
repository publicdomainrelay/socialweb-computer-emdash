import { secp256k1 } from "@noble/curves/secp256k1.js";
import { base32nopad, base58, base64nopad, hex } from "@scure/base";
import type { PluginContext } from "emdash/plugin";
import { type Sealed, seal, unseal } from "./seal";

export const ATTEST_NSID = "com.fedfork.exec.attest";
const SIGNATURE = "network.attested.signature";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

interface AttestKeyEntry {
	userId: string;
	did: string;
	sealed: Sealed;
}

const encoder = new TextEncoder();

function head(major: number, n: number): number[] {
	if (n < 24) return [(major << 5) | n];
	const size = n < 0x100 ? 1 : n < 0x10000 ? 2 : n < 0x100000000 ? 4 : 8;
	const out = [(major << 5) | (24 + Math.log2(size))];
	for (let i = size - 1; i >= 0; i--) out.push(Number((BigInt(n) >> BigInt(i * 8)) & 0xffn));
	return out;
}

function compareKeys(a: Uint8Array, b: Uint8Array) {
	if (a.length !== b.length) return a.length - b.length;
	const i = a.findIndex((byte, index) => byte !== b[index]);
	return i < 0 ? 0 : a[i] - b[i];
}

// DAG-CBOR over JSON values, maps sorted length-first. $link/$bytes stay plain maps, as the bidders hash them.
export function dagCbor(value: Json): number[] {
	if (value === null) return [0xf6];
	if (typeof value === "boolean") return [value ? 0xf5 : 0xf4];
	if (typeof value === "number") {
		if (!Number.isSafeInteger(value)) throw new Error("Attested records hold integers only");
		return value >= 0 ? head(0, value) : head(1, -1 - value);
	}
	if (typeof value === "string") {
		const bytes = encoder.encode(value);
		return [...head(3, bytes.length), ...bytes];
	}
	if (Array.isArray(value)) return [...head(4, value.length), ...value.flatMap(dagCbor)];
	const entries = Object.entries(value)
		.filter(([, item]) => item !== undefined)
		.map(([key, item]) => [encoder.encode(key), item] as const)
		.sort(([a], [b]) => compareKeys(a, b));
	return [...head(5, entries.length), ...entries.flatMap(([key, item]) => [...head(3, key.length), ...key, ...dagCbor(item)])];
}

// network.attested.signature: CIDv1 dag-cbor sha2-256 of the record without signatures, with $sig = entry metadata + repository.
export async function attestationCid(record: Record<string, Json>, metadata: Record<string, Json>, repository: string) {
	if (typeof record.$type !== "string" || !record.$type) throw new Error("Attested record needs a $type");
	const { cid: _cid, signature: _signature, ...sig } = metadata;
	const { signatures: _signatures, ...prepared } = record;
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(dagCbor({ ...prepared, $sig: { ...sig, repository } }))));
	const bytes = Uint8Array.from([0x01, 0x71, 0x12, 0x20, ...digest]);
	return { bytes, cid: `b${base32nopad.encode(bytes).toLowerCase()}` };
}

export const didKey = (secretKey: Uint8Array) => `did:key:z${base58.encode(Uint8Array.from([0xe7, 0x01, ...secp256k1.getPublicKey(secretKey, true)]))}`;

export async function signInline(secretKey: Uint8Array, record: Record<string, Json>, repository: string) {
	const metadata = { $type: SIGNATURE, key: didKey(secretKey), issuer: repository };
	const { bytes, cid } = await attestationCid(record, metadata, repository);
	return { ...metadata, cid, signature: { $bytes: base64nopad.encode(secp256k1.sign(bytes, secretKey)) } };
}

export async function verifyInline(record: Record<string, Json>, entry: Record<string, Json>, repository: string) {
	const key = typeof entry.key === "string" ? base58.decode(entry.key.replace(/^did:key:z/, "")) : undefined;
	const signature = entry.signature as { $bytes?: string } | undefined;
	if (!key || key[0] !== 0xe7 || key[1] !== 0x01 || typeof signature?.$bytes !== "string") return false;
	const { bytes, cid } = await attestationCid(record, entry as Record<string, Json>, repository);
	return cid === entry.cid && secp256k1.verify(base64nopad.decode(signature.$bytes.replace(/=+$/, "")), bytes, key.subarray(2));
}

async function attestKey(ctx: PluginContext, userId: string, did: string) {
	const id = `${userId}/${did}`;
	let entry = (await ctx.storage.attest_keys.get(id)) as AttestKeyEntry | null;
	if (!entry) {
		const created: AttestKeyEntry = { userId, did, sealed: await seal(ctx, `attest_keys/${id}`, hex.encode(secp256k1.utils.randomSecretKey())) };
		const result = await ctx.storage.attest_keys.compareAndSet(id, null, created);
		entry = result.applied ? created : ((await ctx.storage.attest_keys.get(id)) as AttestKeyEntry | null);
	}
	if (!entry) throw new Error("Attestation key unavailable");
	return hex.decode(await unseal<string>(ctx, `attest_keys/${id}`, entry.sealed));
}

// The com.fedfork.exec.attest pseudo-call: one key per (EmDash user, session DID), never handed to wasm.
export async function attest(ctx: PluginContext, userId: string, account: string, input: unknown) {
	const { repository, record } = (typeof input === "object" && input !== null ? input : {}) as { repository?: unknown; record?: unknown };
	if (repository !== account) throw new Error("attest repository must be the session DID");
	const secretKey = await attestKey(ctx, userId, account);
	if (record === undefined) return { key: didKey(secretKey) };
	if (typeof record !== "object" || record === null || Array.isArray(record)) throw new Error("attest record must be an object");
	const signed = record as Record<string, Json>;
	const entry = await signInline(secretKey, signed, account);
	return { key: entry.key, record: { ...signed, signatures: [...(Array.isArray(signed.signatures) ? signed.signatures : []), entry] } };
}
