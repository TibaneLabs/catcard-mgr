/**
 * Just enough OpenPGP (RFC 4880) to check a clearsigned text against one pinned RSA key.
 *
 * What it accepts is deliberately narrow: a v4 public key packet using RSA, and a single
 * v4 signature of type 0x01 (canonical text) made with RSA over SHA-256, SHA-384 or
 * SHA-512. Anything else is refused. The cryptography itself is WebCrypto's
 * RSASSA-PKCS1-v1_5; this file only locates the bytes to hand it.
 */

export class PgpError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'PgpError';
  }
}

function base64(text: string): Uint8Array {
  const bin = atob(text.replace(/\s+/g, ''));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The body of an ASCII-armored block of the given kind, without the CRC line. */
export function dearmor(text: string, kind: string): Uint8Array {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === `-----BEGIN ${kind}-----`);
  const end = lines.findIndex((l, i) => i > start && l.trim() === `-----END ${kind}-----`);
  if (start < 0 || end < 0) throw new PgpError(`no ${kind.toLowerCase()} block`);
  let i = start + 1;
  // Armor headers ("Comment: ...") run to the first blank line.
  while (i < end && lines[i]!.trim() !== '') i++;
  const body = lines.slice(i + 1, end).filter((l) => !/^=[A-Za-z0-9+/]{4}$/.test(l.trim()));
  return base64(body.join(''));
}

interface Packet {
  tag: number;
  body: Uint8Array;
}

export function packets(data: Uint8Array): Packet[] {
  const out: Packet[] = [];
  let at = 0;
  while (at < data.length) {
    const h = data[at++]!;
    if (!(h & 0x80)) throw new PgpError('bad packet header');
    let tag: number;
    let len: number;
    if (h & 0x40) {
      tag = h & 0x3f;
      const o = data[at++]!;
      if (o < 192) len = o;
      else if (o < 224) len = ((o - 192) << 8) + data[at++]! + 192;
      else if (o === 255) {
        len = ((data[at]! << 24) | (data[at + 1]! << 16) | (data[at + 2]! << 8) | data[at + 3]!) >>> 0;
        at += 4;
      } else throw new PgpError('partial-length packets are not supported');
    } else {
      tag = (h >> 2) & 0x0f;
      const lt = h & 0x03;
      if (lt === 0) len = data[at++]!;
      else if (lt === 1) {
        len = (data[at]! << 8) | data[at + 1]!;
        at += 2;
      } else if (lt === 2) {
        len = ((data[at]! << 24) | (data[at + 1]! << 16) | (data[at + 2]! << 8) | data[at + 3]!) >>> 0;
        at += 4;
      } else throw new PgpError('indeterminate-length packets are not supported');
    }
    if (at + len > data.length) throw new PgpError('packet runs past the end');
    out.push({ tag, body: data.subarray(at, at + len) });
    at += len;
  }
  return out;
}

/** A multiprecision integer: u16 bit count, then the bytes. Returns it and where it ends. */
function mpi(b: Uint8Array, at: number): [Uint8Array, number] {
  if (at + 2 > b.length) throw new PgpError('truncated number');
  const bits = (b[at]! << 8) | b[at + 1]!;
  const n = (bits + 7) >> 3;
  if (at + 2 + n > b.length) throw new PgpError('truncated number');
  return [b.subarray(at + 2, at + 2 + n), at + 2 + n];
}

export interface RsaPublicKey {
  fingerprint: string;
  n: Uint8Array;
  e: Uint8Array;
}

/** Reads the primary key of an armored public key block, and computes its fingerprint. */
export async function readPublicKey(armored: string): Promise<RsaPublicKey> {
  const first = packets(dearmor(armored, 'PGP PUBLIC KEY BLOCK'))[0];
  if (!first || first.tag !== 6) throw new PgpError('the key block does not start with a public key');
  const b = first.body;
  if (b[0] !== 4) throw new PgpError('only v4 keys are supported');
  // [0] version, [1..5] creation time, [5] algorithm: 1 RSA, 3 RSA sign-only.
  if (b[5] !== 1 && b[5] !== 3) throw new PgpError('only RSA keys are supported');
  const [n, at] = mpi(b, 6);
  const [e] = mpi(b, at);
  // v4 fingerprint: SHA-1 over 0x99, the two-byte body length, and the body.
  const framed = new Uint8Array(3 + b.length);
  framed[0] = 0x99;
  framed[1] = b.length >> 8;
  framed[2] = b.length & 0xff;
  framed.set(b, 3);
  const fingerprint = hex(new Uint8Array(await crypto.subtle.digest('SHA-1', framed)));
  return { fingerprint, n, e };
}

const HASHES: Record<number, string> = { 8: 'SHA-256', 9: 'SHA-384', 10: 'SHA-512' };

