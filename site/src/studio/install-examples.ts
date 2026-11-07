import { plugin, studioDid } from "./api";
import type { ExamplesBundle } from "./examples";

export const AFTER_CONNECT_KEY = "studio:after-connect";

export interface InstallStep {
	label: string;
	state: "pending" | "running" | "done" | "skipped" | "failed";
	detail?: string;
}

export async function installExamples(existing: { integrations: string[]; modules: string[] }, onChange: (steps: InstallStep[]) => void) {
	const bundle = (await (await fetch("/studio/examples.json")).json()) as ExamplesBundle;
	const did = studioDid();
	const jobs = [
		...bundle.integrations.map((item) => ({
			label: `Integration ${item.record.name as string}`,
			skip: existing.integrations.includes(item.rkey),
			run: () => plugin<{ uri: string }>("studio/publish-integration", { did, rkey: item.rkey, record: item.record }),
		})),
		...bundle.modules.map((item) => ({
			label: `Module ${item.name} with ${item.source.files.length} source files`,
			skip: existing.modules.includes(item.rkey),
			run: () => plugin<{ module: { uri: string } }>("studio/publish-module", { did, ...item }).then((result) => ({ uri: result.module.uri })),
		})),
	];
	const steps: InstallStep[] = jobs.map((job) => ({ label: job.label, state: job.skip ? "skipped" : "pending", detail: job.skip ? "already in your account" : undefined }));
	onChange(steps);
	for (const [index, job] of jobs.entries()) {
		if (job.skip) continue;
		steps[index] = { ...steps[index], state: "running" };
		onChange(steps);
		try {
			const { uri } = await job.run();
			steps[index] = { ...steps[index], state: "done", detail: uri };
		} catch (cause) {
			steps[index] = { ...steps[index], state: "failed", detail: cause instanceof Error ? cause.message : String(cause) };
		}
		onChange(steps);
	}
	return steps;
}
