import { getPdsEndpoint, isAtprotoDid } from "@atcute/identity";
import { CompositeDidDocumentResolver, PlcDidDocumentResolver, WebDidDocumentResolver } from "@atcute/identity-resolver";

export const CLIENT_COLLECTION = "com.fedfork.exec.oauth.clientMetadata";
export const MODULE_COLLECTION = "com.fedfork.exec.wasm.module";
export const FILE_COLLECTION = "com.fedfork.exec.source.file";
export const MANIFEST_COLLECTION = "com.fedfork.exec.source.manifest";

const AT_URI = /^at:\/\/(did:[a-z]+:[a-zA-Z0-9._:%-]+)\/([a-zA-Z0-9.-]+)\/([a-zA-Z0-9._:~-]+)$/;

const didDocuments = new CompositeDidDocumentResolver({
	methods: { plc: new PlcDidDocumentResolver(), web: new WebDidDocumentResolver() },
});

export interface StoredRecord<T> {
	uri: string;
	cid: string;
	value: T;
}

export function parseAtUri(uri: string) {
	const match = AT_URI.exec(uri);
	if (!match) throw new Error(`${uri} is not an at:// record URI`);
	return { did: match[1], collection: match[2], rkey: match[3] };
}

export async function pdsOf(did: string) {
	if (!isAtprotoDid(did)) throw new Error(`${did} is not a did:plc or did:web`);
	const pds = getPdsEndpoint(await didDocuments.resolve(did));
	if (!pds) throw new Error(`${did} has no PDS`);
	return pds;
}

async function xrpc<T>(pds: string, nsid: string, params: Record<string, string>) {
	const response = await fetch(`${new URL(`/xrpc/${nsid}`, pds)}?${new URLSearchParams(params)}`);
	if (!response.ok) throw new Error(`${nsid} failed with ${response.status}`);
	return (await response.json()) as T;
}

export async function getRecord<T>(uri: string, pds?: string): Promise<StoredRecord<T>> {
	const { did, collection, rkey } = parseAtUri(uri);
	return xrpc<StoredRecord<T>>(pds ?? (await pdsOf(did)), "com.atproto.repo.getRecord", { repo: did, collection, rkey });
}

export async function listRecords<T>(did: string, collection: string, pds?: string) {
	const { records } = await xrpc<{ records: StoredRecord<T>[] }>(pds ?? (await pdsOf(did)), "com.atproto.repo.listRecords", {
		repo: did,
		collection,
		limit: "100",
	});
	return records;
}

export const rkeyOf = (uri: string) => parseAtUri(uri).rkey;
