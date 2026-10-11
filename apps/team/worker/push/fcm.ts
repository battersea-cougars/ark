// Firebase Cloud Messaging (ADR 0108): free, and it reaches both iPhones (through Apple's push service) and Android
// phones over plain HTTPS, which a Worker can speak (Apple's own push service wants HTTP/2). A Google service account
// signs its own short-lived token (RS256, WebCrypto), swapped for an access token that lasts an hour.

/** The service account's JSON, as Google gives it (FIREBASE_SERVICE_ACCOUNT): only these parts are used. */
interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

export interface Message {
  token: string;
  title: string;
  body: string;
  /** Where in the app tapping it goes. */
  path: string;
}

/** What Firebase said: sent, gone (the app was removed or the token replaced: forget the phone), or failed. */
export type Outcome = "sent" | "gone" | "failed";

const b64url = (bytes: Uint8Array | string) =>
  btoa(typeof bytes === "string" ? bytes : String.fromCharCode(...bytes))
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

async function signingKey(pem: string) {
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g, "")), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

// An access token lasts an hour: kept for this Worker instance's life, renewed five minutes early
let cached: { project: string; token: string; until: number } | null = null;

async function accessToken(account: ServiceAccount, now: number): Promise<string> {
  if (cached && cached.project === account.project_id && cached.until > now) return cached.token;
  const at = Math.floor(now / 1000);
  const claims = {
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: at,
    exp: at + 3600,
  };
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify(claims))}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    await signingKey(account.private_key),
    new TextEncoder().encode(unsigned),
  );
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${unsigned}.${b64url(new Uint8Array(signature))}`,
  });
  if (!res.ok) throw new Error(`Google said ${res.status} to the service account`);
  const { access_token, expires_in } = (await res.json()) as { access_token: string; expires_in: number };
  cached = { project: account.project_id, token: access_token, until: now + (expires_in - 300) * 1000 };
  return access_token;
}

/** Send each message (one request each: FCM has no batch send any more); what became of each, in the same order. */
export async function sendAll(serviceAccount: string, messages: Message[], now = Date.now()): Promise<Outcome[]> {
  const account = JSON.parse(serviceAccount) as ServiceAccount;
  const token = await accessToken(account, now);
  const url = `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`;
  return Promise.all(
    messages.map(async (m): Promise<Outcome> => {
      const res = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          message: {
            token: m.token,
            notification: { title: m.title, body: m.body },
            data: { path: m.path },
            apns: { payload: { aps: { sound: "default" } } },
          },
        }),
      });
      if (res.ok) return "sent";
      const error = (await res.json().catch(() => ({}))) as { error?: { details?: { errorCode?: string }[] } };
      const code = error.error?.details?.find((d) => d.errorCode)?.errorCode;
      return res.status === 404 || code === "UNREGISTERED" ? "gone" : "failed";
    }),
  );
}
