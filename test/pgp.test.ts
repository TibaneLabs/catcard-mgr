import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COINKITE_FINGERPRINT, COINKITE_KEY } from '../src/firmware/coinkite-key';
import { PgpError, readPublicKey, verifyClearsigned } from '../src/firmware/pgp';

const signed = readFileSync(new URL('./fixtures/coldcard-signatures.txt', import.meta.url), 'utf8');

describe('pinned Coinkite key', () => {
  it('has the fingerprint it is pinned under', async () => {
    const key = await readPublicKey(COINKITE_KEY);
    expect(key.fingerprint).toBe(COINKITE_FINGERPRINT);
    expect(key.n.length).toBe(256);
  });
});

describe('clearsigned signatures.txt', () => {
  it('verifies the real file and returns only the signed text', async () => {
    const key = await readPublicKey(COINKITE_KEY);
    const v = await verifyClearsigned(signed, key);
    expect(v.text).toMatch(/^[0-9a-f]{64} {2}README\.md\n/);
    expect(v.text).toContain('2026-09-03T1541-v5.6.2-mk-coldcard.dfu');
    expect(v.text).not.toContain('BEGIN PGP');
    expect(v.created?.toISOString()).toBe('2026-09-03T15:41:41.000Z');
  });

  it('also verifies with CRLF line ends', async () => {
    const key = await readPublicKey(COINKITE_KEY);
    await expect(verifyClearsigned(signed.replace(/\n/g, '\r\n'), key)).resolves.toBeTruthy();
  });

  it('refuses a changed checksum', async () => {
    const key = await readPublicKey(COINKITE_KEY);
    const tampered = signed.replace('49eb41b6b06c97f2', '49eb41b6b06c97f3');
    expect(tampered).not.toBe(signed);
    await expect(verifyClearsigned(tampered, key)).rejects.toThrow(/does not match/);
  });

  it('refuses an added line', async () => {
    const key = await readPublicKey(COINKITE_KEY);
    const tampered = signed.replace('  README.md\n', `  README.md\n${'0'.repeat(64)}  evil-coldcard.dfu\n`);
    await expect(verifyClearsigned(tampered, key)).rejects.toThrow(/does not match/);
  });

  it('refuses a damaged signature', async () => {
    const key = await readPublicKey(COINKITE_KEY);
    const tampered = signed.replace('FlNQJfHR5XU+', 'FlNQJfHR5XU/');
    await expect(verifyClearsigned(tampered, key)).rejects.toThrow(PgpError);
  });

  it('refuses a signature checked against another key', async () => {
    const key = await readPublicKey(COINKITE_KEY);
    const other = { ...key, fingerprint: '0'.repeat(40), n: key.n.map((b, i) => (i === 10 ? b ^ 1 : b)) };
    await expect(verifyClearsigned(signed, other)).rejects.toThrow(/different key/);
  });

  it('refuses a file with no signature', async () => {
    const key = await readPublicKey(COINKITE_KEY);
    await expect(verifyClearsigned(signed.slice(0, signed.indexOf('-----BEGIN PGP SIGNATURE')), key)).rejects.toThrow(/missing/);
  });
});
