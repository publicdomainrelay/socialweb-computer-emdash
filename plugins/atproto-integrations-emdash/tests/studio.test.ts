import { createHash } from "node:crypto";
import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { base58 } from "@scure/base";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RUN_NSID, siteDid } from "../src/service-auth";
import {
	type Actor,
	ALICE,
	call,
	COLLECTION,
	didDocument,
	ISSUER,
	json,
	MODULE_COLLECTION,
	OPERATOR,
	queueAuthorizationServer,
	queueIdentity,
	queueListing,
	queueSite,
	RECORDS,
	recordUri,
	SITE_URL,
	STUDIO_RECORD,
	useEncryptionKey,
} from "./network";

const FILE_COLLECTION = "com.fedfork.exec.source.file";
const MANIFEST_COLLECTION = "com.fedfork.exec.source.manifest";
const XRPC = `${ALICE.pds}/xrpc`;
const STUDIO_URI = recordUri(OPERATOR, "studio");
const NOTES_URI = recordUri(OPERATOR, "notes");
const STUDIO_SCOPES = {
	integrations: [`repo:${COLLECTION}`],
	modules: [`repo:${MODULE_COLLECTION}`, `repo:${FILE_COLLECTION}`, `repo:${MANIFEST_COLLECTION}`, "blob:application/wasm"],
};
const WASM = Uint8Array.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0xff, 0x80, 0xc3, 0x28, 0x00, 0xfe]);
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const getRecordUrl = (actor: Actor, collection: string, rkey: string) =>
	`${actor.pds}/xrpc/com.atproto.repo.getRecord?${new URLSearchParams({ repo: actor.did, collection, rkey })}`;

let host: PluginRuntimeTestHost;

beforeEach(async () => {
	useEncryptionKey();
	host = await createPluginRuntimeTestHost({ site: { url: SITE_URL } });
});

afterEach(() => host.dispose());

const subscriber = (email = "a@example.com") => host.fixtures.user({ email, role: "subscriber" });
type User = Awaited<ReturnType<typeof subscriber>>;

const lastRequest = (url: string) => host.http.requests().findLast((request) => request.url === url);
const requestsTo = (url: string) => host.http.requests().filter((request) => request.url === url);
const bodyOf = (request: { body: Uint8Array } | undefined) => JSON.parse(new TextDecoder().decode(request?.body));

async function queueOperatorRecord(rkey: string, value: unknown, times = 1) {
	for (let index = 0; index < times; index++) {
		await queueIdentity(host, didDocument([], OPERATOR), 1, OPERATOR);
		await host.http.respond(getRecordUrl(OPERATOR, COLLECTION, rkey), json({ uri: recordUri(OPERATOR, rkey), cid: `bafy${rkey}`, value }));
	}
}

interface ConnectOptions {
	route?: "studio/connect" | "connect";
	rkey?: string;
	value?: unknown;
	groups?: string[];
	site?: unknown;
	callbackSite?: unknown;
}

async function connectSite(user: User, options: ConnectOptions = {}) {
	const { route = "studio/connect", rkey = "studio", value = STUDIO_RECORD, groups = ["integrations", "modules"], site, callbackSite } = options;
	if (site !== undefined) await queueSite(host, site);
	await queueIdentity(host, didDocument(), 2);
	await queueOperatorRecord(rkey, value);
	await queueAuthorizationServer(host);
	await host.http.respond(`${ISSUER}/oauth/par`, json({ error: "use_dpop_nonce" }, 400));
	await host.http.respond(`${ISSUER}/oauth/par`, json({ request_uri: "urn:ietf:params:oauth:request_uri:test", expires_in: 299 }, 201));
	const body = route === "connect" ? { did: OPERATOR.did, rkey, groups, account: ALICE.did } : { account: ALICE.did, groups };
	const started = await call(host, user, route, body);
	const par = new URLSearchParams(new TextDecoder().decode(lastRequest(`${ISSUER}/oauth/par`)?.body));
	await host.http.respond(
		`${ISSUER}/oauth/token`,
		json({ access_token: "studio-token", refresh_token: "studio-refresh", token_type: "DPoP", expires_in: 3600, scope: par.get("scope"), sub: ALICE.did }),
	);
	await queueIdentity(host, didDocument(), 2);
	await queueAuthorizationServer(host);
	await queueAuthorizationServer(host);
	if (callbackSite !== undefined) await queueSite(host, callbackSite, SITE_URL);
	const query = new URLSearchParams({ code: "code", state: par.get("state") ?? "", iss: ISSUER });
	const callback = await host.actions.routes.request("oauth/callback", {
		method: "GET",
		url: `${SITE_URL}/_emdash/api/plugins/atproto-integrations/oauth/callback?${query}`,
	});
	return { started, par, callback };
}

