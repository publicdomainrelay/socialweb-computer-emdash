import { Button, Input } from "@cloudflare/kumo";
import * as React from "react";

function AtprotoIcon({ className }: { className?: string }) {
	return (
		<svg className={className} viewBox="0 0 600 527" fill="currentColor" aria-hidden="true">
			<path d="m135.72 44.03c66.496 49.921 138.02 151.14 164.28 205.46 26.262-54.316 97.782-155.54 164.28-205.46 47.98-36.021 125.72-63.892 125.72 24.795 0 17.712-10.155 148.79-16.111 170.07-20.703 73.984-96.144 92.854-163.25 81.433 117.3 19.964 147.14 86.092 82.697 152.22-122.39 125.59-175.91-31.511-189.63-71.766-2.514-7.3797-3.6904-10.832-3.7077-7.8964-0.0174-2.9357-1.1937 0.51669-3.7077 7.8964-13.714 40.255-67.233 197.36-189.63 71.766-64.444-66.128-34.605-132.26 82.697-152.22-67.108 11.421-142.55-7.4491-163.25-81.433-5.9562-21.282-16.111-152.36-16.111-170.07 0-88.687 77.742-60.816 125.72-24.795z" />
		</svg>
	);
}

export function LoginButton() {
	return (
		<Button type="button" variant="outline" className="w-full justify-center">
			<AtprotoIcon className="h-5 w-5" />
			<span>Atmosphere</span>
		</Button>
	);
}

export const loginHelp = "Enter your handle to sign in.";

function HandleForm({ endpoint, title, variant }: { endpoint: string; title?: string; variant?: "outline" }) {
	const [handle, setHandle] = React.useState("");
	const [isLoading, setIsLoading] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);

	const submit = async (event: React.FormEvent) => {
		event.preventDefault();
		if (!handle.trim()) return;
		setIsLoading(true);
		setError(null);
		try {
			const response = await fetch(endpoint, {
				method: "POST",
				headers: { "Content-Type": "application/json", "X-EmDash-Request": "1" },
				body: JSON.stringify({ handle: handle.trim() }),
			});
			const body = (await response.json().catch(() => ({}))) as { data?: { url?: string }; error?: { message?: string } };
			if (!response.ok || !body.data?.url) throw new Error(body.error?.message || "Failed to start Atmosphere login");
			window.location.href = body.data.url;
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to start Atmosphere login");
			setIsLoading(false);
		}
	};

	return (
		<form onSubmit={submit} className="space-y-3">
			{title && (
				<div className="text-center mb-2">
					<p className="text-sm font-medium text-kumo-default">{title}</p>
					<p className="text-xs text-kumo-subtle">Sign in with your Bluesky/Atmosphere handle</p>
				</div>
			)}
			<Input
				label="Atmosphere Handle"
				name="handle"
				type="text"
				value={handle}
				onChange={(event) => setHandle(event.target.value)}
				placeholder="you.bsky.social"
				disabled={isLoading}
				className="w-full"
			/>
			{error && <div className="rounded-lg bg-kumo-danger/10 p-3 text-sm text-kumo-danger">{error}</div>}
			<Button type="submit" variant={variant} className="w-full" disabled={isLoading || !handle.trim()}>
				{isLoading ? "Connecting..." : "Sign in"}
			</Button>
		</form>
	);
}

export function LoginForm() {
	return <HandleForm endpoint="/_emdash/api/auth/atproto/login" />;
}

export function SetupStep(_props: { onComplete: () => void }) {
	return <HandleForm endpoint="/_emdash/api/setup/atproto-admin" title="Atmosphere" variant="outline" />;
}
