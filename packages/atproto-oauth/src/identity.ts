import type { Http } from "./http";

export interface Identity {
	did: string;
	handle?: string;
	pds: string;
}

interface DidDocument {
	alsoKnownAs?: string[];
	service?: Array<{ id: string; type: string; serviceEndpoint: string }>;
}

const isDid = (value: string) => /^did:(plc|web):[a-zA-Z0-9._:%-]+$/.test(value);

async function handleFromWellKnown(http: Http, handle: string) {
	const response = await http.fetch(`https://${handle}/.well-known/atproto-did`).catch(() => undefined);
	const did = response?.ok ? (await response.text()).trim() : "";
	return isDid(did) ? did : undefined;
}

async function handleFromDns(http: Http, handle: string) {
	const query = new URLSearchParams({ name: `_atproto.${handle}`, type: "TXT" });
	const response = await http.fetch(`https://cloudflare-dns.com/dns-query?${query}`, {
		headers: { accept: "application/dns-json" },
	});
	if (!response.ok) return undefined;
	const { Answer = [] } = (await response.json()) as { Answer?: Array<{ data: string }> };
	const did = Answer.map((answer) => answer.data.replace(/"/g, ""))
		.find((data) => data.startsWith("did="))
		?.slice(4);
	return did && isDid(did) ? did : undefined;
}

export async function resolveHandle(http: Http, handle: string) {
	const did = (await handleFromWellKnown(http, handle)) ?? (await handleFromDns(http, handle));
	if (!did) throw new Error(`Could not resolve handle ${handle}`);
	return did;
}

export async function resolveDidDocument(http: Http, did: string): Promise<DidDocument> {
	const url = did.startsWith("did:web:")
		? `https://${decodeURIComponent(did.slice(8))}/.well-known/did.json`
		: `https://plc.directory/${did}`;
	const response = await http.fetch(url);
	if (!response.ok) throw new Error(`Could not resolve ${did}`);
	return response.json();
}

export async function resolveIdentity(http: Http, input: string): Promise<Identity> {
	const identifier = input.trim().replace(/^@/, "").toLowerCase();
	const did = isDid(identifier) ? identifier : await resolveHandle(http, identifier);
	const document = await resolveDidDocument(http, did);
	const pds = document.service?.find(
		(service) => service.id.endsWith("#atproto_pds") && service.type === "AtprotoPersonalDataServer",
	)?.serviceEndpoint;
	if (!pds) throw new Error(`${did} has no PDS`);
	const handle = document.alsoKnownAs?.find((alias) => alias.startsWith("at://"))?.slice(5);
	return { did, handle, pds };
}
