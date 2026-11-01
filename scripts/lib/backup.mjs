// Seal and open a database backup (ADR 0106). A backup is a D1 export, members' names and emails included, and it's
// kept as a GitHub artifact on a public repo, so it's compressed and then encrypted with the environment's BACKUP_KEY
// (AES-256-GCM, the key stretched with scrypt and a fresh salt each time). GCM also notices a changed byte.
// Layout: "CGBK1" | salt (16) | iv (12) | tag (16) | ciphertext.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

const MAGIC = Buffer.from("CGBK1");
const keyFrom = (secret, salt) => {
  if (!secret) throw new Error("No BACKUP_KEY: run through scripts/env-pull.mjs (docs/secrets.md#backup_key).");
  return scryptSync(secret, salt, 32);
};

/** @param {string} sql @param {string} secret @returns {Buffer} */
export function seal(sql, secret) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret, salt), iv);
  const body = Buffer.concat([cipher.update(gzipSync(sql)), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body]);
}

/** @param {Buffer} sealed @param {string} secret @returns {string} */
export function open(sealed, secret) {
  if (!sealed.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("That's not a backup (no CGBK1 header).");
  let at = MAGIC.length;
  const take = (n) => sealed.subarray(at, (at += n));
  const salt = take(16);
  const iv = take(12);
  const tag = take(16);
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(secret, salt), iv);
  decipher.setAuthTag(tag);
  try {
    return gunzipSync(Buffer.concat([decipher.update(sealed.subarray(at)), decipher.final()])).toString("utf8");
  } catch {
    throw new Error("Can't open this backup: the wrong key for its environment, or the file has been changed.");
  }
}
