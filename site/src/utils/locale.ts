import { getI18nConfig } from "emdash";

export function getSiteLocale(): string | undefined {
	const locale = getI18nConfig()?.defaultLocale;
	if (!locale) return undefined;
	try {
		return Intl.DateTimeFormat.supportedLocalesOf(locale)[0];
	} catch {
		return undefined;
	}
}

export function formatDate(date: Date, month: "long" | "short"): string {
	return date.toLocaleDateString(getSiteLocale() ?? "en-US", {
		year: "numeric",
		month,
		day: "numeric",
	});
}
