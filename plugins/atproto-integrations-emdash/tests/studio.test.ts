import { createHash } from "node:crypto";
import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STUDIO_SCOPE } from "../src/studio";
import {
	ALICE,
	call,
	COLLECTION,
	didDocument,
	ISSUER,
	json,
	MODULE_COLLECTION,
	queueAuthorizationServer,
	queueIdentity,
	RECORDS,
	SITE_URL,
	useEncryptionKey,
} from "./network";

const FILE_COLLECTION = "com.fedfork.exec.source.file";
const MANIFEST_COLLECTION = "com.fedfork.exec.source.manifest";
const XRPC = `${ALICE.pds}/xrpc`;
const WASM = Uint8Array.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0xff, 0x80, 0xc3, 0x28, 0x00, 0xfe]);
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const getRecordUrl = (collection: string, rkey: string) =>
	`${XRPC}/com.atproto.repo.getRecord?${new URLSearchParams({ repo: ALICE.did, collection, rkey })}`;

let host: PluginRuntimeTestHost;

beforeEach(async () => {
	useEncryptionKey();
	host = await createPluginRuntimeTestHost({ site: { url: SITE_URL } });
});

afterEach(() => host.dispose());

const subscriber = () => host.fixtures.user({ email: "a@example.com", role: "subscriber" });
type User = Awaited<ReturnType<typeof subscriber>>;

const lastRequest = (url: string) => host.http.requests().findLast((request) => request.url === url);
const requestsTo = (url: string) => host.http.requests().filter((request) => request.url === url);
const bodyOf = (request: { body: Uint8Array } | undefined) => JSON.parse(new TextDecoder().decode(request?.body));

async function connectStudio(user: User) {
	await queueIdentity(host, didDocument(), 2);
	await queueAuthorizationServer(host);
	await host.http.respond(`${ISSUER}/oauth/par`, json({ error: "use_dpop_nonce" }, 400));
	await host.http.respond(`${ISSUER}/oauth/par`, json({ request_uri: "urn:ietf:params:oauth:request_uri:test", expires_in: 299 }, 201));
	const started = await call(host, user, "studio/connect", { did: ALICE.did });
	const par = new URLSearchParams(new TextDecoder().decode(lastRequest(`${ISSUER}/oauth/par`)?.body));
	await host.http.respond(
		`${ISSUER}/oauth/token`,
		json({ access_token: "studio-token", refresh_token: "studio-refresh", token_type: "DPoP", expires_in: 3600, scope: par.get("scope"), sub: ALICE.did }),
	);
	await queueIdentity(host, didDocument(), 2);
	await queueAuthorizationServer(host);
	await queueAuthorizationServer(host);
	const query = new URLSearchParams({ code: "code", state: par.get("state") ?? "", iss: ISSUER });
	const callback = await host.actions.routes.request("oauth/callback", {
		method: "GET",
		url: `${SITE_URL}/_emdash/api/plugins/atproto-integrations/oauth/callback?${query}`,
	});
	return { started, par, callback };
}

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
	{ path: "abi.ts", text: "export const é = \"✓\";\n" },
];

const moduleInput = (overrides: Record<string, unknown> = {}) => ({
	did: ALICE.did,
	rkey: "note",
	session: "statusphere",
	name: "Note",
	description: "Write a note",
	wasm: b64(WASM),
	source: {
		language: "assemblyscript",
		files: FILES,
		build: { tool: "asc", version: "assemblyscript 0.28.20", command: "npx asc module.ts", artifact: "module.wasm" },
	},
	actions: [{ entry: "note", label: "Write note", fields: [{ key: "text", label: "Text" }, { key: "mood" }] }],
	calls: ["com.atproto.repo.createRecord"],
	...overrides,
});

