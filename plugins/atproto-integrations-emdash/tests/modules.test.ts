import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import module from "../../../records/wasm/statusphere.json";
import { blobSha256, MODULE_COLLECTION, parseModuleRecord } from "../src/modules";
import { ALICE, call, connect, queueListing, SITE_URL, useEncryptionKey } from "./network";

const aliceModule = {
	...module,
	session: { ...module.session, uri: `at://${ALICE.did}/com.publicdomainrelay.temp.oauth.clientMetadata/statusphere` },
};

describe("wasm module records", () => {
	it("derives the sha256 the host verifies from the blob CID", () => {
		expect(blobSha256("bafkreictmtxavczjvlhbbe3okiw3ygtjuy2ajnj26izqpnstom4dxfb3ry")).toBe(
			"5364ee0a8b29aace10936e522dbc1a69a63404b53af23307b65373383b943b8e",
		);
		expect(() => blobSha256("bafyreifqmfidjzv4qx2yxydlbpw32vdwj2xu5l532xjcvi3ghxxin6xdfy")).toThrow("raw sha2-256");
	});

	it("parses the published Statusphere module", () => {
		expect(parseModuleRecord(module)).toMatchObject({
			name: "Statusphere",
			blobCid: "bafkreictmtxavczjvlhbbe3okiw3ygtjuy2ajnj26izqpnstom4dxfb3ry",
			session: { did: "did:plc:lpfuqerea3deuoyrn7ojser4", rkey: "statusphere" },
			actions: [{ entry: "set_status", label: "Set status", fields: [{ key: "status", label: "Emoji" }] }],
		});
		expect(() => parseModuleRecord({ ...module, abi: "other" })).toThrow("Unsupported module ABI");
	});
});

describe("module listing", () => {
	let host: PluginRuntimeTestHost;

	beforeEach(async () => {
		useEncryptionKey();
		host = await createPluginRuntimeTestHost({ site: { url: SITE_URL } });
	});

	afterEach(() => host.dispose());

	it("attaches modules to the integration whose session they use", async () => {
		const user = await host.fixtures.user({ email: "a@example.com", role: "subscriber" });
		await connect(host, user, "statusphere", []);
		await queueListing(host, [{ uri: `at://${ALICE.did}/${MODULE_COLLECTION}/statusphere`, cid: "bafy", value: aliceModule }]);
		const listed = await call(host, user, "integrations", { did: ALICE.did });
		const statusphere = listed.data.integrations.find((item: { rkey: string }) => item.rkey === "statusphere");
		expect(statusphere.modules).toEqual([
			expect.objectContaining({ rkey: "statusphere", name: "Statusphere", actions: aliceModule.actions.map((action) => expect.objectContaining(action)) }),
		]);
		const socialweb = listed.data.integrations.find((item: { rkey: string }) => item.rkey === "socialweb-computer");
		expect(socialweb.modules).toEqual([]);
	});
});
