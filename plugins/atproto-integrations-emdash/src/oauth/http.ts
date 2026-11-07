import type { PluginContext } from "emdash/plugin";

export type Http = NonNullable<PluginContext["http"]>;

export function requireHttp(ctx: PluginContext): Http {
	if (!ctx.http) throw new Error("The network:request capability is required");
	return ctx.http;
}
