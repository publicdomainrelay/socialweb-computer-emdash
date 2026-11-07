import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import statusphereWasm from "../../../wasm/statusphere/statusphere.wasm?inline";
import module from "../../../records/wasm/statusphere.json";
import { MODULE_COLLECTION } from "../src/modules";
import { RUN_NSID, siteDid } from "../src/service-auth";
import { ALICE, call, connect, json, queueIdentity, SITE_URL, useEncryptionKey } from "./network";

const wasmBytes = Uint8Array.from(atob(statusphereWasm.split(",")[1] ?? ""), (char) => char.charCodeAt(0));
const blobCid = module.module.ref.$link;
const STATUS = "xyz.statusphere.status";
const MODULE_URI = `at://${ALICE.did}/${MODULE_COLLECTION}/statusphere`;
const aliceModule = {
	...module,
	session: { ...module.session, uri: `at://${ALICE.did}/com.publicdomainrelay.temp.oauth.clientMetadata/statusphere` },
};

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const base58 = (bytes: Uint8Array) => {
	let value = BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
	let out = "";
	while (value > 0n) {
		out = BASE58[Number(value % 58n)] + out;
		value /= 58n;
	}
	for (const byte of bytes) {
		if (byte !== 0) break;
		out = `1${out}`;
	}
	return out;
};
const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

const secretKey = secp256k1.utils.randomSecretKey();
const multikey = `z${base58(Uint8Array.from([0xe7, 0x01, ...secp256k1.getPublicKey(secretKey, true)]))}`;

function serviceToken(claims: Record<string, unknown> = {}, key = secretKey) {
	const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "ES256K", typ: "JWT" })));
	const payload = b64url(
		new TextEncoder().encode(
			JSON.stringify({
				iss: ALICE.did,
				aud: siteDid(SITE_URL),
				lxm: RUN_NSID,
				exp: Math.floor(Date.now() / 1000) + 60,
				jti: crypto.randomUUID(),
				...claims,
			}),
		),
	);
	const signature = secp256k1.sign(new TextEncoder().encode(`${header}.${payload}`), key);
	return `${header}.${payload}.${b64url(signature)}`;
}

let host: PluginRuntimeTestHost;

beforeEach(async () => {
	useEncryptionKey();
	host = await createPluginRuntimeTestHost({ site: { url: SITE_URL } });
});

afterEach(() => host.dispose());

async function queueSigningIdentity() {
	await host.http.respond(
		`https://plc.directory/${ALICE.did}`,
		json({
			id: ALICE.did,
			alsoKnownAs: [`at://${ALICE.handle}`],
			verificationMethod: [{ id: `${ALICE.did}#atproto`, type: "Multikey", controller: ALICE.did, publicKeyMultibase: multikey }],
			service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: ALICE.pds }],
		}),
	);
}

async function queueModule(bytes: Uint8Array, value: unknown = aliceModule) {
	await queueIdentity(host);
	await host.http.respond(
		`${ALICE.pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(ALICE.did)}&collection=${MODULE_COLLECTION}&rkey=statusphere`,
		json({ uri: MODULE_URI, cid: "bafy", value }),
	);
	await host.http.respond(
		`${ALICE.pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(ALICE.did)}&cid=${blobCid}`,
		new Response(new Uint8Array(bytes), { headers: { "content-type": "application/wasm" } }),
	);
}

async function queueStatusCalls(latest: string) {
	await host.http.respond(
		`${ALICE.pds}/xrpc/com.atproto.repo.listRecords?${new URLSearchParams({ collection: STATUS, limit: "1", repo: ALICE.did })}`,
		json({ records: [{ uri: `at://${ALICE.did}/${STATUS}/3old`, cid: "bafyold", value: { $type: STATUS, status: latest } }] }),
	);
	await host.http.respond(`${ALICE.pds}/xrpc/com.atproto.repo.createRecord`, json({ uri: `at://${ALICE.did}/${STATUS}/3new`, cid: "bafyrecord" }));
}

async function serviceRun(token: string | undefined, body: Record<string, unknown> = {}) {
	const response = await host.actions.routes.request("service/run", {
		method: "POST",
		headers: { "X-EmDash-Request": "1" },
		body: { token, module: MODULE_URI, entry: "set_status", input: { status: "🦋" }, ...body },
	});
	return ((await response.json()) as { data: any }).data;
}

