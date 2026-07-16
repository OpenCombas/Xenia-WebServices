import {
  hashSecret,
  hashToken,
  newRecoveryCode,
  newToken,
  verifySecret,
} from './auth.crypto';

describe('auth.crypto', () => {
  it('hashes + verifies a secret, and rejects the wrong one', () => {
    const pw = newToken(); // a client-generated high-entropy password
    const stored = hashSecret(pw);
    expect(stored).toContain(':'); // salt:key
    expect(verifySecret(pw, stored)).toBe(true);
    expect(verifySecret(pw + 'x', stored)).toBe(false);
  });

  it('produces a distinct salt/hash each time (salted)', () => {
    const pw = 'same-secret';
    expect(hashSecret(pw)).not.toEqual(hashSecret(pw));
    // ...but both verify
    expect(verifySecret(pw, hashSecret(pw))).toBe(true);
  });

  it('rejects malformed stored values without throwing', () => {
    expect(verifySecret('x', '')).toBe(false);
    expect(verifySecret('x', 'no-colon')).toBe(false);
    expect(verifySecret('x', ':')).toBe(false);
  });

  it('tokens are URL-safe and hash deterministically', () => {
    const t = newToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, safe in ?token=
    expect(hashToken(t)).toEqual(hashToken(t));
    expect(hashToken(t)).not.toEqual(hashToken(newToken()));
  });

  it('recovery codes are URL-safe and unique', () => {
    const a = newRecoveryCode();
    const b = newRecoveryCode();
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a).not.toEqual(b);
  });
});
