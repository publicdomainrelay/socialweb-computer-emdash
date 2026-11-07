import { base32nopad, hex } from "@scure/base";
import type { PluginContext } from "emdash/plugin";
import type { SessionAgent } from "./flow";
import { requireHttp, xrpcUrl } from "./http";
import { resolveActor } from "./identity";
import { COLLECTION as CLIENT_COLLECTION, type IntegrationRef, STUDIO_RKEY } from "./record";

export const MODULE_COLLECTION = "com.fedfork.exec.wasm.module";
const MODULE_ABI = "emdash-wasm-json-v1";
const MAX_ROUNDS = 8;
const MAX_CALLS_PER_ROUND = 10;
const MAX_CALLS = 25;

interface ModuleField {
	key: string;
	label: string;
}

interface ModuleAction {
	entry: string;
	label: string;
	description?: string;
	fields: ModuleField[];
}

interface WasmModuleRecord {
	name: string;
	description?: string;
	blobCid: string;
	session: IntegrationRef;
	source?: string;
	actions: ModuleAction[];
	calls?: string[];
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
const ENTRY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

function parseSessionRef(value: unknown): IntegrationRef {
	const uri = isObject(value) ? text(value.uri) : undefined;
	const match = uri ? /^at:\/\/(did:[^/]+)\/([^/]+)\/([^/]+)$/.exec(uri) : null;
	if (!match || match[2] !== CLIENT_COLLECTION) throw new Error("Module session must reference a clientMetadata record");
	if (match[3] === STUDIO_RKEY) throw new Error("Modules cannot run with the studio session");
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
		source: isObject(value.source) ? text(value.source.uri) : undefined,
		actions: parseActions(value.actions),
		calls: Array.isArray(value.calls) ? value.calls.filter((nsid): nsid is string => typeof nsid === "string" && NSID.test(nsid)) : undefined,
	};
}

export function blobSha256(cid: string) {
	if (!cid.startsWith("b")) throw new Error("Blob CID must be base32 CIDv1");
	const bytes = base32nopad.decode(cid.slice(1).toUpperCase());
	if (bytes.length !== 36 || bytes[0] !== 0x01 || bytes[1] !== 0x55 || bytes[2] !== 0x12 || bytes[3] !== 0x20) {
		throw new Error("Blob CID must be a raw sha2-256 CIDv1");
	}
	return hex.encode(bytes.subarray(4));
}

export async function listModules(ctx: PluginContext, pds: string, did: string) {
	const response = await requireHttp(ctx)
		.fetch(xrpcUrl(pds, "com.atproto.repo.listRecords", { repo: did, collection: MODULE_COLLECTION, limit: "100" }))
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

interface ModuleStep {
	calls: XrpcCallPlan[];
	next?: string;
	state?: unknown;
	result?: unknown;
}

interface CallResult {
	nsid: string;
	ok: boolean;
	output?: unknown;
	error?: string;
}

function parseStep(output: unknown, allowed: string[] | undefined): ModuleStep {
	if (isObject(output) && typeof output.error === "string") throw new Error(output.error);
	if (!isObject(output) || !Array.isArray(output.calls)) throw new Error("Module output must contain calls");
	if (output.calls.length > MAX_CALLS_PER_ROUND) throw new Error("Module requested too many calls");
	const next = output.next === undefined || output.next === null ? undefined : text(output.next);
	if (output.next !== undefined && output.next !== null && (!next || !ENTRY.test(next))) throw new Error("Module next must be an export name");
	const calls = output.calls.map((call) => {
		if (!isObject(call) || typeof call.nsid !== "string" || !NSID.test(call.nsid)) throw new Error("Module call needs an NSID");
		if (allowed && !allowed.includes(call.nsid)) throw new Error(`Module record does not allow ${call.nsid}`);
		const params = isObject(call.params)
			? Object.fromEntries(Object.entries(call.params).map(([key, value]) => [key, String(value)]))
			: undefined;
		return { nsid: call.nsid, params, input: call.input };
	});
	return { calls, next, state: output.state, result: output.result };
}

async function perform(agent: SessionAgent, call: XrpcCallPlan): Promise<CallResult> {
	try {
		return { nsid: call.nsid, ok: true, output: await agent.call(call.nsid, { params: call.params, input: call.input }) };
	} catch (error) {
		return { nsid: call.nsid, ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}

type AgentFor = (session: IntegrationRef) => Promise<SessionAgent | undefined>;

export async function runModule(
	ctx: PluginContext,
	agentFor: AgentFor,
	ref: IntegrationRef,
	entry: string,
	input: Record<string, unknown>,
) {
	if (!ctx.wasm) throw new Error("The wasm:execute capability is required");
	const wasm = ctx.wasm;
	const http = requireHttp(ctx);
	const identity = await resolveActor(ctx, ref.did);
	const recordResponse = await http.fetch(
		xrpcUrl(identity.pds, "com.atproto.repo.getRecord", { repo: ref.did, collection: MODULE_COLLECTION, rkey: ref.rkey }),
	);
	if (!recordResponse.ok) throw new Error("Module record not found");
	const module = parseModuleRecord(((await recordResponse.json()) as { value: unknown }).value);
	if (!module.actions.some((action) => action.entry === entry)) throw new Error(`Module has no action ${entry}`);
	const agent = await agentFor(module.session);
	if (!agent) throw new Error("Connect the integration this module uses first");
	const sha256 = blobSha256(module.blobCid);
	const blobResponse = await http.fetch(xrpcUrl(identity.pds, "com.atproto.sync.getBlob", { did: ref.did, cid: module.blobCid }));
	if (!blobResponse.ok) throw new Error("Module blob not found");
	const bytes = new Uint8Array(await blobResponse.arrayBuffer());
	const base = { ...input, did: module.session.did };
	const rounds: Array<{ entry: string; calls: CallResult[] }> = [];
	let current = entry;
	let carried: { state?: unknown; results?: CallResult[] } = {};
	let total = 0;
	for (;;) {
		if (rounds.length >= MAX_ROUNDS) throw new Error(`Module exceeded ${MAX_ROUNDS} rounds`);
		const output = await wasm.run({ module: bytes, sha256, entry: current, input: { ...base, ...carried, now: new Date().toISOString() } });
		const step = parseStep(output, module.calls);
		total += step.calls.length;
		if (total > MAX_CALLS) throw new Error(`Module exceeded ${MAX_CALLS} calls`);
		const results: CallResult[] = [];
		for (const call of step.calls) results.push(await perform(agent, call));
		rounds.push({ entry: current, calls: results });
		if (!step.next) return { module: module.name, entry, rounds, result: step.result ?? null };
		current = step.next;
		carried = { state: step.state, results };
	}
}
