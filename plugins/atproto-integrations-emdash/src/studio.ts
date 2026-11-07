import { base64, hex } from "@scure/base";
import type { PluginContext } from "emdash/plugin";
import { beginConnect, disconnect, fetchRecord, type SessionAgent, sessionAgent } from "./flow";
import { MODULE_COLLECTION, parseModuleRecord } from "./modules";
import { COLLECTION, type IntegrationRef, parseRecord, RKEY, recordUri } from "./record";
import { grantedGroupKeys } from "./scopes";
import { siteIntegrations } from "./site";

export const FILE_COLLECTION = "com.fedfork.exec.source.file";
export const MANIFEST_COLLECTION = "com.fedfork.exec.source.manifest";
export const STUDIO_KEY = "studio";

const MODULE_ABI = "emdash-wasm-json-v1";
const MAX_MODULE_BYTES = 4 * 1024 * 1024;
const MAX_FILE_CHARS = 262144;
const MAX_FILES = 200;
const WASM_HEADER = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
const LANGUAGES = new Set(["assemblyscript", "rust"]);
const ENTRY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const NSID = /^[a-zA-Z][a-zA-Z0-9-]*(\.[a-zA-Z0-9-]+){2,}$/;
const FIELD_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const TOOLS = new Set(["asc", "cargo"]);

type Input = Record<string, unknown>;
type StrongRef = { uri: string; cid: string };

const isObject = (value: unknown): value is Input => typeof value === "object" && value !== null && !Array.isArray(value);

function text(value: unknown, name: string, max: number) {
	if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
	if (value.length > max) throw new Error(`${name} is longer than ${max} characters`);
	return value;
}

const optional = (value: unknown, name: string, max: number) => (value === undefined || value === "" ? undefined : text(value, name, max));

function recordKey(value: unknown, name: string) {
	if (typeof value !== "string" || !RKEY.test(value) || value === "." || value === "..") {
		throw new Error(`${name} must be 1 to 512 characters of letters, digits and . _ : ~ -`);
	}
	return value;
}

function sourcePath(value: unknown) {
	const path = text(value, "File path", 512);
	if (path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => part === "" || part === "." || part === "..")) {
		throw new Error(`File path ${path} must be relative, without empty, . or .. segments`);
	}
	return path;
}

const sha256 = async (bytes: Uint8Array<ArrayBuffer>) => hex.encode(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));

export async function studioRef(ctx: PluginContext, siteOrigin: string): Promise<IntegrationRef> {
	const ref = (await siteIntegrations(ctx, siteOrigin)).find((item) => item.rkey === STUDIO_KEY);
	if (!ref) throw new Error("This site offers no studio integration");
	return ref;
}

async function requireStudio(ctx: PluginContext, userId: string, siteOrigin: string) {
	const agent = await sessionAgent(ctx, userId, await studioRef(ctx, siteOrigin));
	if (!agent) throw new Error("Connect the studio first");
	return agent;
}

export async function connectStudio(ctx: PluginContext, userId: string, origin: string, siteOrigin: string, account: string, groups: string[]) {
	const site = await siteIntegrations(ctx, siteOrigin);
	return beginConnect(ctx, userId, origin, await studioRef(ctx, siteOrigin), groups, account, site);
}

export async function studioStatus(ctx: PluginContext, userId: string, siteOrigin: string) {
	const ref = await studioRef(ctx, siteOrigin);
	const [{ record }, agent] = await Promise.all([fetchRecord(ctx, ref), sessionAgent(ctx, userId, ref)]);
	const scope = agent ? await agent.scope() : undefined;
	const granted = scope ? grantedGroupKeys(record.scopeGroups, scope) : [];
	return {
		uri: recordUri(ref),
		name: record.name,
		description: record.description,
		connected: Boolean(agent),
		account: agent?.account,
		scope,
		groups: record.scopeGroups.map((group) => ({ ...group, granted: granted.includes(group.key) })),
	};
}

