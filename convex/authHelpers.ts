const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function bytesToHex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function normalizeLoginEmail(email: string | undefined) {
  const normalized = email?.trim().toLowerCase() ?? "";
  return EMAIL_PATTERN.test(normalized) ? normalized : "";
}

export function safeRedirectPath(path: string | undefined) {
  const trimmed = path?.trim() ?? "";
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return "/";
  try {
    const url = new URL(trimmed, "https://example.invalid");
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

export function buildMagicLinkUrl({
  baseUrl,
  redirectPath,
  token,
}: {
  baseUrl: string;
  redirectPath: string | undefined;
  token: string;
}) {
  const url = new URL(safeRedirectPath(redirectPath), baseUrl);
  url.searchParams.set("authToken", token);
  return url.toString();
}

export async function hashLoginToken(token: string, salt: string) {
  const data = new TextEncoder().encode(`${salt}:${token}`);
  return bytesToHex(await crypto.subtle.digest("SHA-256", data));
}
