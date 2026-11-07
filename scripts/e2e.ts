import type { IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";

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

const connectedPage = await (await siteFetch("/integrations")).text();
log("page pills", { pills: [...connectedPage.matchAll(/class="pill[^"]*"[^>]*>\s*([^<]+?)\s*</g)].map((match) => match[1]) });

const header = (html: string) => ({
	signOut: /<button[^>]*data-sign-out/.test(html),
	signIn: html.includes("Sign in with Atmosphere"),
	integrations: html.includes("data-did="),
});
log("signed in header", header(connectedPage));
const logout = await siteFetch("/_emdash/api/auth/logout", { method: "POST", headers: { "x-emdash-request": "1" } });
log("sign out", { status: logout.status, after: header(await (await siteFetch("/integrations")).text()) });
