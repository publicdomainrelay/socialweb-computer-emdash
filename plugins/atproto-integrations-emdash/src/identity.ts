import { getAtprotoVerificationMaterial, isAtprotoDid } from "@atcute/identity";
import {
	CompositeDidDocumentResolver,
	CompositeHandleResolver,
	DohJsonHandleResolver,
	LocalActorResolver,
	PlcDidDocumentResolver,
	WebDidDocumentResolver,
	WellKnownHandleResolver,
} from "@atcute/identity-resolver";
import type { PluginContext } from "emdash/plugin";
import { sandboxFetch } from "./http";

export { isAtprotoDid };

export function resolvers(ctx: PluginContext) {
	const fetch = sandboxFetch(ctx);
	const didDocuments = new CompositeDidDocumentResolver({
		methods: { plc: new PlcDidDocumentResolver({ fetch }), web: new WebDidDocumentResolver({ fetch }) },
	});
	const actors = new LocalActorResolver({
		handleResolver: new CompositeHandleResolver({
			strategy: "race",
			methods: {
				dns: new DohJsonHandleResolver({ dohUrl: "https://cloudflare-dns.com/dns-query", fetch }),
				http: new WellKnownHandleResolver({ fetch }),
			},
		}),
		didDocumentResolver: didDocuments,
	});
	return { fetch, didDocuments, actors };
}

export async function resolveActor(ctx: PluginContext, did: string) {
	if (!isAtprotoDid(did)) throw new Error(`${did} is not a did:plc or did:web`);
	return resolvers(ctx).actors.resolve(did);
}

export async function atprotoSigningMaterial(ctx: PluginContext, did: string) {
	if (!isAtprotoDid(did)) throw new Error(`${did} is not a did:plc or did:web`);
	return getAtprotoVerificationMaterial(await resolvers(ctx).didDocuments.resolve(did));
}