const connectStudio = (user: User, groups = ["integrations", "modules"]) =>
	connectSite(user, { groups, site: { integrations: [STUDIO_URI] }, callbackSite: { integrations: [STUDIO_URI] } });

const integration = (overrides: Record<string, unknown> = {}) => ({
	name: "Notes",
	description: "Write notes",
	clientMetadata: {
		client_id: "https://notes.example/oauth-client-metadata.json",
		redirect_uris: ["https://notes.example/oauth/callback"],
		scope: "atproto repo:com.example.note",
	},
	scopeGroups: [{ key: "notes", label: "Write notes", scopes: ["repo:com.example.note"] }],
	...overrides,
});

const FILES = [
	{ path: "module.ts", text: "export function note(): void {}\n" },
	{ path: "abi.ts", text: 'export const é = "✓";\n' },
];

const moduleInput = (overrides: Record<string, unknown> = {}) => ({
	did: "did:plc:someoneelseentirelyaaaaa",
	rkey: "note",
	session: "statusphere",
	name: "Note",
	description: "Write a note",
	wasm: b64(WASM),
	source: {
		language: "assemblyscript",
		files: FILES,
		build: { tool: "asc", version: "assemblyscript 0.28.20", command: "npx asc module.ts", artifact: "module.wasm" },
		origin: { repository: "https://github.com/example/notes", commit: "0123abcd" },
	},
	actions: [{ entry: "note", label: "Write note", fields: [{ key: "text", label: "Text" }, { key: "mood" }] }],
	calls: ["com.atproto.repo.createRecord"],
	...overrides,
});

describe("connecting a site integration", () => {
	it("refuses another account's record that the site does not offer", async () => {
		await queueSite(host, { integrations: [NOTES_URI] });
		const refused = await call(host, await subscriber(), "connect", { did: OPERATOR.did, rkey: "studio", groups: [], account: ALICE.did });
		expect(refused.success).toBe(false);
		expect(refused.error?.message).toContain("Only the account that published an integration record");
		expect(host.http.requests().some((request) => request.url.startsWith(ISSUER))).toBe(false);
	});

	it("authorizes the signed-in account for the chosen groups of a site integration", async () => {
		const { started, par } = await connectSite(await subscriber(), { groups: ["modules"], site: { integrations: [STUDIO_URI] } });
		expect(started.error).toBeUndefined();
		expect(started.data.url).toContain(`${ISSUER}/oauth/authorize?`);
		expect(par.get("scope")).toBe(["atproto", ...STUDIO_SCOPES.modules].join(" "));
		expect(par.get("login_hint")).toBe(ALICE.handle);
		expect(par.get("client_id")).toBe(`${SITE_URL}/integrations/${OPERATOR.did}/studio/oauth-client-metadata.json`);
	});

	it("stores the session for the signed-in account and returns to /studio for the studio", async () => {
		const user = await subscriber();
		const { callback } = await connectStudio(user, ["integrations"]);
		expect(callback.headers.get("location")).toBe("/studio?connected=studio");
		await queueOperatorRecord("studio", STUDIO_RECORD);
		const status = await call(host, user, "studio/status", {});
		expect(status.data).toEqual({
			uri: STUDIO_URI,
			name: STUDIO_RECORD.name,
			description: STUDIO_RECORD.description,
			connected: true,
			account: ALICE.did,
			scope: ["atproto", ...STUDIO_SCOPES.integrations].join(" "),
			groups: STUDIO_RECORD.scopeGroups.map((group) => ({ ...group, granted: group.key === "integrations" })),
		});
	});

	it("returns to /integrations for any other site integration", async () => {
		const { callback } = await connectSite(await subscriber(), {
			route: "connect",
			rkey: "notes",
			value: RECORDS.statusphere,
			groups: ["status"],
			site: { integrations: [NOTES_URI, STUDIO_URI] },
			callbackSite: { integrations: [NOTES_URI, STUDIO_URI] },
		});
		expect(callback.headers.get("location")).toBe("/integrations?connected=notes");
	});

	it("does not send a studio record the site does not offer back to /studio", async () => {
		const { callback } = await connectSite(await subscriber(), {
			route: "connect",
			site: { integrations: [STUDIO_URI] },
			callbackSite: { integrations: [] },
		});
		expect(callback.headers.get("location")).toBe("/integrations?connected=studio");
	});
});