export async function disconnectStudio(ctx: PluginContext, userId: string, siteOrigin: string) {
	await disconnect(ctx, userId, await studioRef(ctx, siteOrigin));
}

export async function publishIntegration(ctx: PluginContext, userId: string, siteOrigin: string, input: Input) {
	const rkey = recordKey(input.rkey, "Record key");
	const value = isObject(input.record) ? input.record : {};
	const record = parseRecord(value);
	const agent = await requireStudio(ctx, userId, siteOrigin);
	return agent.call<StrongRef>("com.atproto.repo.putRecord", {
		input: {
			repo: agent.account,
			collection: COLLECTION,
			rkey,
			record: {
				$type: COLLECTION,
				name: record.name,
				...(record.description ? { description: record.description } : {}),
				clientMetadata: record.clientMetadata,
				scopeGroups: record.scopeGroups,
				createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
			},
		},
	});
}

async function existing(agent: SessionAgent, did: string, collection: string, rkey: string) {
	try {
		const { uri, cid } = await agent.call<StrongRef>("com.atproto.repo.getRecord", { params: { repo: did, collection, rkey } });
		return { uri, cid };
	} catch {
		return undefined;
	}
}

function sourceFiles(value: unknown) {
	if (!Array.isArray(value) || value.length === 0 || value.length > MAX_FILES) throw new Error(`Send 1 to ${MAX_FILES} source files`);
	const seen = new Set<string>();
	return value.map((file) => {
		const item = isObject(file) ? file : {};
		const path = sourcePath(item.path);
		if (seen.has(path)) throw new Error(`File path ${path} appears twice`);
		seen.add(path);
		if (typeof item.text !== "string" || item.text.length > MAX_FILE_CHARS) throw new Error(`${path} must be text of at most ${MAX_FILE_CHARS} characters`);
		return { path, text: item.text };
	});
}

async function publishFiles(agent: SessionAgent, did: string, files: Array<{ path: string; text: string }>, createdAt: string) {
	const entries: Array<{ path: string; file: StrongRef }> = [];
	for (const { path, text } of files) {
		const bytes = new TextEncoder().encode(text);
		const sha = await sha256(bytes);
		const ref =
			(await existing(agent, did, FILE_COLLECTION, sha)) ??
			(await agent.call<StrongRef>("com.atproto.repo.createRecord", {
				input: {
					repo: did,
					collection: FILE_COLLECTION,
					rkey: sha,
					record: { $type: FILE_COLLECTION, sha256: sha, size: bytes.length, text, createdAt },
				},
			}));
		entries.push({ path, file: { uri: ref.uri, cid: ref.cid } });
	}
	return entries;
}

function moduleBytes(value: unknown) {
	if (typeof value !== "string") throw new Error("wasm is required");
	const bytes = new Uint8Array(base64.decode(value));
	if (bytes.length > MAX_MODULE_BYTES) throw new Error(`The module is larger than ${MAX_MODULE_BYTES} bytes`);
	if (!WASM_HEADER.every((byte, index) => bytes[index] === byte)) throw new Error("wasm is not a WebAssembly 1.0 module");
	return bytes;
}

function buildInfo(value: unknown) {
	const build = isObject(value) ? value : {};
	const tool = text(build.tool, "Build tool", 64);
	if (!TOOLS.has(tool)) throw new Error(`Build tool must be one of ${[...TOOLS].join(", ")}`);
	return {
		tool,
		version: text(build.version, "Compiler version", 256),
		command: text(build.command, "Build command", 2048),
		...(build.artifact === undefined ? {} : { artifact: sourcePath(build.artifact) }),
	};
}

function originInfo(value: unknown) {
	if (value === undefined) return undefined;
	const origin = isObject(value) ? value : {};
	const repository = text(origin.repository, "Origin repository", 2048);
	if (!repository.startsWith("https://")) throw new Error("Origin repository must be an https URL");
	const commit = optional(origin.commit, "Origin commit", 64);
	if (commit && !/^[0-9a-f]{7,64}$/.test(commit)) throw new Error("Origin commit must be a hex commit id");
	return { repository, ...(commit ? { commit } : {}) };
}