export interface VerifiedText {
  /** The signed text, with `\n` line ends, exactly as covered by the signature. */
  text: string;
  created: Date | null;
}

/**
 * Checks a clearsigned message (RFC 4880 §7) against `key`, and returns the text the
 * signature covers. Only that text may be trusted: anything outside it in the file is not
 * signed.
 */
export async function verifyClearsigned(message: string, key: RsaPublicKey): Promise<VerifiedText> {
  const lines = message.split(/\r?\n/);
  const begin = lines.findIndex((l) => l.trim() === '-----BEGIN PGP SIGNED MESSAGE-----');
  if (begin < 0) throw new PgpError('not a clearsigned message');
  let i = begin + 1;
  while (i < lines.length && lines[i] !== '') {
    if (!/^Hash: /.test(lines[i]!)) throw new PgpError(`unexpected header line "${lines[i]}"`);
    i++;
  }
  const sigAt = lines.findIndex((l, k) => k > i && l.trim() === '-----BEGIN PGP SIGNATURE-----');
  if (sigAt < 0) throw new PgpError('the signature is missing');
  // The line break before the signature block belongs to the armor, not the text.
  const textLines = lines.slice(i + 1, sigAt).map((l) => (l.startsWith('- ') ? l.slice(2) : l));
  const canonical = textLines.map((l) => l.replace(/[ \t]+$/, '')).join('\r\n');

  const sigs = packets(dearmor(lines.slice(sigAt).join('\n'), 'PGP SIGNATURE')).filter((p) => p.tag === 2);
  if (sigs.length !== 1) throw new PgpError(`expected one signature, found ${sigs.length}`);
  const s = sigs[0]!.body;
  if (s[0] !== 4) throw new PgpError('only v4 signatures are supported');
  if (s[1] !== 0x01) throw new PgpError('not a text signature');
  if (s[2] !== 1 && s[2] !== 3) throw new PgpError('not an RSA signature');
  const hash = HASHES[s[3]!];
  if (!hash) throw new PgpError(`unsupported hash algorithm ${s[3]}`);
  const hashedLen = (s[4]! << 8) | s[5]!;
  const hashedEnd = 6 + hashedLen;
  const unhashedLen = (s[hashedEnd]! << 8) | s[hashedEnd + 1]!;
  const unhashedEnd = hashedEnd + 2 + unhashedLen;
  if (unhashedEnd + 2 > s.length) throw new PgpError('truncated signature');
  const [sigValue] = mpi(s, unhashedEnd + 2);

  // Subpackets: creation time (2), issuer key ID (16), issuer fingerprint (33).
  let created: Date | null = null;
  const issuers: string[] = [];
  const walk = (from: number, to: number) => {
    let at = from;
    while (at < to) {
      let len = s[at++]!;
      if (len >= 192 && len < 255) len = ((len - 192) << 8) + s[at++]! + 192;
      else if (len === 255) {
        len = ((s[at]! << 24) | (s[at + 1]! << 16) | (s[at + 2]! << 8) | s[at + 3]!) >>> 0;
        at += 4;
      }
      const type = s[at]! & 0x7f;
      const data = s.subarray(at + 1, at + len);
      if (type === 2 && data.length === 4) created = new Date((((data[0]! << 24) | (data[1]! << 16) | (data[2]! << 8) | data[3]!) >>> 0) * 1000);
      if (type === 16 && data.length === 8) issuers.push(hex(data));
      if (type === 33 && data.length === 21 && data[0] === 4) issuers.push(hex(data.subarray(1)));
      at += len;
    }
  };
  walk(6, hashedEnd);
  walk(hashedEnd + 2, unhashedEnd);
  const fp = key.fingerprint;
  if (issuers.length && !issuers.every((id) => fp.endsWith(id))) {
    throw new PgpError('the message was signed by a different key');
  }

  // Signed data: the text, the hashed part of the signature packet, then a trailer.
  const text = new TextEncoder().encode(canonical);
  const data = new Uint8Array(text.length + hashedEnd + 6);
  data.set(text, 0);
  data.set(s.subarray(0, hashedEnd), text.length);
  const t = text.length + hashedEnd;
  data[t] = 0x04;
  data[t + 1] = 0xff;
  new DataView(data.buffer).setUint32(t + 2, hashedEnd, false);

  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    { kty: 'RSA', n: b64url(key.n), e: b64url(key.e), ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash },
    false,
    ['verify'],
  );
  // WebCrypto wants the signature exactly as long as the modulus.
  const sig = new Uint8Array(key.n.length);
  if (sigValue.length > sig.length) throw new PgpError('signature longer than the key');
  sig.set(sigValue, sig.length - sigValue.length);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, sig, data);
  if (!ok) throw new PgpError('the signature does not match');
  return { text: textLines.join('\n'), created };
}