describe("listing site integrations", () => {
	it("lists site integrations before the user's own and shows grants only for that user's session", async () => {
		const user = await subscriber();
		await connectStudio(user, ["modules"]);
		await queueListing(host);
		await queueOperatorRecord("studio", STUDIO_RECORD);
		const listed = (await call(host, user, "integrations", { did: ALICE.did })).data.integrations;
		expect(listed.map((item: { rkey: string; site: boolean }) => [item.rkey, item.site])).toEqual([
			["studio", true],
			...Object.keys(RECORDS).map((rkey) => [rkey, false]),
		]);
		expect(listed[0]).toMatchObject({ did: OPERATOR.did, uri: STUDIO_URI, modules: [], session: { handle: ALICE.handle } });
		expect(listed[0].groups.map((group: { key: string; granted: boolean }) => [group.key, group.granted])).toEqual([
			["integrations", false],
			["modules", true],
		]);

		const other = await subscriber("b@example.com");
		await queueListing(host);
		await queueOperatorRecord("studio", STUDIO_RECORD);
		const theirs = (await call(host, other, "integrations", { did: ALICE.did })).data.integrations;
		expect(theirs[0]).toMatchObject({ rkey: "studio", site: true, session: null });
		expect(theirs[0].groups.every((group: { granted: boolean }) => !group.granted)).toBe(true);
	});
});

describe("site sessions and modules", () => {
	const sneaky = (session: string) => ({
		$type: MODULE_COLLECTION,
		name: "Sneaky",
		module: { $type: "blob", ref: { $link: "bafkreictmtxavczjvlhbbe3okiw3ygtjuy2ajnj26izqpnstom4dxfb3ry" }, mimeType: "application/wasm", size: 1 },
		abi: "emdash-wasm-json-v1",
		session: { uri: session, cid: "bafy" },
		actions: [{ entry: "go", label: "Go", fields: [] }],
		createdAt: "2026-11-07T00:00:00.000Z",
	});

	it("refuses to run a module with a site integration connected for another account", async () => {
		const user = await subscriber();
		await connectStudio(user);
		await queueIdentity(host, didDocument(), 2);
		await host.http.respond(getRecordUrl(ALICE, MODULE_COLLECTION, "sneaky"), json({ uri: `at://${ALICE.did}/${MODULE_COLLECTION}/sneaky`, cid: "bafy", value: sneaky(STUDIO_URI) }));
		await queueAuthorizationServer(host);
		const ran = await call(host, user, "run", { did: ALICE.did, rkey: "sneaky", entry: "go", input: {} });
		expect(ran.success).toBe(false);
		expect(ran.error?.message).toContain("Connect the integration this module uses first");
		expect(host.http.requests().some((request) => request.url.includes("com.atproto.sync.getBlob"))).toBe(false);
	});

	it("does not let service auth runs use a site session", async () => {
		const secretKey = secp256k1.utils.randomSecretKey();
		const multikey = `z${base58.encode(Uint8Array.from([0xe7, 0x01, ...secp256k1.getPublicKey(secretKey, true)]))}`;
		await connectStudio(await subscriber());
		host.http.clear();
		await host.http.respond(
			`https://plc.directory/${encodeURIComponent(OPERATOR.did)}`,
			json(didDocument([{ id: `${OPERATOR.did}#atproto`, type: "Multikey", controller: OPERATOR.did, publicKeyMultibase: multikey }], OPERATOR)),
		);
		await queueIdentity(host, didDocument([], OPERATOR), 1, OPERATOR);
		await host.http.respond(getRecordUrl(OPERATOR, MODULE_COLLECTION, "sneaky"), json({ uri: `at://${OPERATOR.did}/${MODULE_COLLECTION}/sneaky`, cid: "bafy", value: sneaky(STUDIO_URI) }));
		const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "ES256K", typ: "JWT" })));
		const payload = b64url(
			new TextEncoder().encode(
				JSON.stringify({ iss: OPERATOR.did, aud: siteDid(SITE_URL), lxm: RUN_NSID, exp: Math.floor(Date.now() / 1000) + 60, jti: crypto.randomUUID() }),
			),
		);
		const token = `${header}.${payload}.${b64url(secp256k1.sign(new TextEncoder().encode(`${header}.${payload}`), secretKey))}`;
		const response = await host.actions.routes.request("service/run", {
			method: "POST",
			headers: { "X-EmDash-Request": "1" },
			body: { token, module: `at://${OPERATOR.did}/${MODULE_COLLECTION}/sneaky`, entry: "go", input: {} },
		});
		const body = (await response.json()) as { data: { error?: string; message?: string } };
		expect(body.data).toEqual({ error: "InvalidRequest", message: "Connect the integration this module uses first" });
		expect(host.http.requests().some((request) => request.url.startsWith(XRPC))).toBe(false);
	});
});

