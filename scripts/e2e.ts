import { readFile } from "node:fs/promises";
import type { IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { compile } from "../site/src/studio/compile.ts";

const env = (name: string, fallback?: string) => {
	const value = process.env[name] ?? fallback;
	if (!value) throw new Error(`Set ${name}`);
	return value;
};

const SITE = env("SITE_URL", "http://127.0.0.1:4321");
const HANDLE = env("ATPROTO_HANDLE");
const PASSWORD = env("ATPROTO_PASSWORD");
const BROWSER = "Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/140.0";

class Jar {
	readonly cookies = new Map<string, string>();
	take(setCookies: string[] | undefined) {
		for (const cookie of setCookies ?? []) {
			const pair = cookie.split(";")[0];
			const split = pair.indexOf("=");
			this.cookies.set(pair.slice(0, split), pair.slice(split + 1));
		}
	}
	get header() {
		return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
	}
}

interface Raw {
	status: number;
	headers: IncomingHttpHeaders;
	body: string;
}

function browser(url: string, method: string, headers: Record<string, string>, body?: string) {
	return new Promise<Raw>((resolve, reject) => {
		const req = httpsRequest(url, { method, headers: { "user-agent": BROWSER, ...headers } }, (res) => {
			let data = "";
			res.setEncoding("utf8");
			res.on("data", (chunk) => (data += chunk));
			res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data }));
		});
		req.on("error", reject);
		req.end(body);
	});
}

async function approve(url: string) {
	const issuer = new URL(url).origin;
	const jar = new Jar();
	const page = await browser(url, "GET", {
		accept: "text/html",
		"sec-fetch-site": "cross-site",
		"sec-fetch-mode": "navigate",
		"sec-fetch-dest": "document",
	});
	jar.take(page.headers["set-cookie"]);
	const data = /window\["__authorizeData"\]=JSON\.parse\("(.*?)"\);/.exec(page.body)?.[1];
	if (!data) throw new Error(`Authorize page failed: ${page.status} ${/__errorData"\]=JSON.parse\("(.*?)"\)/.exec(page.body)?.[1]}`);
	const authorize = JSON.parse(JSON.parse(`"${data}"`));
	const api = async (path: string, input: unknown, bearer?: string) => {
		const response = await browser(
			`${issuer}/@atproto/oauth-provider/~api${path}`,
			"POST",
			{
				"content-type": "application/json",
				origin: issuer,
				referer: url,
				cookie: jar.header,
				"x-csrf-token": jar.cookies.get("csrf-token") ?? "",
				"sec-fetch-site": "same-origin",
				"sec-fetch-mode": "same-origin",
				"sec-fetch-dest": "empty",
				...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
			},
			JSON.stringify(input),
		);
		jar.take(response.headers["set-cookie"]);
		if (response.status >= 400) throw new Error(`${path} failed: ${response.body}`);
		return JSON.parse(response.body);
	};
	const signIn = await api("/sign-in", { username: HANDLE, password: PASSWORD, remember: false, locale: "en" });
	const consent = await api("/consent", { did: signIn.account.did, scope: authorize.scope }, signIn.ephemeralToken);
	const params = new URL(consent.url).searchParams;
	const kept = [...params].filter(([name]) => ["code", "state", "iss", "error", "error_description"].includes(name));
	return { scope: authorize.scope as string, callback: `${params.get("redirect_uri")}?${new URLSearchParams(kept)}` };
}

const site = new Jar();

async function siteFetch(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
	const response = await fetch(new URL(path, SITE), {
		method: init.method ?? "GET",
		redirect: "manual",
		headers: {
			cookie: site.header,
			origin: SITE,
			...(init.body === undefined ? {} : { "content-type": "application/json" }),
			...init.headers,
		},
		body: init.body === undefined ? undefined : JSON.stringify(init.body),
	});
	site.take(response.headers.getSetCookie());
	return response;
}

const pathOf = (url: string) => {
	const parsed = new URL(url);
	return `${parsed.pathname}${parsed.search}`;
};

async function plugin<T>(route: string, body: unknown): Promise<T> {
	const response = await siteFetch(`/_emdash/api/plugins/atproto-integrations/${route}`, {
		method: "POST",
		body,
		headers: { "x-emdash-request": "1" },
	});
	const payload = (await response.json()) as { success: boolean; data: T; error?: { message: string } };
	if (!payload.success) throw new Error(`${route}: ${payload.error?.message}`);
	return payload.data;
}

const log = (step: string, detail: object) => console.log(JSON.stringify({ step, ...detail }));

