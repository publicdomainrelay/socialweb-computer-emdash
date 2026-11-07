export type Interaction =
	| { type: "page_load"; page: string }
	| { type: "form_submit"; action_id: string; values: Record<string, unknown> }
	| { type: "block_action"; action_id: string; value?: unknown };

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export function parseInteraction(input: unknown): Interaction | undefined {
	if (!isRecord(input)) return undefined;
	if (input.type === "page_load" && typeof input.page === "string") return { type: "page_load", page: input.page };
	if (typeof input.action_id !== "string") return undefined;
	if (input.type === "block_action") return { type: "block_action", action_id: input.action_id, value: input.value };
	if (input.type === "form_submit") {
		return { type: "form_submit", action_id: input.action_id, values: isRecord(input.values) ? input.values : {} };
	}
	return undefined;
}

export function text(value: unknown, max = 256) {
	const trimmed = typeof value === "string" ? value.trim() : "";
	if (!trimmed || trimmed.length > max) throw new Error(`Expected text up to ${max} characters`);
	return trimmed;
}

export const optionalText = (value: unknown, max = 256) =>
	typeof value === "string" && value.trim() ? text(value, max) : "";

export const textList = (value: unknown) =>
	Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
