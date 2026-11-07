import type { Http } from "./http";

export interface AuthorizationServer {
	issuer: string;
	authorization_endpoint: string;
	token_endpoint: string;
	pushed_authorization_request_endpoint: string;
	revocation_endpoint?: string;
}

async function fetchJson<T>(http: Http, url: string): Promise<T> {
	const response = await http.fetch(url, { headers: { accept: "application/json" } });
	if (!response.ok) throw new Error(`GET ${url} returned ${response.status}`);
	return response.json();
}

export async function authorizationServerFor(http: Http, pds: string) {
	const resource = await fetchJson<{ authorization_servers?: string[] }>(
		http,
		new URL("/.well-known/oauth-protected-resource", pds).href,
	);
	const issuer = resource.authorization_servers?.[0];
	if (!issuer) throw new Error(`${pds} names no authorization server`);
	const server = await fetchJson<AuthorizationServer>(
		http,
		new URL("/.well-known/oauth-authorization-server", issuer).href,
	);
	if (server.issuer !== issuer) throw new Error(`Authorization server ${issuer} reports issuer ${server.issuer}`);
	return server;
}
