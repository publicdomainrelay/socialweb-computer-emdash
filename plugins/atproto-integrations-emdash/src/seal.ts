import { base64urlnopad } from "@scure/base";
import type { PluginContext } from "emdash/plugin";

export interface Sealed {
	iv: string;
	data: string;
}

const KEY_SETTING = "sessionKey";
const encoder = new TextEncoder();
const bytes = (value: string) => new Uint8Array(base64urlnopad.decode(value));

async function sealingKey(ctx: PluginContext) {
	let raw = await ctx.settings.get<string>(KEY_SETTING);
	if (!raw) {
		const created = base64urlnopad.encode(crypto.getRandomValues(new Uint8Array(32)));
		const result = await ctx.settings.compareAndSet(KEY_SETTING, null, created);
		raw = result.applied ? created : await ctx.settings.get<string>(KEY_SETTING);
	}
	if (!raw) throw new Error("Session key unavailable");
	return crypto.subtle.importKey("raw", bytes(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
}

const additionalData = (ctx: PluginContext, id: string) => encoder.encode(`${ctx.plugin.id}:${id}`);

export async function seal(ctx: PluginContext, id: string, value: unknown): Promise<Sealed> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const data = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv, additionalData: additionalData(ctx, id) },
		await sealingKey(ctx),
		encoder.encode(JSON.stringify(value)),
	);
	return { iv: base64urlnopad.encode(iv), data: base64urlnopad.encode(new Uint8Array(data)) };
}

export async function unseal<T>(ctx: PluginContext, id: string, sealed: Sealed): Promise<T> {
	const data = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv: bytes(sealed.iv), additionalData: additionalData(ctx, id) },
		await sealingKey(ctx),
		bytes(sealed.data),
	);
	return JSON.parse(new TextDecoder().decode(data)) as T;
}
