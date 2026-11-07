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
	recordUri,
	SITE_URL,
	STUDIO_RECORD,
	useEncryptionKey,
} from "./network";

const STUDIO_URI = recordUri(OPERATOR, "studio");

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

	it("offers no site integrations until an admin lists some", async () => {
		const status = await call(host, await subscriber(), "studio/status", {});
		expect(status.success).toBe(false);
		expect(status.error?.message).toContain("no studio integration");
	});

	it("lets only admins set the list, and keeps only clientMetadata record URIs", async () => {
		const denied = await call(host, await subscriber(), "admin/site-integrations", { integrations: [STUDIO_URI] });
		expect(denied.success).toBe(false);
		const admin = await host.fixtures.user({ email: "admin@example.com", role: "admin" });
		const saved = await call(host, admin, "admin/site-integrations", {
			integrations: ["junk", `at://${OPERATOR.did}/${MODULE_COLLECTION}/x`, STUDIO_URI],
		});
		expect(saved.data).toEqual({ integrations: [STUDIO_URI] });
		expect(await host.inspect.setting("siteIntegrations")).toBe(STUDIO_URI);
		expect((await call(host, admin, "admin/site-integrations", {})).data).toEqual({ integrations: [STUDIO_URI] });
	});
});