describe("studio session", () => {
	it("reports the scope it would request before connecting", async () => {
		const status = await call(host, await subscriber(), "studio/status", { did: ALICE.did });
		expect(status.data).toEqual({ connected: false, requested: STUDIO_SCOPE });
		expect(STUDIO_SCOPE.split(" ")).toEqual([
			"atproto",
			`repo:${COLLECTION}`,
			`repo:${MODULE_COLLECTION}`,
			`repo:${FILE_COLLECTION}`,
			`repo:${MANIFEST_COLLECTION}`,
			"blob:application/wasm",
		]);
	});

	it("authorizes the user's own account with exactly the studio scope and returns to /studio", async () => {
		const user = await subscriber();
		const { started, par, callback } = await connectStudio(user);
		expect(started.data.url).toContain(`${ISSUER}/oauth/authorize?`);
		expect(par.get("scope")).toBe(STUDIO_SCOPE);
		expect(par.get("login_hint")).toBe(ALICE.handle);
		expect(par.get("client_id")).toBe(`${SITE_URL}/integrations/${ALICE.did}/_studio/oauth-client-metadata.json`);
		expect(callback.headers.get("location")).toBe("/studio?connected=studio");
		const status = await call(host, user, "studio/status", { did: ALICE.did });
		expect(status.data).toMatchObject({ connected: true, requested: STUDIO_SCOPE, scope: STUDIO_SCOPE });
	});

	it("keeps the studio out of the integration routes", async () => {
		const user = await subscriber();
		const refused = await call(host, user, "connect", { did: ALICE.did, rkey: "_studio", groups: [] });
		expect(refused.success).toBe(false);
		expect(refused.error?.message).toContain("/studio");

		await queueIdentity(host);
		await host.http.respond(
			`${XRPC}/com.atproto.repo.listRecords?repo=${encodeURIComponent(ALICE.did)}&collection=${COLLECTION}&limit=100`,
			json({
				records: [
					{ uri: `at://${ALICE.did}/${COLLECTION}/statusphere`, cid: "bafy", value: RECORDS.statusphere },
					{ uri: `at://${ALICE.did}/${COLLECTION}/_studio`, cid: "bafy", value: RECORDS.statusphere },
				],
			}),
		);
		await host.http.respond(
			`${XRPC}/com.atproto.repo.listRecords?repo=${encodeURIComponent(ALICE.did)}&collection=${MODULE_COLLECTION}&limit=100`,
			json({ records: [] }),
		);
		const listed = await call(host, user, "integrations", { did: ALICE.did });
		expect(listed.data.integrations.map((item: { rkey: string }) => item.rkey)).toEqual(["statusphere"]);
	});

	it("refuses to run a module with the studio session", async () => {
		const user = await subscriber();
		await queueIdentity(host);
		await host.http.respond(
			getRecordUrl(MODULE_COLLECTION, "sneaky"),
			json({
				uri: `at://${ALICE.did}/${MODULE_COLLECTION}/sneaky`,
				cid: "bafy",
				value: {
					$type: MODULE_COLLECTION,
					name: "Sneaky",
					module: { $type: "blob", ref: { $link: "bafkreictmtxavczjvlhbbe3okiw3ygtjuy2ajnj26izqpnstom4dxfb3ry" }, mimeType: "application/wasm", size: 1 },
					abi: "emdash-wasm-json-v1",
					session: { uri: `at://${ALICE.did}/${COLLECTION}/_studio`, cid: "bafy" },
					actions: [{ entry: "go", label: "Go", fields: [] }],
					createdAt: "2026-11-07T00:00:00.000Z",
				},
			}),
		);
		const ran = await call(host, user, "run", { did: ALICE.did, rkey: "sneaky", entry: "go", input: {} });
		expect(ran.success).toBe(false);
		expect(ran.error?.message).toContain("studio session");
	});
});

