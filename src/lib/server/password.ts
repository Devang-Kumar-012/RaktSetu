/**
 * Password hashing, server-side only.
 *
 * Uses scrypt from Node's built-in `node:crypto` — a memory-hard KDF designed
 * exactly for this, so RaktSetu needs no native bcrypt/argon2 dependency.
 *
 * Storage format: scrypt$<N>$<r>$<p>$<saltHex>$<hashHex>
 * The parameters are stored alongside the hash so they can be raised later
 * without invalidating existing passwords.
 *
 * The plaintext password is never returned, logged or persisted.
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const N = 16384; // CPU/memory cost
const R = 8; // block size
const P = 1; // parallelisation
const KEYLEN = 64;
const SALT_BYTES = 16;

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(SALT_BYTES);
  const derived = scryptSync(password.normalize("NFKC"), salt, KEYLEN, {
    N,
    r: R,
    p: P,
    // scrypt needs roughly 128 * N * r bytes; the default cap is too low.
    maxmem: 128 * N * R * 2,
  });
  return {
    // The stored value carries the parameters so verification can use them.
    hash: `scrypt$${N}$${R}$${P}$${salt.toString("hex")}$${derived.toString("hex")}`,
    salt: salt.toString("hex"),
  };
}

export function verifyPassword(
  password: string,
  stored: string
): boolean {
  try {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const [, n, r, p, saltHex, hashHex] = parts;
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const derived = scryptSync(password.normalize("NFKC"), salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 128 * Number(n) * Number(r) * 2,
    });
    // Constant-time compare: never leak how much of the hash matched.
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
