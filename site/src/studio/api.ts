export const AFTER_CONNECT_KEY = "studio:after-connect";

export async function plugin<T>(route: string, body: unknown): Promise<T> {
	const response = await fetch(`/_emdash/api/plugins/atproto-integrations/${route}`, {
		method: "POST",
		headers: { "content-type": "application/json", "x-emdash-request": "1" },
		body: JSON.stringify(body),
	});
	const payload = (await response.json().catch(() => ({}))) as { success?: boolean; data?: T; error?: { message?: string } };
	if (!response.ok || !payload.success) throw new Error(payload.error?.message ?? `Request failed with ${response.status}`);
	return payload.data as T;
}

export const studioDid = () => document.querySelector<HTMLElement>("[data-studio-did]")?.dataset.studioDid ?? "";

export async function connectStudio(groups: string[], returnTo: string) {
	try {
		sessionStorage.setItem(AFTER_CONNECT_KEY, returnTo);
	} catch {}
	window.location.href = (await plugin<{ url: string }>("studio/connect", { account: studioDid(), groups })).url;
}
