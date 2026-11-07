import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import statusphereWasm from "../../../wasm/statusphere/statusphere.wasm?inline";
import module from "../../../records/wasm/statusphere.json";
import { MODULE_COLLECTION } from "../src/modules";
import { ALICE, call, connect, json, queueIdentity, SITE_URL, useEncryptionKey } from "./network";

const wasmBytes = Uint8Array.from(atob(statusphereWasm.split(",")[1] ?? ""), (char) => char.charCodeAt(0));
const blobCid = module.module.ref.$link;
const aliceModule = {
	...module,
	session: { ...module.session, uri: `at://${ALICE.did}/com.publicdomainrelay.temp.oauth.clientMetadata/statusphere` },
};

let host: PluginRuntimeTestHost;

beforeEach(async () => {
	useEncryptionKey();
	host = await createPluginRuntimeTestHost({ site: { url: SITE_URL } });
});

afterEach(() => host.dispose());

async function queueModule(bytes: Uint8Array) {
	await queueIdentity(host);
	await host.http.respond(
		`${ALICE.pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(ALICE.did)}&collection=${MODULE_COLLECTION}&rkey=statusphere`,
		json({ uri: `at://${ALICE.did}/${MODULE_COLLECTION}/statusphere`, cid: "bafy", value: aliceModule }),
	);
	await host.http.respond(
		`${ALICE.pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(ALICE.did)}&cid=${blobCid}`,
		new Response(new Uint8Array(bytes), { headers: { "content-type": "application/wasm" } }),
	);
}

describe("run", () => {
	it("runs the Statusphere module and performs its call with the user's session", async () => {
		const user = await host.fixtures.user({ email: "a@example.com", role: "subscriber" });
		await connect(host, user, "statusphere", []);
		await queueModule(wasmBytes);
		await host.http.respond(
			`${ALICE.pds}/xrpc/com.atproto.repo.createRecord`,
			json({ uri: `at://${ALICE.did}/xyz.statusphere.status/3new`, cid: "bafyrecord" }),
		);
		const ran = await call(host, user, "run", { did: ALICE.did, rkey: "statusphere", entry: "set_status", input: { status: "🦋" } });
		expect(ran.success).toBe(true);
		expect(ran.data.results[0].output.uri).toBe(`at://${ALICE.did}/xyz.statusphere.status/3new`);
		const request = host.http.requests().find((item) => item.url.endsWith("com.atproto.repo.createRecord"));
		expect(request?.headers.authorization).toBe("DPoP access-token");
		expect(JSON.parse(new TextDecoder().decode(request?.body))).toMatchObject({
			repo: ALICE.did,
			collection: "xyz.statusphere.status",
			record: { $type: "xyz.statusphere.status", status: "🦋", createdAt: expect.stringMatching(/Z$/) },
		});
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
