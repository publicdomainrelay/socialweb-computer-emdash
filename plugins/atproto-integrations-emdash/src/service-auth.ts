import { p256 } from "@noble/curves/nist.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { base58, base64urlnopad } from "@scure/base";
import type { PluginContext } from "emdash/plugin";
import { requireHttp } from "./oauth/http";
import { isDid, resolveDidDocument } from "./oauth/identity";

export const RUN_NSID = "com.publicdomainrelay.temp.wasm.run";
const SERVICE_ID = "emdash_integrations";
const SERVICE_TYPE = "EmDashAtprotoIntegrations";
const MAX_LIFETIME_SECONDS = 3600;
const CLOCK_SKEW_SECONDS = 30;

export class ServiceAuthError extends Error {
	override name = "ServiceAuthError";
}

const CURVES = {
	ES256K: { prefix: [0xe7, 0x01], curve: secp256k1 },
	ES256: { prefix: [0x80, 0x24], curve: p256 },
} as const;

function decodeJson(segment: string): Record<string, unknown> {
	try {
		const value: unknown = JSON.parse(new TextDecoder().decode(base64urlnopad.decode(segment)));
		if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
	} catch {}
	throw new ServiceAuthError("Malformed service auth token");
}

export const siteDid = (origin: string) => `did:web:${new URL(origin).host.replace(":", "%3A")}`;

export function siteDidDocument(origin: string) {
	const did = siteDid(origin);
	return {
		"@context": ["https://www.w3.org/ns/did/v1"],
		id: did,
		service: [{ id: `#${SERVICE_ID}`, type: SERVICE_TYPE, serviceEndpoint: new URL(origin).origin }],
	};
}

async function signingKey(ctx: PluginContext, did: string) {
	const document = await resolveDidDocument(requireHttp(ctx), did).catch(() => {
		throw new ServiceAuthError(`Could not resolve ${did}`);
	});
	const method = document.verificationMethod?.find((item) => item.id === "#atproto" || item.id === `${did}#atproto`);
	if (!method?.publicKeyMultibase?.startsWith("z")) throw new ServiceAuthError(`${did} has no atproto signing key`);
	return base58.decode(method.publicKeyMultibase.slice(1));
}

async function rememberJti(ctx: PluginContext, iss: string, jti: string, exp: number) {
	const now = Math.floor(Date.now() / 1000);
	const stale = await ctx.storage.replays.query({ where: { exp: { lt: now } }, limit: 100 });
	if (stale.items.length) await ctx.storage.replays.deleteMany(stale.items.map((item) => item.id));
	const written = await ctx.storage.replays.compareAndSet(`${iss} ${jti}`, null, { exp });
	if (!written.applied) throw new ServiceAuthError("Service auth token was already used");
}

export async function verifyServiceAuth(ctx: PluginContext, token: string, audience: string, lxm: string) {
	const parts = token.split(".");
	if (parts.length !== 3) throw new ServiceAuthError("Malformed service auth token");
	const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
	const header = decodeJson(encodedHeader);
	const payload = decodeJson(encodedPayload);
	const algorithm = header.alg === "ES256K" || header.alg === "ES256" ? CURVES[header.alg] : undefined;
	if (!algorithm) throw new ServiceAuthError(`Unsupported service auth algorithm ${String(header.alg)}`);
	const { iss, aud, exp, jti } = payload;
	if (typeof iss !== "string" || !isDid(iss)) throw new ServiceAuthError("Service auth issuer must be a user DID");
	if (aud !== audience && aud !== `${audience}#${SERVICE_ID}`) throw new ServiceAuthError("Service auth token is for another service");
	if (payload.lxm !== lxm) throw new ServiceAuthError(`Service auth token is not scoped to ${lxm}`);
	const now = Math.floor(Date.now() / 1000);
	if (typeof exp !== "number" || exp + CLOCK_SKEW_SECONDS < now) throw new ServiceAuthError("Service auth token expired");
	if (exp > now + MAX_LIFETIME_SECONDS + CLOCK_SKEW_SECONDS) throw new ServiceAuthError("Service auth token lives too long");
	const key = await signingKey(ctx, iss);
	if (key[0] !== algorithm.prefix[0] || key[1] !== algorithm.prefix[1]) throw new ServiceAuthError("Service auth algorithm does not match the signing key");
	const signed = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
	const valid = (() => {
		try {
			return algorithm.curve.verify(base64urlnopad.decode(encodedSignature), signed, key.slice(2));
		} catch {
			return false;
		}
	})();
	if (!valid) throw new ServiceAuthError("Service auth signature is invalid");
	if (typeof jti === "string") await rememberJti(ctx, iss, jti, exp);
	return iss;
}
