import type { PluginContext } from "emdash/plugin";

export type Http = NonNullable<PluginContext["http"]>;

export function requireHttp(ctx: PluginContext): Http {
	if (!ctx.http) throw new Error("The network:request capability is required");
	return ctx.http;
}

function plainHeaders(headers: HeadersInit | undefined) {
	const out: Record<string, string> = {};
	new Headers(headers).forEach((value, key) => {
		out[key] = value;
	});
	return out;
}

export function sandboxFetch(ctx: PluginContext): typeof fetch {
	const http = requireHttp(ctx);
	return async (input, init) => {
		const request = new Request(input, { ...init, cache: undefined });
		const body = request.method === "GET" || request.method === "HEAD" ? undefined : new TextDecoder().decode(await request.arrayBuffer());
		const response = await http.fetch(request.url, { method: request.method, headers: plainHeaders(request.headers), body, redirect: init?.redirect });
		return new Response(await response.arrayBuffer(), { status: response.status, statusText: response.statusText, headers: response.headers });
	};
}

export const xrpcUrl = (service: string, nsid: string, params: Record<string, string>) =>
	`${new URL(`/xrpc/${nsid}`, service).href}?${new URLSearchParams(params)}`;
