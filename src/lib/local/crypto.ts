/**
 * Password hashing for the self-contained prototype.
 *
 * WHY THIS EXISTS
 *
 * The local store originally kept the password itself on the user row and
 * compared it with `user.password !== password`. Every password therefore sat in
 * plain text in localStorage, readable by anyone with devtools or a stolen
 * laptop, and it leaked into anything that stringified a user row.
 *
 * WHAT THIS IS, HONESTLY
 *
 * A salted, iterated SHA-256. It removes the plain-text credential and makes an
 * offline guess meaningfully more expensive. It is NOT a substitute for a real
 * password hash (argon2/scrypt/bcrypt) and it is NOT server-grade security: there
 * is no server, so anyone who can read the database still has everything. It
 * protects against casual exposure, not a determined attacker.
 *
 * Pure TypeScript rather than Web Crypto because the store must hash
 * synchronously in the browser AND under the Node test harness, where
 * `crypto.subtle` does not exist.
 */

/** Iterations. Kept modest: this runs on every sign-in on the browser main
 *  thread, and the threat model is casual exposure, not an offline cracking rig.
 *  Raise it if this ever moves behind a real server. */
const ITERATIONS = 1200;

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
  0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
  0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
  0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
  0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
  0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/** SHA-256 over raw bytes, returned as raw bytes. */
function sha256Bytes(input: Uint8Array): Uint8Array {
  const bitLen = input.length * 8;
  const padded = new Uint8Array(((input.length + 9 + 63) >> 6) << 6);
  padded.set(input);
  padded[input.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, bitLen >>> 0, false);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000), false);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
    0x5be0cd19,
  ]);
  const w = new Uint32Array(64);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h[0];
    let b = h[1];
    let c = h[2];
    let d = h[3];
    let e = h[4];
    let f = h[5];
    let g = h[6];
    let hh = h[7];

    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i += 1) outView.setUint32(i * 4, h[i], false);
  return out;
}

function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

const encoder = new TextEncoder();

/** Raw SHA-256 hex of a string. Exported so the suite can check test vectors. */
export function sha256Hex(text: string): string {
  return toHex(sha256Bytes(encoder.encode(text)));
}

/** A fresh random salt, as hex. Uses the platform CSPRNG when available. */
export function newSalt(): string {
  const bytes = new Uint8Array(16);
  const c =
    typeof globalThis !== "undefined"
      ? (globalThis.crypto as Crypto | undefined)
      : undefined;
  if (c && typeof c.getRandomValues === "function") {
    c.getRandomValues(bytes);
  } else {
    // Only reached where Web Crypto is absent. Still unpredictable enough for
    // this prototype's threat model; never used in a real browser.
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return toHex(bytes);
}

function derive(password: string, salt: string, iterations: number): Uint8Array {
  // Annotated explicitly: TextEncoder yields Uint8Array<ArrayBuffer> while
  // sha256Bytes is inferred as the wider ArrayBufferLike, and mixing the two
  // generic forms is a type error on recent TypeScript.
  let digest: Uint8Array = encoder.encode(`${salt} ${password}`);
  for (let i = 0; i < iterations; i += 1) digest = sha256Bytes(digest);
  return digest;
}

/**
 * Salted, iterated SHA-256 of a password.
 *
 * The stored string carries its own salt and iteration count, so the work factor
 * can be raised later without invalidating anyone who has not signed in since.
 */
export function hashPassword(
  password: string,
  salt: string,
  iterations = ITERATIONS,
): string {
  return `s2$${iterations}$${salt}$${toHex(derive(password, salt, iterations))}`;
}

/** Compares two hex strings without an early exit on the first difference. */
export function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verifies a password against a stored hash. Returns false for a malformed hash
 * rather than throwing, so a corrupt row fails closed instead of crashing.
 */
export function verifyPassword(
  password: string,
  stored: string | null | undefined,
): boolean {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "s2") return false;
  const iterations = Number(parts[1]);
  const [, , salt, expected] = parts;
  if (!Number.isInteger(iterations) || iterations < 1 || !salt || !expected) return false;
  return constantTimeEquals(toHex(derive(password, salt, iterations)), expected);
}

/** Salt + hash for a known password, for seeding a fixed demo account. */
export function makeCredential(password: string): {
  password_salt: string;
  password_hash: string;
} {
  const password_salt = newSalt();
  return { password_salt, password_hash: hashPassword(password, password_salt) };
}