describe("studio/publish-integration", () => {
	it("validates the record before writing", async () => {
		const user = await subscriber();
		const cases: Array<[Record<string, unknown>, string]> = [
			[{ rkey: "notes", record: integration({ clientMetadata: { ...integration().clientMetadata, scope: "repo:com.example.note" } }) }, "atproto"],
			[{ rkey: "bad key", record: integration() }, "Record key"],
			[{ rkey: "..", record: integration() }, "Record key"],
			[{ rkey: "notes", record: {} }, "clientMetadata"],
		];
		for (const [input, message] of cases) {
			const result = await call(host, user, "studio/publish-integration", input);
			expect(result.success).toBe(false);
			expect(result.error?.message).toContain(message);
		}
		expect(host.http.requests()).toHaveLength(0);
	});

	it("requires a studio session", async () => {
		await queueSite(host, { integrations: [STUDIO_URI] });
		const result = await call(host, await subscriber(), "studio/publish-integration", { rkey: "notes", record: integration() });
		expect(result.success).toBe(false);
		expect(result.error?.message).toContain("Connect the studio first");
	});

	it("writes to the studio session's account whatever did the request names", async () => {
		const user = await subscriber();
		await connectStudio(user);
		await host.http.respond(`${XRPC}/com.atproto.repo.putRecord`, json({ uri: `at://${ALICE.did}/${COLLECTION}/notes`, cid: "bafynotes" }));
		const result = await call(host, user, "studio/publish-integration", {
			did: OPERATOR.did,
			rkey: "notes",
			record: integration({ createdAt: "2026-11-07T01:02:03.000Z" }),
		});
		expect(result.data).toEqual({ uri: `at://${ALICE.did}/${COLLECTION}/notes`, cid: "bafynotes" });
		const put = lastRequest(`${XRPC}/com.atproto.repo.putRecord`);
		expect(put?.headers.authorization).toBe("DPoP studio-token");
		expect(put?.headers.dpop).toBeTruthy();
		expect(bodyOf(put)).toEqual({
			repo: ALICE.did,
			collection: COLLECTION,
			rkey: "notes",
			record: {
				$type: COLLECTION,
				name: "Notes",
				description: "Write notes",
				clientMetadata: integration().clientMetadata,
				scopeGroups: integration().scopeGroups,
				createdAt: "2026-11-07T01:02:03.000Z",
			},
		});
		expect(host.http.requests().some((request) => request.url.startsWith(OPERATOR.pds) && request.url.includes("putRecord"))).toBe(false);
	});
});