function actions(value: unknown) {
	if (!Array.isArray(value) || value.length === 0 || value.length > 64) throw new Error("Add 1 to 64 actions");
	return value.map((action) => {
		const item = isObject(action) ? action : {};
		const entry = text(item.entry, "Action entry", 64);
		if (!ENTRY.test(entry)) throw new Error(`Action entry ${entry} must be an exported function name`);
		const fields = Array.isArray(item.fields) ? item.fields : [];
		return {
			entry,
			label: text(item.label, `Label of ${entry}`, 640),
			...(optional(item.description, `Description of ${entry}`, 3000) ? { description: item.description as string } : {}),
			fields: fields.map((field) => {
				const value = isObject(field) ? field : {};
				const key = text(value.key, `Field key in ${entry}`, 64);
				if (!FIELD_KEY.test(key)) throw new Error(`Field key ${key} must be a letter or _ followed by letters, digits or _`);
				return { key, label: optional(value.label, `Label of ${key}`, 640) ?? key };
			}),
		};
	});
}

function calls(value: unknown) {
	if (value === undefined) return undefined;
	if (!Array.isArray(value) || value.length > 64) throw new Error("calls must be a list of at most 64 NSIDs");
	return value.map((nsid) => {
		if (typeof nsid !== "string" || !NSID.test(nsid)) throw new Error(`${String(nsid)} is not an NSID`);
		return nsid;
	});
}

export async function publishModule(ctx: PluginContext, userId: string, siteOrigin: string, input: Input) {
	const rkey = recordKey(input.rkey, "Module key");
	const session = recordKey(input.session, "Integration");
	const name = text(input.name, "Name", 640);
	const description = optional(input.description, "Description", 3000);
	const bytes = moduleBytes(input.wasm);
	const source = isObject(input.source) ? input.source : {};
	const language = text(source.language, "Language", 64);
	if (!LANGUAGES.has(language)) throw new Error(`Language must be one of ${[...LANGUAGES].join(", ")}`);
	const build = buildInfo(source.build);
	const origin = originInfo(source.origin);
	const sources = sourceFiles(source.files);
	const moduleActions = actions(input.actions);
	const allowedCalls = calls(input.calls);
	const agent = await requireStudio(ctx, userId, siteOrigin);
	const did = agent.account;
	const createdAt = new Date().toISOString();

	const integration = await agent.call<StrongRef>("com.atproto.repo.getRecord", { params: { repo: did, collection: COLLECTION, rkey: session } });
	const files = await publishFiles(agent, did, sources, createdAt);
	const manifest = await agent.call<StrongRef>("com.atproto.repo.createRecord", {
		input: {
			repo: did,
			collection: MANIFEST_COLLECTION,
			rkey: `${rkey}.${Date.now()}`,
			record: {
				$type: MANIFEST_COLLECTION,
				name,
				...(description ? { description } : {}),
				language,
				files,
				build,
				output: { sha256: await sha256(bytes), size: bytes.length },
				...(origin ? { origin } : {}),
				createdAt,
			},
		},
	});
	const { blob } = await agent.upload<{ blob: unknown }>("com.atproto.repo.uploadBlob", bytes, "application/wasm");
	const record = {
		$type: MODULE_COLLECTION,
		name,
		...(description ? { description } : {}),
		module: blob,
		abi: MODULE_ABI,
		session: { uri: integration.uri, cid: integration.cid },
		source: { uri: manifest.uri, cid: manifest.cid },
		actions: moduleActions,
		...(allowedCalls ? { calls: allowedCalls } : {}),
		createdAt,
	};
	parseModuleRecord(record);
	const published = await agent.call<StrongRef>("com.atproto.repo.putRecord", { input: { repo: did, collection: MODULE_COLLECTION, rkey, record } });
	return { module: published, source: manifest, files: files.length };
}
