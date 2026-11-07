import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	call,
	COLLECTION,
	didDocument,
	json,
	MODULE_COLLECTION,
	OPERATOR,
	queueIdentity,
	queueSite,
	ROUTE_ORIGIN,
	recordUri,
	SITE_URL,
	STUDIO_RECORD,
	useEncryptionKey,
} from "./network";

const STUDIO_URI = recordUri(OPERATOR, "studio");
const SITE_JSON = `${ROUTE_ORIGIN}/integrations/site.json`;

let host: PluginRuntimeTestHost;

beforeEach(async () => {
	useEncryptionKey();
	host = await createPluginRuntimeTestHost({ site: { url: SITE_URL } });
});

afterEach(() => host.dispose());

const subscriber = () => host.fixtures.user({ email: "a@example.com", role: "subscriber" });

async function queueStudioRecord(times = 1) {
	for (let index = 0; index < times; index++) {
		await queueIdentity(host, didDocument([], OPERATOR), 1, OPERATOR);
		await host.http.respond(
			`${OPERATOR.pds}/xrpc/com.atproto.repo.getRecord?${new URLSearchParams({ repo: OPERATOR.did, collection: COLLECTION, rkey: "studio" })}`,
			json({ uri: STUDIO_URI, cid: "bafystudio", value: STUDIO_RECORD }),
		);
	}
}

describe("site integrations", () => {
	it("reads the studio from the site's list and ignores entries that are not clientMetadata records", async () => {
		await queueSite(host, {
			integrations: [
				42,
				"junk",
				"at://not-a-did/x/y",
				`at://${OPERATOR.did}/${MODULE_COLLECTION}/studio`,
				`at://${OPERATOR.did}/${COLLECTION}/other`,
				STUDIO_URI,
			],
		});
		await queueStudioRecord();
		const status = await call(host, await subscriber(), "studio/status", {});
		expect(status.error).toBeUndefined();
		expect(status.data).toMatchObject({ uri: STUDIO_URI, name: "Studio", connected: false });
	});

	it("does not treat a record from another collection as the studio", async () => {
		await queueSite(host, { integrations: [`at://${OPERATOR.did}/${MODULE_COLLECTION}/studio`] });
		const status = await call(host, await subscriber(), "studio/status", {});
		expect(status.success).toBe(false);
		expect(status.error?.message).toContain("no studio integration");
	});

	it.each([
		["the list cannot be fetched", undefined],
		["the list answers with an error", new Response("nope", { status: 500 })],
		["the list is not JSON", new Response("<html>", { status: 200 })],
		["the list has no integrations array", json({ integrations: STUDIO_URI })],
	])("offers no site integrations when %s", async (_name, response) => {
		if (response) await host.http.respond(SITE_JSON, response);
		const status = await call(host, await subscriber(), "studio/status", {});
		expect(status.success).toBe(false);
		expect(status.error?.message).toContain("no studio integration");
	});

	it("fetches the list once and reuses it while it is fresh", async () => {
		await queueSite(host, { integrations: [STUDIO_URI] });
		await queueStudioRecord(2);
		const user = await subscriber();
		expect((await call(host, user, "studio/status", {})).success).toBe(true);
		expect((await call(host, user, "studio/status", {})).success).toBe(true);
		expect(host.http.requests().filter((request) => request.url === SITE_JSON)).toHaveLength(1);
	});
});
