export const PROVIDER_ID = "atproto";
export const SCOPE = "atproto";
export const RETURN_TO_KEY = "atprotoReturnTo";
export const STORAGE = { states: { indexes: [] as string[] } };

export interface AtprotoSubscriberConfig {
	allowAnyAccount?: boolean;
	allowedDIDs?: string[];
	allowedHandles?: string[];
	defaultRole?: number;
}

export interface Account {
	did: string;
	handle?: string;
}

const SAFE_PATH = /^\/(?![/\\])[^\\\u0000-\u001f\u007f]*$/;

export function safeReturnTo(value: unknown) {
	return typeof value === "string" && SAFE_PATH.test(value) ? value : undefined;
}

export function withError(path: string, message: string) {
	const url = new URL(path, "http://site.invalid");
	url.searchParams.set("error", message);
	return `${url.pathname}${url.search}`;
}

export function matchesHandle(handle: string, patterns: string[]) {
	const normalized = handle.toLowerCase();
	return patterns.some((pattern) => {
		const p = pattern.toLowerCase();
		return p === "*" || normalized === p || (p.startsWith("*.") && normalized.endsWith(p.slice(1)));
	});
}

export const allowsSignup = (config: AtprotoSubscriberConfig) =>
	Boolean(config.allowAnyAccount || config.allowedDIDs?.length || config.allowedHandles?.length);

export function isAllowed(config: AtprotoSubscriberConfig, account: Account) {
	if (config.allowAnyAccount) return true;
	if (config.allowedDIDs?.includes(account.did)) return true;
	return Boolean(account.handle && config.allowedHandles?.length && matchesHandle(account.handle, config.allowedHandles));
}