type Listing = {
	integrations: Array<{ rkey: string; groups: Array<{ key: string; granted: boolean }>; session: { handle?: string; scope: string } | null }>;
};

const login = await siteFetch("/_emdash/api/auth/atproto/login?returnTo=/integrations", { method: "POST", body: { handle: HANDLE } });
const { data: loginData } = (await login.json()) as { data: { url: string } };
const signedIn = await approve(loginData.url);
const landed = await siteFetch(pathOf(signedIn.callback));
log("site login", { scope: signedIn.scope, status: landed.status, location: landed.headers.get("location") });

const page = await (await siteFetch("/integrations")).text();
const did = /data-did="([^"]+)"/.exec(page)?.[1];
log("integrations page", { did, cards: [...page.matchAll(/class="integration__name"[^>]*>([^<]+)</g)].map((match) => match[1]) });
if (!did) throw new Error("Integrations page did not list any integrations");

async function connect(rkey: string, groups: string[]) {
	const { url } = await plugin<{ url: string }>("connect", { did, rkey, groups });
	const approved = await approve(url);
	const callback = await siteFetch(pathOf(approved.callback));
	log(`connect ${rkey}`, { requested: approved.scope, location: callback.headers.get("location") });
}

await connect("statusphere", []);
log("verify statusphere", await plugin<object>("verify", { did, rkey: "statusphere" }));
type Ran = { did?: string; module: string; entry: string; rounds: Array<{ entry: string; calls: Array<{ nsid: string; ok: boolean }> }>; result: any };
const RUN_NSID = "com.fedfork.exec.wasm.run";
const MODULE_URI = `at://${did}/com.fedfork.exec.wasm.module/statusphere`;
const SITE_DID = `did:web:${new URL(SITE).host.replace(":", "%3A")}`;
const summary = (ran: Ran) => ({
	did: ran.did,
	rounds: ran.rounds.map((round) => `${round.entry}(${round.calls.map((call) => `${call.nsid}${call.ok ? "" : " failed"}`).join(", ")})`),
	result: ran.result,
});

const pds = (await (await fetch(`https://plc.directory/${did}`)).json()).service.find((service: { id: string }) => service.id === "#atproto_pds").serviceEndpoint;
const statuses = async () =>
	(await (await fetch(`${pds}/xrpc/com.atproto.repo.listRecords?${new URLSearchParams({ repo: did, collection: "xyz.statusphere.status", limit: "10" })}`)).json()).records.map(
		(record: { uri: string; value: { status: string } }) => ({ uri: record.uri, status: record.value.status }),
	);

const first = await plugin<Ran>("run", { did, rkey: "statusphere", entry: "set_status", input: { status: "🦋" } });
log("run set_status with site session", { ...summary(first), latest: (await statuses())[0] });
log("run set_status again", summary(await plugin<Ran>("run", { did, rkey: "statusphere", entry: "set_status", input: { status: "🦋" } })));

const parallel = await Promise.all(
	["🌊", "🔥", "🌙"].map((status) => plugin<Ran>("run", { did, rkey: "statusphere", entry: "set_status", input: { status } })),
);
log("run set_status three times in parallel", { results: parallel.map((ran) => ran.result.status), stored: (await statuses()).length });

const passwordSession = await (await fetch(`${pds}/xrpc/com.atproto.server.createSession`, {
	method: "POST",
	headers: { "content-type": "application/json" },
	body: JSON.stringify({ identifier: HANDLE, password: PASSWORD }),
})).json();
const bearer = { authorization: `Bearer ${passwordSession.accessJwt}` };
const serviceAuth = await (
	await fetch(`${pds}/xrpc/com.atproto.server.getServiceAuth?${new URLSearchParams({ aud: SITE_DID, lxm: RUN_NSID, exp: String(Math.floor(Date.now() / 1000) + 60) })}`, { headers: bearer })
).json();
const [, claims] = String(serviceAuth.token).split(".");
const { iss, aud, lxm, exp } = JSON.parse(Buffer.from(claims ?? "", "base64url").toString());
log("getServiceAuth from PDS", { iss, aud, lxm, expiresIn: exp - Math.floor(Date.now() / 1000) });

const direct = (token: string, input: object) =>
	fetch(`${SITE}/xrpc/${RUN_NSID}`, {
		method: "POST",
		headers: { "content-type": "application/json", "user-agent": BROWSER, authorization: `Bearer ${token}` },
		body: JSON.stringify({ module: MODULE_URI, entry: "set_status", input }),
	});
