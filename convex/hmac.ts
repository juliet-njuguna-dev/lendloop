// HMAC-SHA256 signing used in BOTH directions (Convex -> n8n and n8n -> Convex).
// Signed string: `${timestamp}.${METHOD}.${path}.${body}`. The timestamp stops replays.
const enc = new TextEncoder();
const MAX_SKEW_MS = 5 * 60 * 1000;

const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function key(secret: string) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

export async function sign(secret: string, ts: string, method: string, path: string, body: string) {
  const sig = await crypto.subtle.sign("HMAC", await key(secret), enc.encode(`${ts}.${method}.${path}.${body}`));
  return hex(sig);
}

// Constant-time comparison so response timing leaks nothing about the signature.
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verify(secret: string, req: Request, path: string, body: string) {
  const ts = req.headers.get("x-timestamp") ?? "";
  const sig = req.headers.get("x-signature") ?? "";
  const age = Math.abs(Date.now() - Number(ts));
  if (!ts || !sig || Number.isNaN(age) || age > MAX_SKEW_MS) return false;
  return safeEqual(await sign(secret, ts, req.method, path, body), sig);
}
