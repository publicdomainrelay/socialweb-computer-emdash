export interface ScopeGroup {
	key: string;
	label: string;
	scopes: string[];
}

export const BASE_SCOPE = "atproto";

export const scopeList = (scope: string) => scope.split(" ").filter(Boolean);

const join = (scopes: string[]) => [...new Set([BASE_SCOPE, ...scopes])].join(" ");

export function requestedScope(declared: string, groups: ScopeGroup[], keys: string[]) {
	const allowed = new Set(scopeList(declared));
	if (!groups.length || !keys.length) return join(scopeList(declared));
	return join(groups.filter((group) => keys.includes(group.key)).flatMap((group) => group.scopes.filter((scope) => allowed.has(scope))));
}

export function grantedGroupKeys(groups: ScopeGroup[], scope: string) {
	const granted = new Set(scopeList(scope));
	return groups.filter((group) => group.scopes.every((item) => granted.has(item))).map((group) => group.key);
}
