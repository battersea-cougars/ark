// Passkeys in the app (ADR 0023): adding one on the You page, signing in with one, and the one offer after a code
// sign-in. The device does the work (navigator.credentials, through @simplewebauthn/browser); the Worker checks it
// (worker/auth/auth.passkeys.ts). In the iPhone app it's the same web page in WKWebView, which may use the team
// domain's passkeys once the app's entitlement and the domain's apple-app-site-association agree (store.links.ts).
import {
  WebAuthnAbortService,
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { api } from "./api";

export interface Passkey {
  id: number;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** This browser can use passkeys at all (a secure page with WebAuthn: not a LAN address over http). */
export const passkeysWork = () => isSecureContext && browserSupportsWebAuthn();

/** What the device checks you with, for the button: "Face ID" on an iPhone, "Windows Hello" on Windows. */
export function checkName(ua = navigator.userAgent): string {
  if (/iPhone|iPad/.test(ua)) return "Face ID";
  if (/Macintosh/.test(ua)) return "Touch ID";
  if (/Android/.test(ua)) return "your fingerprint";
  if (/Windows/.test(ua)) return "Windows Hello";
  return "a passkey";
}

/** Whether the device didn't go through with it (cancelled, timed out, no passkey): nothing to apologise for. */
const declined = (e: unknown) =>
  e instanceof Error && ["NotAllowedError", "AbortError"].includes((e as Error & { name: string }).name);

// ─── Signing in ───

/**
 * Sign in with a passkey. `autofill`: wait quietly for one picked from the email field's suggestions (conditional
 * mediation), where the browser has it; otherwise the device's own sheet, now. True once signed in; false if the
 * device didn't go ahead. Throws the club's reason when it refused.
 */
export async function signInWithPasskey(autofill = false): Promise<boolean> {
  if (autofill && !(await browserSupportsWebAuthnAutofill())) return false;
  const { options } = await api<{ options: PublicKeyCredentialRequestOptionsJSON }>(
    "POST",
    "/api/auth/passkeys/sign-in-options",
    {},
  );
  let response;
  try {
    response = await startAuthentication({ optionsJSON: options, useBrowserAutofill: autofill });
  } catch (e) {
    if (declined(e)) return false;
    throw e;
  }
  const res = await fetch("/api/auth/passkeys/sign-in", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ response }),
  });
  if (res.ok) return true;
  const why = (await res.json().catch(() => ({}))) as { error?: string; unknownCredential?: boolean };
  // A passkey the club no longer has (removed on the You page or by an admin): the device is told, so it stops offering it
  if (why.unknownCredential) await forgetHere(options.rpId, response.id);
  throw new Error(why.error ?? "That passkey didn't work. Sign in with a code.");
}

/** Stop waiting for an autofilled passkey (the member chose another way). */
export const stopWaiting = () => WebAuthnAbortService.cancelCeremony();

async function forgetHere(rpId: string | undefined, credentialId: string) {
  const signal = (PublicKeyCredential as unknown as { signalUnknownCredential?: (o: object) => Promise<void> })
    .signalUnknownCredential;
  await signal?.call(PublicKeyCredential, { rpId: rpId ?? location.hostname, credentialId }).catch(() => {});
}

// ─── Your passkeys ───

export const myPasskeys = async () => (await api<{ passkeys: Passkey[] }>("GET", "/api/auth/passkeys")).passkeys;

/** Add one on this device: the club's options, the device's face check, and it's kept. False if the device didn't. */
export async function addPasskey(): Promise<Passkey[] | null> {
  const { options } = await api<{ options: PublicKeyCredentialCreationOptionsJSON }>(
    "POST",
    "/api/auth/passkeys/register-options",
    {},
  );
  let response;
  try {
    response = await startRegistration({ optionsJSON: options });
  } catch (e) {
    if (declined(e)) return null;
    if (e instanceof Error && e.name === "InvalidStateError")
      throw new Error("This device has a passkey here already.", { cause: e });
    throw e;
  }
  const { passkeys } = await api<{ passkeys: Passkey[] }>("POST", "/api/auth/passkeys/register", { response });
  remember(ADDED);
  return passkeys;
}

export const removePasskey = (id: number) => api("DELETE", `/api/auth/passkeys/${id}`);

// ─── The one offer, after a code sign-in ───

const OFFER = "cougars.passkey.offer";
const ADDED = "cougars.passkey.added";
const DONE = "cougars.passkey.offered";
const remember = (key: string, value = "1") => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // A private window: it may ask again
  }
};
const recall = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

/** Signed in with a code: the next Home may offer a passkey, once, on a device that has none here. */
export function signedInWithCode() {
  if (!recall(ADDED) && !recall(DONE)) remember(OFFER);
}

/** Whether Home offers "Use Face ID next time": after a code sign-in, once, where the device can make a passkey. */
export async function mayOfferPasskey(): Promise<boolean> {
  if (recall(OFFER) !== "1" || recall(ADDED) || recall(DONE) || !passkeysWork()) return false;
  return platformAuthenticatorIsAvailable().catch(() => false);
}

/** Offered: added, or "Not now". It isn't asked again on this device. */
export function offered() {
  remember(DONE);
  try {
    localStorage.removeItem(OFFER);
  } catch {
    // as above
  }
}
