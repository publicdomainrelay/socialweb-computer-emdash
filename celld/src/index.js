import { generateWasmAbiRuntimeSource, prepareWasmRun, WASM_LIMITS } from "../vendor/emdash/wasm.mjs";

const COLLECTION = "com.publicdomainrelay.temp.wasm.module";
const ABI = "emdash-wasm-json-v1";
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
const RESERVED = new Set(["did", "rkey", "entry", "now"]);
const CPU_LIMIT = /exceeded CPU (time )?limit/i;

const runnerSource = `import { WorkerEntrypoint } from "cloudflare:workers";
import compiled from "./module.wasm";

${generateWasmAbiRuntimeSource()}

export default class WasmRunner extends WorkerEntrypoint {
	async run(entry, inputJson) {
		try {
			return { ok: true, output: runWasmJsonAbi(compiled, entry, inputJson, WASM_LIMITS) };
		} catch (error) {
			return { ok: false, error: error instanceof Error ? error.message : String(error) };
		}
	}
}
`;

class HttpError extends Error {
	constructor(status, message) {
		super(message);
		this.status = status;
	}
}

function json(body, status = 200, headers = {}) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});
}

async function getJson(url) {
	const response = await fetch(url, { headers: { accept: "application/json" } });
	if (!response.ok) throw new HttpError(502, `${url} returned ${response.status}`);
	return response.json();
}

async function resolvePds(did) {
	let doc;
	if (did.startsWith("did:plc:")) {
		doc = await getJson(`https://plc.directory/${did}`);
	} else if (did.startsWith("did:web:")) {
		doc = await getJson(`https://${did.slice(8).replaceAll(":", "/")}/.well-known/did.json`);
	} else {
		throw new HttpError(400, "did must be did:plc or did:web");
	}
	const service = (doc.service ?? []).find(
		(item) => item.id === "#atproto_pds" || item.id === `${did}#atproto_pds`,
	);
	if (!service?.serviceEndpoint) throw new HttpError(502, "DID document has no #atproto_pds");
	return String(service.serviceEndpoint).replace(/\/+$/, "");
}

function sha256FromCid(cid) {
	if (typeof cid !== "string" || !cid.startsWith("b")) {
		throw new HttpError(502, "blob CID must be base32 CIDv1");
	}
	const bytes = [];
	let buffer = 0;
	let bits = 0;
	for (const char of cid.slice(1)) {
		const value = BASE32.indexOf(char);
		if (value < 0) throw new HttpError(502, "blob CID is not base32");
		buffer = (buffer << 5) | value;
		bits += 5;
		if (bits >= 8) {
			bits -= 8;
			bytes.push((buffer >> bits) & 0xff);
		}
	}
	if (bytes.length !== 36 || bytes[0] !== 0x01 || bytes[1] !== 0x55 || bytes[2] !== 0x12 || bytes[3] !== 0x20) {
		throw new HttpError(502, "blob CID must be CIDv1 raw sha2-256");
	}
	return bytes.slice(4).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function withTimeout(promise, ms) {
	let timer;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => reject(new HttpError(504, `WASM_TIMEOUT: module exceeded ${ms}ms`)), ms);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function run(url, env) {
	const did = url.searchParams.get("did") ?? "";
	const rkey = url.searchParams.get("rkey") ?? "";
	const entry = url.searchParams.get("entry") ?? "";
	if (!did || !rkey || !entry) throw new HttpError(400, "did, rkey and entry are required");

	const pds = await resolvePds(did);
	const record = await getJson(
		`${pds}/xrpc/com.atproto.repo.getRecord?${new URLSearchParams({ repo: did, collection: COLLECTION, rkey })}`,
	);
	const value = record.value ?? {};
	if (value.abi !== ABI) throw new HttpError(422, `record abi must be ${ABI}`);
	const action = (value.actions ?? []).find((item) => item.entry === entry);
	if (!action) throw new HttpError(422, `${entry} is not a declared action`);

	const cid = value.module?.ref?.$link;
	const sha256 = sha256FromCid(cid);
	const blob = await fetch(`${pds}/xrpc/com.atproto.sync.getBlob?${new URLSearchParams({ did, cid })}`);
	if (!blob.ok) throw new HttpError(502, `getBlob returned ${blob.status}`);
	const module = new Uint8Array(await blob.arrayBuffer());

	const input = {};
	for (const field of action.fields ?? []) {
		if (RESERVED.has(field.key)) continue;
		const fieldValue = url.searchParams.get(field.key);
		if (fieldValue !== null) input[field.key] = fieldValue;
	}
	input.now = url.searchParams.get("now") ?? new Date().toISOString();
	input.did = did;

	let prepared;
	try {
		prepared = await prepareWasmRun({ module, entry, input, sha256 });
	} catch (error) {
		throw new HttpError(422, error.message);
	}

	const worker = env.LOADER.get(`emdash-wasm-${prepared.sha256}`, () => ({
		compatibilityDate: "2026-04-01",
		mainModule: "runner.js",
		modules: {
			"runner.js": { js: runnerSource },
			"module.wasm": { wasm: prepared.module.slice().buffer },
		},
		globalOutbound: null,
		limits: { cpuMs: WASM_LIMITS.wallTimeMs },
	}));
	const result = await withTimeout(
		worker.getEntrypoint().run(prepared.entry, prepared.inputJson),
		WASM_LIMITS.wallTimeMs,
	).catch((error) => {
		if (CPU_LIMIT.test(error?.message ?? "")) {
			throw new HttpError(504, "WASM_TIMEOUT: module exceeded its CPU time limit");
		}
		throw error;
	});
	if (!result.ok) throw new HttpError(422, result.error);
	return json(JSON.parse(result.output), 200, {
		"x-wasm-sha256": prepared.sha256,
		"x-wasm-cid": cid,
		"x-atproto-pds": pds,
	});
}

export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		if (request.method !== "GET" || url.pathname !== "/run") {
			return json({ error: "GET /run?did=&rkey=&entry=&<field>=" }, 404);
		}
		try {
			return await run(url, env);
		} catch (error) {
			return json({ error: error instanceof Error ? error.message : String(error) }, error.status ?? 500);
		}
	},
};
