import type { IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";

const env = (name: string, fallback?: string) => {
	const value = process.env[name] ?? fallback;
	if (!value) throw new Error(`Set ${name}`);
	return value;
};

const LOCAL_URL = env("LOCAL_URL", "http://127.0.0.1:4321");
const HANDLE = env("ATPROTO_HANDLE");
const PASSWORD = env("ATPROTO_PASSWORD");
const BROWSER = "Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/140.0";

type Blocks = { blocks: Array<Record<string, any>>; toast?: { type: string; message: string } };

async function adminToken() {
	const response = await fetch(`${LOCAL_URL}/_emdash/api/setup/dev-bypass?token=1`);
	const { data } = (await response.json()) as { data: { token: string } };
	return data.token;
}

function admin(token: string, plugin: string) {
	return async (interaction: Record<string, unknown>): Promise<Blocks> => {
		const response = await fetch(`${LOCAL_URL}/_emdash/api/plugins/${plugin}/admin`, {
			method: "POST",
			headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
			body: JSON.stringify(interaction),
		});
		const { data } = (await response.json()) as { data: Blocks };
		return data;
	};
}

const authorizeUrl = (page: Blocks) => {
	const link = page.blocks.flatMap((block) => block.elements ?? []).find((element) => element.target?.kind === "external");
	if (!link) throw new Error(`No authorize link: ${JSON.stringify(page.toast ?? page.blocks)}`);
	return link.target.url as string;
};

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
	const cookies = new Map<string, string>();
	const remember = (response: Raw) => {
		for (const cookie of response.headers["set-cookie"] ?? []) {
			const pair = cookie.split(";")[0];
			const split = pair.indexOf("=");
			cookies.set(pair.slice(0, split), pair.slice(split + 1));
		}
	};
	const cookie = () => [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
	const page = await browser(url, "GET", {
		accept: "text/html",
		"sec-fetch-site": "cross-site",
		"sec-fetch-mode": "navigate",
		"sec-fetch-dest": "document",
	});
	remember(page);
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
				cookie: cookie(),
				"x-csrf-token": cookies.get("csrf-token") ?? "",
				"sec-fetch-site": "same-origin",
				"sec-fetch-mode": "same-origin",
				"sec-fetch-dest": "empty",
				...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
			},
			JSON.stringify(input),
		);
		remember(response);
		if (response.status >= 400) throw new Error(`${path} failed: ${response.body}`);
		return JSON.parse(response.body);
	};
	const signIn = await api("/sign-in", { username: HANDLE, password: PASSWORD, remember: false, locale: "en" });
	const consent = await api("/consent", { did: signIn.account.did, scope: authorize.scope }, signIn.ephemeralToken);
	const params = new URL(consent.url).searchParams;
	const callback = `${params.get("redirect_uri")}?${new URLSearchParams(
		[...params].filter(([name]) => ["code", "state", "iss", "error", "error_description"].includes(name)),
	)}`;
	const landed = await fetch(callback, { redirect: "manual" });
	return { requested: authorize.scope as string, status: landed.status, next: landed.headers.get("location") };
}

const field = (page: Blocks, label: string) =>
	page.blocks.flatMap((block) => block.fields ?? []).find((item) => item.label === label)?.value;

const granted = (page: Blocks) =>
	page.blocks
		.find((block) => block.type === "table")
		?.rows.filter((row: Record<string, string>) => row.status === "granted")
		.map((row: Record<string, string>) => row.group);

async function connect(call: ReturnType<typeof admin>, actionId: string, values: Record<string, unknown>) {
	const page = await call({ type: "form_submit", action_id: actionId, values });
	const result = await approve(authorizeUrl(page));
	console.log(JSON.stringify({ step: actionId, requested: result.requested, callback: result.status, next: result.next }));
	const connected = await call({ type: "page_load", page: "/connect" });
	console.log(JSON.stringify({ notice: connected.blocks.find((block) => block.type === "banner")?.description, granted: granted(connected) }));
	return connected;
}

async function listStatuses(pds: string, did: string) {
	const response = await fetch(`${pds}/xrpc/com.atproto.repo.listRecords?repo=${did}&collection=xyz.statusphere.status&limit=5`);
	return ((await response.json()) as { records: Array<{ uri: string; value: { status: string } }> }).records;
}

const token = await adminToken();
const statusphere = admin(token, "statusphere");
await statusphere({ type: "block_action", action_id: "oauth:disconnect" });
const connected = await connect(statusphere, "oauth:connect", { identifier: HANDLE, groups: ["status"] });
const did = field(connected, "DID");
const pds = field(connected, "PDS");
const posted = await statusphere({ type: "block_action", action_id: "status:set", value: "🦋" });
console.log(JSON.stringify({ step: "status:set", toast: posted.toast }));
const latest = (await listStatuses(pds, did))[0];
console.log(JSON.stringify({ step: "verify", uri: latest?.uri, status: latest?.value.status }));
await connect(statusphere, "oauth:upgrade", { groups: ["profile"] });
const status = await statusphere({ type: "page_load", page: "/status" });
console.log(JSON.stringify({ step: "profile", name: field(status, "Name"), followers: field(status, "Followers") }));
const removed = await statusphere({ type: "block_action", action_id: "status:delete", value: latest.uri.split("/").pop() });
console.log(JSON.stringify({ step: "status:delete", toast: removed.toast }));

const requester = admin(token, "socialweb-computer-requester");
await requester({ type: "block_action", action_id: "oauth:disconnect" });
await connect(requester, "oauth:connect", { identifier: HANDLE, groups: ["associate"] });
await connect(requester, "oauth:upgrade", { groups: ["policy", "atirc"] });
const page = await requester({ type: "page_load", page: "/requester" });
console.log(JSON.stringify({ step: "requester", stats: page.blocks.find((block) => block.type === "stats")?.items }));
