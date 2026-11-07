export interface ScopeGroup {
	id: string;
	label: string;
	scopes: string[];
}

export const BASE_SCOPE = "atproto";

const unique = (scopes: string[]) => [...new Set([BASE_SCOPE, ...scopes])].join(" ");

export const declaredScope = (groups: ScopeGroup[]) => unique(groups.flatMap((group) => group.scopes));

export const requestedScope = (groups: ScopeGroup[], ids: string[]) =>
	unique(groups.filter((group) => ids.includes(group.id)).flatMap((group) => group.scopes));

export function grantedGroupIds(groups: ScopeGroup[], scope: string) {
	const granted = new Set(scope.split(" "));
	return groups.filter((group) => group.scopes.every((item) => granted.has(item))).map((group) => group.id);
}
