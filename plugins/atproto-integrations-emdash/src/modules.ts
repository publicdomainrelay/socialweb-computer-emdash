import type { PluginContext } from "emdash/plugin";
import { sessionAgent } from "./flow";
import { requireHttp } from "./oauth/http";
import { resolveIdentity } from "./oauth/identity";
import { COLLECTION as CLIENT_COLLECTION, type IntegrationRef } from "./record";

export const MODULE_COLLECTION = "com.publicdomainrelay.temp.wasm.module";
export const MODULE_ABI = "emdash-wasm-json-v1";

export interface ModuleField {
	key: string;
	label: string;
}

export interface ModuleAction {
	entry: string;
	label: string;
	description?: string;
	fields: ModuleField[];
}

export interface WasmModuleRecord {
	name: string;
	description?: string;
	blobCid: string;
	session: IntegrationRef;
	actions: ModuleAction[];
}

interface XrpcCallPlan {
	nsid: string;
	params?: Record<string, string>;
	input?: unknown;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown) => (typeof value === "string" ? value : undefined);

const NSID = /^[a-zA-Z][a-zA-Z0-9-]*(\.[a-zA-Z0-9-]+){2,}$/;

function parseSessionRef(value: unknown): IntegrationRef {
	const uri = isObject(value) ? text(value.uri) : undefined;
	const match = uri ? /^at:\/\/(did:[^/]+)\/([^/]+)\/([^/]+)$/.exec(uri) : null;
	if (!match || match[2] !== CLIENT_COLLECTION) throw new Error("Module session must reference a clientMetadata record");
	return { did: match[1], rkey: match[3] };
}

function parseActions(value: unknown): ModuleAction[] {
	if (!Array.isArray(value)) return [];
	return value.filter(isObject).flatMap((action) => {
		const entry = text(action.entry);
		const label = text(action.label);
		if (!entry || !label) return [];
		const fields = Array.isArray(action.fields)
			? action.fields.filter(isObject).flatMap((field) => {
					const key = text(field.key);
					return key ? [{ key, label: text(field.label) ?? key }] : [];
				})
			: [];
		return [{ entry, label, description: text(action.description), fields }];
	});
}

export function parseModuleRecord(value: unknown): WasmModuleRecord {
	if (!isObject(value) || typeof value.name !== "string") throw new Error("Not a wasm module record");
	if (value.abi !== MODULE_ABI) throw new Error(`Unsupported module ABI ${String(value.abi)}`);
	const blob = isObject(value.module) ? value.module : undefined;
	const ref = blob && isObject(blob.ref) ? text(blob.ref.$link) : undefined;
	if (!ref) throw new Error("Module record has no blob");
	return {
		name: value.name,
		description: text(value.description),
		blobCid: ref,
		session: parseSessionRef(value.session),
		actions: parseActions(value.actions),
	};
}

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

function base32Decode(value: string) {
	let bits = 0;
	let buffer = 0;
	const out: number[] = [];
	for (const char of value) {
		const index = BASE32.indexOf(char);
		if (index < 0) throw new Error("Invalid base32 CID");
		buffer = (buffer << 5) | index;
		bits += 5;
		if (bits >= 8) {
			bits -= 8;
			out.push((buffer >> bits) & 0xff);
		}
	}
	return Uint8Array.from(out);
}

export function blobSha256(cid: string) {
	if (!cid.startsWith("b")) throw new Error("Blob CID must be base32 CIDv1");
	const bytes = base32Decode(cid.slice(1));
	if (bytes.length !== 36 || bytes[0] !== 0x01 || bytes[1] !== 0x55 || bytes[2] !== 0x12 || bytes[3] !== 0x20) {
		throw new Error("Blob CID must be a raw sha2-256 CIDv1");
	}
	return Array.from(bytes.slice(4), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function listModules(ctx: PluginContext, pds: string, did: string) {
	const query = new URLSearchParams({ repo: did, collection: MODULE_COLLECTION, limit: "100" });
	const response = await requireHttp(ctx)
		.fetch(`${pds}/xrpc/com.atproto.repo.listRecords?${query}`)
		.catch(() => undefined);
	if (!response?.ok) return [];
	const { records } = (await response.json()) as { records: Array<{ uri: string; value: unknown }> };
	return records.flatMap(({ uri, value }) => {
		try {
			return [{ did, rkey: uri.split("/").pop() ?? "", uri, ...parseModuleRecord(value) }];
		} catch (error) {
			ctx.log.warn("Skipping invalid wasm module record", { uri, error: error instanceof Error ? error.message : String(error) });
			return [];
		}
	});
}

function parsePlan(output: unknown): XrpcCallPlan[] {
	if (isObject(output) && typeof output.error === "string") throw new Error(output.error);
	if (!isObject(output) || !Array.isArray(output.calls)) throw new Error("Module output must contain calls");
	if (output.calls.length > 10) throw new Error("Module requested too many calls");
	return output.calls.map((call) => {
		if (!isObject(call) || typeof call.nsid !== "string" || !NSID.test(call.nsid)) throw new Error("Module call needs an NSID");
		const params = isObject(call.params)
			? Object.fromEntries(Object.entries(call.params).map(([key, value]) => [key, String(value)]))
			: undefined;
		return { nsid: call.nsid, params, input: call.input };
	});
}

export async function runModule(
	ctx: PluginContext,
	userId: string,
	ref: IntegrationRef,
	entry: string,
	input: Record<string, unknown>,
) {
	if (!ctx.wasm) throw new Error("The wasm:execute capability is required");
	const http = requireHttp(ctx);
	const identity = await resolveIdentity(http, ref.did);
	const query = new URLSearchParams({ repo: ref.did, collection: MODULE_COLLECTION, rkey: ref.rkey });
	const recordResponse = await http.fetch(`${identity.pds}/xrpc/com.atproto.repo.getRecord?${query}`);
	if (!recordResponse.ok) throw new Error("Module record not found");
	const module = parseModuleRecord(((await recordResponse.json()) as { value: unknown }).value);
	if (!module.actions.some((action) => action.entry === entry)) throw new Error(`Module has no action ${entry}`);
	const agent = await sessionAgent(ctx, userId, module.session);
	if (!agent) throw new Error("Connect the integration this module uses first");
	const sha256 = blobSha256(module.blobCid);
	const blobQuery = new URLSearchParams({ did: ref.did, cid: module.blobCid });
	const blobResponse = await http.fetch(`${identity.pds}/xrpc/com.atproto.sync.getBlob?${blobQuery}`);
	if (!blobResponse.ok) throw new Error("Module blob not found");
	const bytes = new Uint8Array(await blobResponse.arrayBuffer());
	const output = await ctx.wasm.run({
		module: bytes,
		sha256,
		entry,
		input: { ...input, did: module.session.did, now: new Date().toISOString() },
	});
	const results = [];
	for (const call of parsePlan(output)) {
		results.push({ nsid: call.nsid, output: await agent.call(call.nsid, { params: call.params, input: call.input }) });
	}
	return { module: module.name, entry, results };
}