const directRun = await direct(serviceAuth.token, { status: "🌱" });
log("run with service auth token", { status: directRun.status, ...summary((await directRun.json()) as Ran), latest: (await statuses())[0] });
const replay = await direct(serviceAuth.token, { status: "🌱" });
log("replay the same token", { status: replay.status, body: await replay.json() });

const proxied = await fetch(`${pds}/xrpc/${RUN_NSID}`, {
	method: "POST",
	headers: { ...bearer, "content-type": "application/json", "atproto-proxy": `${SITE_DID}#emdash_integrations` },
	body: JSON.stringify({ module: MODULE_URI, entry: "clear_status", input: {} }),
});
const proxiedBody = await proxied.json();
log("run clear_status through PDS proxy", { status: proxied.status, ...(proxied.ok ? summary(proxiedBody as Ran) : proxiedBody), remaining: (await statuses()).length });
await connect("vibescrobble", ["scrobble"]);
const scrobbled = await plugin<Ran>("run", { did, rkey: "vibescrobble", entry: "scrobble", input: { text: "🧪 e2e scrobble through EmDash WebAssembly", task: "#socialweb-computer-emdash" } });
const scrobbleRkey = String(scrobbled.result.uri).split("/").pop() ?? "";
const scrobble = await (await fetch(`${pds}/xrpc/com.atproto.repo.getRecord?${new URLSearchParams({ repo: did, collection: "com.vibescrobble.scrobble", rkey: scrobbleRkey })}`)).json();
log("run scrobble", { ...summary(scrobbled), stored: scrobble.value });
const removed = await fetch(`${pds}/xrpc/com.atproto.repo.deleteRecord`, {
	method: "POST",
	headers: { ...bearer, "content-type": "application/json" },
	body: JSON.stringify({ repo: did, collection: "com.vibescrobble.scrobble", rkey: scrobbleRkey }),
});
log("delete test scrobble", { status: removed.status });
await connect("socialweb-computer", ["associate"]);
await connect("socialweb-computer", ["associate", "policy", "atirc"]);
const listing = await plugin<Listing>("integrations", { did });
log("granted", {
	integrations: listing.integrations.map((item) => ({
		rkey: item.rkey,
		connected: Boolean(item.session),
		granted: item.groups.filter((group) => group.granted).map((group) => group.key),
	})),
});
log("verify socialweb-computer", await plugin<object>("verify", { did, rkey: "socialweb-computer" }));

type StrongRef = { uri: string; cid: string };
const STUDIO_KEY = "e2e-note";
const NOTE_COLLECTION = "com.example.note";
const pdsDelete = (collection: string, rkey: string) =>
	fetch(`${pds}/xrpc/com.atproto.repo.deleteRecord`, {
		method: "POST",
		headers: { ...bearer, "content-type": "application/json" },
		body: JSON.stringify({ repo: did, collection, rkey }),
	}).then((response) => response.status);

log("studio status before", await plugin<object>("studio/status", { did }));
const studio = await approve((await plugin<{ url: string }>("studio/connect", { did })).url);
const studioCallback = await siteFetch(pathOf(studio.callback));
log("connect studio", { requested: studio.scope, location: studioCallback.headers.get("location") });
const studioStatus = await plugin<{ connected: boolean; scope?: string; requested: string }>("studio/status", { did });
log("studio status after", { connected: studioStatus.connected, granted: studioStatus.scope === studioStatus.requested || studioStatus.requested.split(" ").every((scope) => studioStatus.scope?.split(" ").includes(scope)) });

const integration = await plugin<StrongRef>("studio/publish-integration", {
	did,
	rkey: STUDIO_KEY,
	record: {
		name: "E2E note",
		description: "Published by scripts/e2e.ts through the studio.",
		clientMetadata: {
			client_id: "https://example.com/oauth-client-metadata.json",
			redirect_uris: ["https://example.com/oauth/callback"],
			scope: `atproto repo:${NOTE_COLLECTION}?action=create`,
		},
		scopeGroups: [{ key: "notes", label: "Write notes", scopes: [`repo:${NOTE_COLLECTION}?action=create`] }],
	},
});
log("studio publish integration", integration);

