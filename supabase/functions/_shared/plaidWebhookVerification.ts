import { importJWK, jwtVerify } from "npm:jose@6.1.0";

type PlaidWebhookVerificationKeyResponse = {
  key: {
    alg: string;
    crv: string;
    kid: string;
    kty: string;
    use: string;
    x: string;
    y: string;
    expired_at?: number;
  };
};

type CachedVerificationKey = {
  cryptoKey: CryptoKey;
  expiresAtMs: number;
};

const keyCache = new Map<string, CachedVerificationKey>();

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function getPlaidBaseUrl(): string {
  const env = (Deno.env.get("PLAID_ENV") ?? "sandbox").toLowerCase();
  if (env === "production") return "https://production.plaid.com";
  if (env === "development") return "https://development.plaid.com";
  return "https://sandbox.plaid.com";
}

function base64UrlToUint8Array(input: string): Uint8Array {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function parseJwtHeader(jwt: string): { alg?: string; kid?: string } {
  const parts = jwt.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid Plaid-Verification JWT format.");
  }
  const headerBytes = base64UrlToUint8Array(parts[0]);
  const headerJson = new TextDecoder().decode(headerBytes);
  return JSON.parse(headerJson) as { alg?: string; kid?: string };
}

async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function fetchPlaidVerificationKey(kid: string): Promise<CachedVerificationKey> {
  const clientId = getRequiredEnv("PLAID_CLIENT_ID");
  const secret = getRequiredEnv("PLAID_SECRET");
  const url = `${getPlaidBaseUrl()}/webhook_verification_key/get`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      secret,
      key_id: kid,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Plaid webhook_verification_key/get failed (${response.status}): ${body}`,
    );
  }

  const payload = (await response.json()) as PlaidWebhookVerificationKeyResponse;
  const key = payload.key;
  if (!key || !key.kid || !key.x || !key.y) {
    throw new Error("Invalid Plaid verification key payload.");
  }

  const cryptoKey = await importJWK(
    {
      kty: key.kty,
      crv: key.crv,
      kid: key.kid,
      use: key.use,
      alg: key.alg,
      x: key.x,
      y: key.y,
    },
    "ES256",
  );

  const expiresAtMs = key.expired_at
    ? key.expired_at * 1000
    : Date.now() + 5 * 60 * 1000;

  return {
    cryptoKey,
    expiresAtMs,
  };
}

async function getVerificationKey(kid: string): Promise<CryptoKey> {
  const cached = keyCache.get(kid);
  if (cached && cached.expiresAtMs > Date.now() + 1000) {
    return cached.cryptoKey;
  }

  const fetched = await fetchPlaidVerificationKey(kid);
  keyCache.set(kid, fetched);
  return fetched.cryptoKey;
}

export async function verifyPlaidWebhookSignature(
  plaidVerificationHeader: string,
  rawBody: string,
): Promise<void> {
  const header = parseJwtHeader(plaidVerificationHeader);
  if (header.alg !== "ES256") {
    throw new Error("Plaid webhook token algorithm must be ES256.");
  }
  if (!header.kid) {
    throw new Error("Plaid webhook token missing key id (kid).");
  }

  const key = await getVerificationKey(header.kid);
  const verification = await jwtVerify(plaidVerificationHeader, key, {
    algorithms: ["ES256"],
  });

  const bodyHashFromPayload = String(
    verification.payload.request_body_sha256 ?? "",
  ).toLowerCase();
  if (!bodyHashFromPayload) {
    throw new Error("Plaid webhook token missing request_body_sha256 claim.");
  }

  const computedBodyHash = await sha256Hex(rawBody);
  if (!timingSafeEqual(bodyHashFromPayload, computedBodyHash)) {
    throw new Error("Plaid webhook body hash mismatch.");
  }

  const iat = Number(verification.payload.iat ?? 0);
  const now = Math.floor(Date.now() / 1000);
  if (!iat || Math.abs(now - iat) > 60 * 5) {
    throw new Error("Plaid webhook token iat is outside allowed window.");
  }
}
