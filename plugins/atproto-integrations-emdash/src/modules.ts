import { base32nopad, hex } from "@scure/base";
import type { PluginContext } from "emdash/plugin";
import { ATTEST_NSID, attest } from "./attest";
import type { SessionAgent } from "./flow";
import { requireHttp, xrpcUrl } from "./http";
import { resolveActor } from "./identity";
import { COLLECTION as CLIENT_COLLECTION, type IntegrationRef } from "./record";

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
	proxy?: string;
	service?: string;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown) => (typeof value === "string" ? value : undefined);

// Host pseudo-calls: run by the host, never sent to a PDS, and only when the module record lists them.
// A Worker cannot open webrtc or iroh connections, so those are refused here (a node host runs them).
const CONNECT_CALLS = ["com.fedfork.exec.webrtc.connect", "com.fedfork.exec.iroh.connect"];
const HOST_CALLS = [ATTEST_NSID, ...CONNECT_CALLS];

const NSID = /^[a-zA-Z][a-zA-Z0-9-]*(\.[a-zA-Z0-9-]+){2,}$/;
const ENTRY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
// A service the PDS proxies the call to (the atproto-proxy header): did#service_id.
const PROXY = /^did:[a-z]+:[^#\s]+#[A-Za-z0-9_-]+$/;
// A service called directly, with a service-auth token (aud did:web:<host>, lxm nsid) the host mints: an https origin.
const SERVICE = /^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/;
// Or a DID: a public read (GET, no input, no token) from that DID's own PDS.
const SERVICE_DID = /^did:(plc|web):[A-Za-z0-9._:%-]+$/;

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
		if ((allowed || HOST_CALLS.includes(call.nsid)) && !allowed?.includes(call.nsid)) throw new Error(`Module record does not allow ${call.nsid}`);
		if (call.proxy !== undefined && (typeof call.proxy !== "string" || !PROXY.test(call.proxy))) throw new Error("Module call proxy must be did#service");
		if (call.service !== undefined && (typeof call.service !== "string" || !(SERVICE.test(call.service) || SERVICE_DID.test(call.service)))) {
			throw new Error("Module call service must be an https origin or a DID");
		}
		if (typeof call.service === "string" && SERVICE_DID.test(call.service) && call.input !== undefined) throw new Error("Module call to a DID service is a read: no input");
		if (call.proxy !== undefined && call.service !== undefined) throw new Error("Module call takes proxy or service, not both");
		const params = isObject(call.params)
			? Object.fromEntries(Object.entries(call.params).map(([key, value]) => [key, String(value)]))
			: undefined;
		return { nsid: call.nsid, params, input: call.input, proxy: call.proxy, service: call.service };
	});
	return { calls, next, state: output.state, result: output.result };
}

// Direct call to a service that serves no did:web document: a service-auth token from the user's PDS, never seen by wasm.
// A DID service is a public read from its PDS: no token is minted for third parties.
async function callService(ctx: PluginContext, agent: SessionAgent, call: XrpcCallPlan & { service: string }) {
	const http = requireHttp(ctx);
	if (call.service.startsWith("did:")) return parsed(call.nsid, await http.fetch(xrpcUrl((await resolveActor(ctx, call.service)).pds, call.nsid, call.params ?? {})));
	const { token } = await agent.call<{ token: string }>("com.atproto.server.getServiceAuth", {
		params: { aud: `did:web:${new URL(call.service).host}`, lxm: call.nsid },
	});
	const url = `${call.service}/xrpc/${call.nsid}${call.params ? `?${new URLSearchParams(call.params)}` : ""}`;
	const authorization = `Bearer ${token}`;
	const response = await http.fetch(
		url,
		call.input === undefined
			? { method: "GET", headers: { authorization } }
			: { method: "POST", headers: { authorization, "content-type": "application/json" }, body: JSON.stringify(call.input) },
	);
	return parsed(call.nsid, response);
}

async function parsed(nsid: string, response: Response) {
	const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
	if (!response.ok) throw new Error(`${nsid} failed with ${body.error ?? response.status}${body.message ? `: ${body.message}` : ""}`);
	return body;
}

async function perform(ctx: PluginContext, agent: SessionAgent, call: XrpcCallPlan): Promise<CallResult> {
	try {
		if (CONNECT_CALLS.includes(call.nsid)) throw new Error(`${call.nsid} needs a host that can open webrtc/iroh connections; this EmDash Worker cannot`);
		const output =
			call.nsid === ATTEST_NSID
				? await attest(ctx, agent.userId, agent.account, call.input)
				: call.service
					? await callService(ctx, agent, { ...call, service: call.service })
					: await agent.call(call.nsid, { params: call.params, input: call.input, headers: call.proxy ? { "atproto-proxy": call.proxy } : undefined });
		return { nsid: call.nsid, ok: true, output };
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
		for (const call of step.calls) results.push(await perform(ctx, agent, call));
		rounds.push({ entry: current, calls: results });
		if (!step.next) return { module: module.name, entry, rounds, result: step.result ?? null };
		current = step.next;
		carried = { state: step.state, results };
	}
}