const sources = {
	"abi.ts": await readFile(new URL("../site/src/studio/assemblyscript/abi.as", import.meta.url), "utf8"),
	"module.ts": await readFile(new URL("../site/src/studio/assemblyscript/note.as", import.meta.url), "utf8"),
};
const built = await compile(sources);
if (!built.binary) throw new Error(built.log);
const published = await plugin<{ module: StrongRef; source: StrongRef; files: number }>("studio/publish-module", {
	did,
	rkey: STUDIO_KEY,
	name: "E2E note",
	session: STUDIO_KEY,
	actions: [{ entry: "note", label: "Write note", fields: [{ key: "text", label: "Text" }] }],
	calls: ["com.atproto.repo.createRecord"],
	wasm: Buffer.from(built.binary).toString("base64"),
	source: {
		language: "assemblyscript",
		files: Object.entries(sources).map(([path, text]) => ({ path, text })),
		build: { tool: "asc", version: built.version, command: built.command, artifact: "module.wasm" },
	},
});
log("studio publish module", { module: published.module.uri, source: published.source.uri, files: published.files, bytes: built.binary.length });

await connect(STUDIO_KEY, ["notes"]);
const noted = await plugin<Ran>("run", { did, rkey: STUDIO_KEY, entry: "note", input: { text: "🧪 written by a module compiled in the studio" } });
const noteRkey = String(noted.result?.uri).split("/").pop() ?? "";
log("run studio module", summary(noted));
const sourcePage = await (await siteFetch(`/source?uri=${encodeURIComponent(published.module.uri)}`)).text();
log("source page", { verified: (sourcePage.match(/>verified</g) ?? []).length, mismatched: (sourcePage.match(/>mismatch</g) ?? []).length, rebuild: sourcePage.includes("data-rebuild-button") });

type Bundle = {
	integrations: Array<{ rkey: string; record: Record<string, unknown> }>;
	modules: Array<{ rkey: string; session: string; source: { files: unknown[]; build: { version: string } } } & Record<string, unknown>>;
};
const bundle = (await (await siteFetch("/studio/examples.json")).json()) as Bundle;
const EXAMPLE_KEY = "e2e-example-statusphere";
const exampleIntegration = bundle.integrations.find((item) => item.rkey === "statusphere");
const exampleModule = bundle.modules.find((item) => item.rkey === "statusphere");
if (!exampleIntegration || !exampleModule) throw new Error("The examples bundle has no statusphere");
await plugin("studio/publish-integration", { did, rkey: EXAMPLE_KEY, record: exampleIntegration.record });
const installed = await plugin<{ module: StrongRef; source: StrongRef; files: number }>("studio/publish-module", {
	did,
	...exampleModule,
	rkey: EXAMPLE_KEY,
	session: EXAMPLE_KEY,
});
log("install example from bundle", { integrations: bundle.integrations.map((item) => item.rkey), module: installed.module.uri, files: installed.files, build: exampleModule.source.build.version });
await connect(EXAMPLE_KEY, ["status"]);
log("run installed example", summary(await plugin<Ran>("run", { did, rkey: EXAMPLE_KEY, entry: "set_status", input: { status: "🧩" } })));
log("clear installed example", summary(await plugin<Ran>("run", { did, rkey: EXAMPLE_KEY, entry: "clear_status", input: {} })));
await plugin("disconnect", { did, rkey: EXAMPLE_KEY });
log("example cleanup", {
	module: await pdsDelete("com.fedfork.exec.wasm.module", EXAMPLE_KEY),
	manifest: await pdsDelete("com.fedfork.exec.source.manifest", installed.source.uri.split("/").pop() ?? ""),
	integration: await pdsDelete("com.fedfork.exec.oauth.clientMetadata", EXAMPLE_KEY),
});

await plugin("disconnect", { did, rkey: STUDIO_KEY });
log("studio cleanup", {
	note: await pdsDelete(NOTE_COLLECTION, noteRkey),
	module: await pdsDelete("com.fedfork.exec.wasm.module", STUDIO_KEY),
	manifest: await pdsDelete("com.fedfork.exec.source.manifest", published.source.uri.split("/").pop() ?? ""),
	integration: await pdsDelete("com.fedfork.exec.oauth.clientMetadata", STUDIO_KEY),
});
await plugin("studio/disconnect", { did });
log("studio disconnected", await plugin<object>("studio/status", { did }));

const connectedPage = await (await siteFetch("/integrations")).text();
log("page pills", { pills: [...connectedPage.matchAll(/class="pill[^"]*"[^>]*>\s*([^<]+?)\s*</g)].map((match) => match[1]) });

const header = (html: string) => ({
	signOut: /<button[^>]*data-atmosphere-signout/.test(html),
	signIn: html.includes("Sign in with Atmosphere"),
	integrations: html.includes("data-did="),
});
log("signed in header", header(connectedPage));
const logout = await siteFetch("/_emdash/api/auth/logout", { method: "POST", headers: { "x-emdash-request": "1" } });
log("sign out", { status: logout.status, after: header(await (await siteFetch("/integrations")).text()) });