describe("studio/publish-integration", () => {
	it("validates the record before writing", async () => {
		const user = await subscriber();
		const cases: Array<[Record<string, unknown>, string]> = [
			[{ rkey: "notes", record: integration({ clientMetadata: { ...integration().clientMetadata, scope: "repo:com.example.note" } }) }, "atproto"],
			[{ rkey: "bad key", record: integration() }, "Record key"],
			[{ rkey: "_studio", record: integration() }, "Record key"],
			[{ rkey: "notes", record: {} }, "clientMetadata"],
		];
		for (const [input, message] of cases) {
			const result = await call(host, user, "studio/publish-integration", { did: ALICE.did, ...input });
			expect(result.success).toBe(false);
			expect(result.error?.message).toContain(message);
		}
		expect(requestsTo(`${XRPC}/com.atproto.repo.putRecord`)).toHaveLength(0);
	});

	it("requires the studio session", async () => {
		const result = await call(host, await subscriber(), "studio/publish-integration", { did: ALICE.did, rkey: "notes", record: integration() });
		expect(result.success).toBe(false);
		expect(result.error?.message).toContain("Connect the studio first");
	});

	it("writes the record to the user's PDS with the studio session", async () => {
		const user = await subscriber();
		await connectStudio(user);
		await host.http.respond(`${XRPC}/com.atproto.repo.putRecord`, json({ uri: `at://${ALICE.did}/${COLLECTION}/notes`, cid: "bafynotes" }));
		const result = await call(host, user, "studio/publish-integration", {
			did: ALICE.did,
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
	});
});

describe("studio/publish-module", () => {
	it("rejects invalid modules before touching the PDS", async () => {
		const user = await subscriber();
		const cases: Array<[Record<string, unknown>, string]> = [
			[{ wasm: b64(new TextEncoder().encode("not wasm at all")) }, "WebAssembly"],
			[{ rkey: "_studio" }, "Module key"],
			[{ session: "bad key" }, "Integration"],
			[{ actions: [{ entry: "1bad", label: "Bad", fields: [] }] }, "exported function name"],
			[{ actions: [] }, "actions"],
			[{ actions: [{ entry: "note", label: "Note", fields: [{ key: "bad key" }] }] }, "Field key"],
			[{ calls: ["not-an-nsid"] }, "not an NSID"],
			[{ source: { ...moduleInput().source, language: "cobol" } }, "Language"],
			[{ source: { ...moduleInput().source, build: { tool: "make", version: "1", command: "make" } } }, "Build tool"],
		];
		for (const [overrides, message] of cases) {
			const result = await call(host, user, "studio/publish-module", moduleInput(overrides));
			expect(result.success, message).toBe(false);
			expect(result.error?.message).toContain(message);
		}
		expect(host.http.requests().filter((request) => request.url.startsWith(XRPC))).toHaveLength(0);
	});

	it("rejects unsafe or repeated source paths", async () => {
		const user = await subscriber();
		await connectStudio(user);
		const cases: Array<[Array<{ path: string; text: string }>, string]> = [
			[[{ path: "../x", text: "x" }], "relative"],
			[[{ path: "/abs", text: "x" }], "relative"],
			[[{ path: "a//b", text: "x" }], "relative"],
			[[{ path: "a", text: "x" }, { path: "a", text: "y" }], "twice"],
		];
		for (const [files, message] of cases) {
			await host.http.respond(getRecordUrl(COLLECTION, "statusphere"), json({ uri: `at://${ALICE.did}/${COLLECTION}/statusphere`, cid: "bafysession" }));
			await host.http.respond(getRecordUrl(FILE_COLLECTION, sha256("x")), json({ uri: `at://${ALICE.did}/${FILE_COLLECTION}/${sha256("x")}`, cid: "bafyx" }));
			const result = await call(host, user, "studio/publish-module", moduleInput({ source: { ...moduleInput().source, files } }));
			expect(result.success, message).toBe(false);
			expect(result.error?.message).toContain(message);
		}
		expect(requestsTo(`${XRPC}/com.atproto.repo.createRecord`)).toHaveLength(0);
		expect(requestsTo(`${XRPC}/com.atproto.repo.uploadBlob`)).toHaveLength(0);
		expect(requestsTo(`${XRPC}/com.atproto.repo.putRecord`)).toHaveLength(0);
	});

	it("publishes source files, a manifest, the blob and the module record", async () => {
		const user = await subscriber();
		await connectStudio(user);
		const [moduleFile, abiFile] = FILES.map((file) => ({ ...file, sha: sha256(file.text), size: new TextEncoder().encode(file.text).length }));
		await host.http.respond(getRecordUrl(COLLECTION, "statusphere"), json({ uri: `at://${ALICE.did}/${COLLECTION}/statusphere`, cid: "bafysession", value: {} }));
		await host.http.respond(getRecordUrl(FILE_COLLECTION, moduleFile.sha), json({ error: "RecordNotFound", message: "Could not locate record" }, 400));
		await host.http.respond(getRecordUrl(FILE_COLLECTION, abiFile.sha), json({ uri: `at://${ALICE.did}/${FILE_COLLECTION}/${abiFile.sha}`, cid: "bafyabi", value: {} }));
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

		const creates = requestsTo(`${XRPC}/com.atproto.repo.createRecord`).map(bodyOf);
		expect(creates).toHaveLength(2);
		expect(creates[0]).toMatchObject({
			repo: ALICE.did,
			collection: FILE_COLLECTION,
			rkey: moduleFile.sha,
			record: { $type: FILE_COLLECTION, sha256: moduleFile.sha, size: moduleFile.size, text: moduleFile.text },
		});

		const manifest = creates[1];
		expect(manifest.collection).toBe(MANIFEST_COLLECTION);
		const [prefix, stamp] = manifest.rkey.split(".");
		expect(prefix).toBe("note");
		expect(Number(stamp)).toBeGreaterThanOrEqual(before);
		expect(manifest.record).toMatchObject({
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
		});

		const upload = lastRequest(`${XRPC}/com.atproto.repo.uploadBlob`);
		expect(upload?.headers["content-type"]).toBe("application/wasm");
		expect(upload?.headers.authorization).toBe("DPoP studio-token");
		expect([...(upload?.body ?? [])]).toEqual([...WASM]);

		const put = bodyOf(lastRequest(`${XRPC}/com.atproto.repo.putRecord`));
		expect(put).toMatchObject({ repo: ALICE.did, collection: MODULE_COLLECTION, rkey: "note" });
		expect(put.record).toMatchObject({
			$type: MODULE_COLLECTION,
			name: "Note",
			description: "Write a note",
			module: blob,
			abi: "emdash-wasm-json-v1",
			session: { uri: `at://${ALICE.did}/${COLLECTION}/statusphere`, cid: "bafysession" },
			source: { uri: `at://${ALICE.did}/${MANIFEST_COLLECTION}/note.1`, cid: "bafymanifest" },
			actions: [{ entry: "note", label: "Write note", fields: [{ key: "text", label: "Text" }, { key: "mood", label: "mood" }] }],
			calls: ["com.atproto.repo.createRecord"],
		});
	});
});