describe("run", () => {
	it("runs the Statusphere module over three rounds with the user's session", async () => {
		const user = await host.fixtures.user({ email: "a@example.com", role: "subscriber" });
		await connect(host, user, "statusphere", []);
		await queueModule(wasmBytes);
		await queueStatusCalls("🙂");
		const ran = await call(host, user, "run", { did: ALICE.did, rkey: "statusphere", entry: "set_status", input: { status: "🦋" } });
		expect(ran.error).toBeUndefined();
		expect(ran.data.rounds.map((round: { entry: string }) => round.entry)).toEqual(["set_status", "set_status_write", "set_status_done"]);
		expect(ran.data.result).toEqual({ status: "🦋", unchanged: false, uri: `at://${ALICE.did}/${STATUS}/3new` });
		const create = host.http.requests().find((item) => item.url.endsWith("com.atproto.repo.createRecord"));
		expect(create?.headers.authorization).toBe("DPoP access-token");
		expect(JSON.parse(new TextDecoder().decode(create?.body))).toMatchObject({
			repo: ALICE.did,
			collection: STATUS,
			record: { $type: STATUS, status: "🦋", createdAt: expect.stringMatching(/Z$/) },
		});
	});

	it("skips the write when the latest status already matches", async () => {
		const user = await host.fixtures.user({ email: "a@example.com", role: "subscriber" });
		await connect(host, user, "statusphere", []);
		await queueModule(wasmBytes);
		await queueStatusCalls("🦋");
		const ran = await call(host, user, "run", { did: ALICE.did, rkey: "statusphere", entry: "set_status", input: { status: "🦋" } });
		expect(ran.data.result).toEqual({ status: "🦋", unchanged: true, uri: `at://${ALICE.did}/${STATUS}/3old` });
		expect(host.http.requests().some((item) => item.url.endsWith("com.atproto.repo.createRecord"))).toBe(false);
	});

	it("refuses calls the module record does not allow", async () => {
		const user = await host.fixtures.user({ email: "a@example.com", role: "subscriber" });
		await connect(host, user, "statusphere", []);
		await queueModule(wasmBytes, { ...aliceModule, calls: ["com.atproto.repo.createRecord"] });
		const ran = await call(host, user, "run", { did: ALICE.did, rkey: "statusphere", entry: "set_status", input: { status: "🦋" } });
		expect(ran.success).toBe(false);
		expect(ran.error?.message).toContain("does not allow com.atproto.repo.listRecords");
	});

	it("refuses module bytes that do not match the blob CID", async () => {
		const user = await host.fixtures.user({ email: "a@example.com", role: "subscriber" });
		await connect(host, user, "statusphere", []);
		const tampered = wasmBytes.slice();
		tampered[tampered.length - 1] ^= 0xff;
		await queueModule(tampered);
		const ran = await call(host, user, "run", { did: ALICE.did, rkey: "statusphere", entry: "set_status", input: { status: "🦋" } });
		expect(ran.success).toBe(false);
		expect(ran.error?.message).toContain("WASM_DIGEST_MISMATCH");
	});
});

describe("service/run", () => {
	it("runs a module for the user named by a service auth token", async () => {
		const user = await host.fixtures.user({ email: "a@example.com", role: "subscriber" });
		await connect(host, user, "statusphere", []);
		await queueSigningIdentity();
		await queueModule(wasmBytes);
		await queueStatusCalls("🙂");
		const ran = await serviceRun(serviceToken());
		expect(ran.error).toBeUndefined();
		expect(ran.did).toBe(ALICE.did);
		expect(ran.result.uri).toBe(`at://${ALICE.did}/${STATUS}/3new`);
	});

	it("rejects a replayed token", async () => {
		const user = await host.fixtures.user({ email: "a@example.com", role: "subscriber" });
		await connect(host, user, "statusphere", []);
		const token = serviceToken();
		await queueSigningIdentity();
		await queueModule(wasmBytes);
		await queueStatusCalls("🦋");
		expect((await serviceRun(token)).error).toBeUndefined();
		await queueSigningIdentity();
		expect(await serviceRun(token)).toEqual({ error: "AuthenticationRequired", message: "Service auth token was already used" });
	});

	it.each([
		["no token", undefined, "Service auth token required"],
		["another audience", () => serviceToken({ aud: "did:web:elsewhere.example" }), "Service auth token is for another service"],
		["another method", () => serviceToken({ lxm: "com.atproto.repo.createRecord" }), `Service auth token is not scoped to ${RUN_NSID}`],
		["an expired token", () => serviceToken({ exp: Math.floor(Date.now() / 1000) - 120 }), "Service auth token expired"],
		["another key", () => serviceToken({}, secp256k1.utils.randomSecretKey()), "Service auth signature is invalid"],
	])("rejects %s", async (_name, token, message) => {
		await queueSigningIdentity();
		expect(await serviceRun(typeof token === "function" ? token() : token)).toEqual({ error: "AuthenticationRequired", message });
	});

	it("requires a connected session for the token's account", async () => {
		await queueSigningIdentity();
		await queueModule(wasmBytes);
		expect(await serviceRun(serviceToken())).toEqual({ error: "InvalidRequest", message: "Connect the integration this module uses first" });
	});

	it("publishes a did:web document naming the integrations service", async () => {
		const response = await host.actions.routes.request("service/did", { method: "GET" });
		expect(((await response.json()) as { data: unknown }).data).toEqual({
			"@context": ["https://www.w3.org/ns/did/v1"],
			id: "did:web:site.example",
			service: [{ id: "#emdash_integrations", type: "EmDashAtprotoIntegrations", serviceEndpoint: SITE_URL }],
		});
	});
});
