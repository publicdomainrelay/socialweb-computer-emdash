import { describe, expect, it } from "vitest";
import { clientMetadata } from "../src/client";
import { atprotoSubscriber } from "../src/index";
import { allowsSignup, isAllowed, matchesHandle, safeReturnTo, withError } from "../src/policy";

describe("returnTo", () => {
	it("accepts local paths only", () => {
		expect(safeReturnTo("/integrations")).toBe("/integrations");
		expect(safeReturnTo("/integrations?tab=1")).toBe("/integrations?tab=1");
		for (const value of ["//evil.com", "/\\evil.com", "/a\\b", "/a\nb", "https://evil.com", "integrations", undefined, 42]) {
			expect(safeReturnTo(value)).toBeUndefined();
		}
	});

	it("adds an error to the return path", () => {
		expect(withError("/integrations?tab=1", "Nope")).toBe("/integrations?tab=1&error=Nope");
	});
});

describe("admission", () => {
	const alice = { did: "did:plc:alice", handle: "alice.example.com" };

	it("matches exact, wildcard-domain and any-handle patterns", () => {
		expect(matchesHandle("Alice.Example.com", ["alice.example.com"])).toBe(true);
		expect(matchesHandle("alice.example.com", ["*.example.com"])).toBe(true);
		expect(matchesHandle("alice.example.org", ["*.example.com"])).toBe(false);
		expect(matchesHandle("anyone.social", ["*"])).toBe(true);
	});

	it("is closed by default and opens with allowAnyAccount or allowlists", () => {
		expect(allowsSignup({})).toBe(false);
		expect(isAllowed({}, alice)).toBe(false);
		expect(isAllowed({ allowAnyAccount: true }, alice)).toBe(true);
		expect(isAllowed({ allowedDIDs: ["did:plc:alice"] }, alice)).toBe(true);
		expect(isAllowed({ allowedHandles: ["*.example.com"] }, alice)).toBe(true);
		expect(isAllowed({ allowedHandles: ["*.example.com"] }, { did: alice.did })).toBe(false);
	});
});

describe("provider", () => {
	it("registers the Atmosphere routes and an identity-only client", () => {
		const descriptor = atprotoSubscriber({ allowAnyAccount: true });
		expect(descriptor.id).toBe("atproto");
		expect(descriptor.routes?.map((route) => route.pattern)).toContain("/.well-known/atproto-client-metadata.json");
		expect(clientMetadata("http://localhost:4321")).toMatchObject({
			client_id: "http://127.0.0.1:4321/.well-known/atproto-client-metadata.json",
			scope: "atproto",
		});
		expect(clientMetadata("https://site.example").redirect_uris).toEqual(["https://site.example/_emdash/api/auth/atproto/callback"]);
	});
});