describe("studio/publish-module", () => {
	it("rejects invalid modules before touching the network", async () => {
		const user = await subscriber();
		const cases: Array<[Record<string, unknown>, string]> = [
			[{ wasm: b64(new TextEncoder().encode("not wasm at all")) }, "WebAssembly"],
			[{ rkey: ".." }, "Module key"],
			[{ session: "bad key" }, "Integration"],
			[{ actions: [{ entry: "1bad", label: "Bad", fields: [] }] }, "exported function name"],
			[{ actions: [] }, "actions"],
			[{ actions: [{ entry: "note", label: "Note", fields: [{ key: "bad key" }] }] }, "Field key"],
			[{ calls: ["not-an-nsid"] }, "not an NSID"],
			[{ source: { ...moduleInput().source, language: "cobol" } }, "Language"],
			[{ source: { ...moduleInput().source, build: { tool: "make", version: "1", command: "make" } } }, "Build tool"],
			[{ source: { ...moduleInput().source, origin: { repository: "http://example.com/repo" } } }, "https"],
			[{ source: { ...moduleInput().source, origin: { repository: "https://example.com/repo", commit: "main" } } }, "hex commit"],
			[{ source: { ...moduleInput().source, files: [{ path: "../x", text: "x" }] } }, "relative"],
			[{ source: { ...moduleInput().source, files: [{ path: "/abs", text: "x" }] } }, "relative"],
			[{ source: { ...moduleInput().source, files: [{ path: "a//b", text: "x" }] } }, "relative"],
			[{ source: { ...moduleInput().source, files: [{ path: "a", text: "x" }, { path: "a", text: "y" }] } }, "twice"],
			[{ source: { ...moduleInput().source, files: [...FILES, { path: "../late", text: "x" }] } }, "relative"],
		];
		for (const [overrides, message] of cases) {
			const result = await call(host, user, "studio/publish-module", moduleInput(overrides));
			expect(result.success, message).toBe(false);
			expect(result.error?.message, message).toContain(message);
		}
		expect(host.http.requests()).toHaveLength(0);
	});

	it("publishes source files, a manifest, the blob and the module record to the session's account", async () => {
		const user = await subscriber();
		await connectStudio(user);
		const [moduleFile, abiFile] = FILES.map((file) => ({ ...file, sha: sha256(file.text), size: new TextEncoder().encode(file.text).length }));
		await host.http.respond(getRecordUrl(ALICE, COLLECTION, "statusphere"), json({ uri: `at://${ALICE.did}/${COLLECTION}/statusphere`, cid: "bafysession", value: {} }));
		await host.http.respond(getRecordUrl(ALICE, FILE_COLLECTION, moduleFile.sha), json({ error: "RecordNotFound", message: "Could not locate record" }, 400));
		await host.http.respond(getRecordUrl(ALICE, FILE_COLLECTION, abiFile.sha), json({ uri: `at://${ALICE.did}/${FILE_COLLECTION}/${abiFile.sha}`, cid: "bafyabi", value: {} }));
		await host.http.respond(`${XRPC}/com.atproto.repo.createRecord`, json({ uri: `at://${ALICE.did}/${FILE_COLLECTION}/${moduleFile.sha}`, cid: "bafymodulefile" }));
		await host.http.respond(`${XRPC}/com.atproto.repo.createRecord`, json({ uri: `at://${ALICE.did}/${MANIFEST_COLLECTION}/note.1`, cid: "bafymanifest" }));
		const blob = { $type: "blob", ref: { $link: "bafkreiblob" }, mimeType: "application/wasm", size: WASM.length };
		await host.http.respond(`${XRPC}/com.atproto.repo.uploadBlob`, json({ blob }));
		await host.http.respond(`${XRPC}/com.atproto.repo.putRecord`, json({ uri: `at://${ALICE.did}/${MODULE_COLLECTION}/note`, cid: "bafymodule" }));

		const before = Date.now();
		const result = await call(host, user, "studio/publish-module", moduleInput());
		expect(result.error).toBeUndefined();
		expect(result.data).toEqual({
			module: { uri: `at://${ALICE.did}/${MODULE_COLLECTION}/note`, cid: "bafymodule" },
			source: { uri: `at://${ALICE.did}/${MANIFEST_COLLECTION}/note.1`, cid: "bafymanifest" },
			files: 2,
		});
		expect(lastRequest(getRecordUrl(ALICE, COLLECTION, "statusphere"))).toBeDefined();

		const creates = requestsTo(`${XRPC}/com.atproto.repo.createRecord`).map(bodyOf);
		expect(creates).toHaveLength(2);
		expect(creates[0]).toEqual({
			repo: ALICE.did,
			collection: FILE_COLLECTION,
			rkey: moduleFile.sha,
			record: { $type: FILE_COLLECTION, sha256: moduleFile.sha, size: moduleFile.size, text: moduleFile.text, createdAt: expect.any(String) },
		});

		const manifest = creates[1];
		expect(manifest).toMatchObject({ repo: ALICE.did, collection: MANIFEST_COLLECTION });
		const [prefix, stamp] = manifest.rkey.split(".");
		expect(prefix).toBe("note");
		expect(Number(stamp)).toBeGreaterThanOrEqual(before);
		expect(manifest.record).toEqual({
			$type: MANIFEST_COLLECTION,
			name: "Note",
			description: "Write a note",
			language: "assemblyscript",
			files: [
				{ path: "module.ts", file: { uri: `at://${ALICE.did}/${FILE_COLLECTION}/${moduleFile.sha}`, cid: "bafymodulefile" } },
				{ path: "abi.ts", file: { uri: `at://${ALICE.did}/${FILE_COLLECTION}/${abiFile.sha}`, cid: "bafyabi" } },
			],
			build: { tool: "asc", version: "assemblyscript 0.28.20", command: "npx asc module.ts", artifact: "module.wasm" },
			output: { sha256: sha256(WASM), size: WASM.length },
			origin: { repository: "https://github.com/example/notes", commit: "0123abcd" },
			createdAt: expect.any(String),
		});

		const upload = lastRequest(`${XRPC}/com.atproto.repo.uploadBlob`);
		expect(upload?.headers["content-type"]).toBe("application/wasm");
		expect(upload?.headers.authorization).toBe("DPoP studio-token");
		expect([...(upload?.body ?? [])]).toEqual([...WASM]);

		const put = bodyOf(lastRequest(`${XRPC}/com.atproto.repo.putRecord`));
		expect(put).toMatchObject({ repo: ALICE.did, collection: MODULE_COLLECTION, rkey: "note" });
		expect(put.record).toEqual({
			$type: MODULE_COLLECTION,
			name: "Note",
			description: "Write a note",
			module: blob,
			abi: "emdash-wasm-json-v1",
			session: { uri: `at://${ALICE.did}/${COLLECTION}/statusphere`, cid: "bafysession" },
			source: { uri: `at://${ALICE.did}/${MANIFEST_COLLECTION}/note.1`, cid: "bafymanifest" },
			actions: [{ entry: "note", label: "Write note", fields: [{ key: "text", label: "Text" }, { key: "mood", label: "mood" }] }],
			calls: ["com.atproto.repo.createRecord"],
			createdAt: expect.any(String),
		});
		expect(host.http.requests().some((request) => request.url.startsWith(OPERATOR.pds) && /createRecord|putRecord|uploadBlob/.test(request.url))).toBe(false);
	});

	it("leaves out an origin the request does not send", async () => {
		const user = await subscriber();
		await connectStudio(user);
		const [moduleFile, abiFile] = FILES.map((file) => sha256(file.text));
		await host.http.respond(getRecordUrl(ALICE, COLLECTION, "statusphere"), json({ uri: `at://${ALICE.did}/${COLLECTION}/statusphere`, cid: "bafysession" }));
		for (const sha of [moduleFile, abiFile]) {
			await host.http.respond(getRecordUrl(ALICE, FILE_COLLECTION, sha), json({ uri: `at://${ALICE.did}/${FILE_COLLECTION}/${sha}`, cid: `bafy${sha.slice(0, 6)}` }));
		}
		await host.http.respond(`${XRPC}/com.atproto.repo.createRecord`, json({ uri: `at://${ALICE.did}/${MANIFEST_COLLECTION}/note.1`, cid: "bafymanifest" }));
		await host.http.respond(`${XRPC}/com.atproto.repo.uploadBlob`, json({ blob: { $type: "blob", ref: { $link: "bafkreiblob" }, mimeType: "application/wasm", size: WASM.length } }));
		await host.http.respond(`${XRPC}/com.atproto.repo.putRecord`, json({ uri: `at://${ALICE.did}/${MODULE_COLLECTION}/note`, cid: "bafymodule" }));
		const { origin: _origin, ...source } = moduleInput().source;
		const result = await call(host, user, "studio/publish-module", moduleInput({ source }));
		expect(result.error).toBeUndefined();
		const creates = requestsTo(`${XRPC}/com.atproto.repo.createRecord`).map(bodyOf);
		expect(creates).toHaveLength(1);
		expect(creates[0].record).not.toHaveProperty("origin");
	});
});
