export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>) {
	return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
