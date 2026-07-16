import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'crypto';

// Password/recovery-code hashing uses Node's built-in scrypt (no native argon2 dependency). The client
// auto-generates a high-entropy base64url password, so this is really a device-secret; scrypt still gives a
// salted, slow KDF that also holds up if a lower-entropy secret is ever introduced.
const SCRYPT_KEYLEN = 32;

// hashSecret -> "saltB64:keyB64". Used for the password and the recovery code.
export function hashSecret(secret: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(secret, salt, SCRYPT_KEYLEN);
  return `${salt.toString('base64')}:${key.toString('base64')}`;
}

// verifySecret constant-time compares a secret against a stored "salt:key". False on any malformed input.
export function verifySecret(secret: string, stored: string): boolean {
  const [saltB64, keyB64] = (stored ?? '').split(':');
  if (!saltB64 || !keyB64) return false;
  let expected: Buffer;
  try {
    expected = Buffer.from(keyB64, 'base64');
  } catch {
    return false;
  }
  if (expected.length === 0) return false;
  const key = scryptSync(secret, Buffer.from(saltB64, 'base64'), expected.length);
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// newToken: opaque, high-entropy, URL-safe bearer token (base64url so it's safe in `?token=`).
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

// hashToken: tokens are high-entropy, so sha256 (fast, one lookup) is sufficient at rest — a DB leak never
// exposes a usable token. (argon2/scrypt is reserved for the low-entropy human-password case.)
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// newRecoveryCode: one-time, URL-safe (~12 chars). Shown once on first claim; hashed at rest.
export function newRecoveryCode(): string {
  return randomBytes(9).toString('base64url');
}
