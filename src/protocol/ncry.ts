/**
 * CatCard's encrypted channel, ncry v2, host side: paired by a six-digit code that a
 * person compares on both screens, afresh on every connection.
 *
 * Written from catcard's docs/USB.md; checked against the vector the firmware's unit
 * tests and tools/ncry.py share (code 398 660), so the implementations cannot drift.
 *
 *   PairCommit  SHA-256("catcard-pair-v2/commit" ‖ host_pub)   -> device_pub
 *   PairReveal  host_pub                                        -> (empty)
 *   T = commit ‖ device_pub ‖ host_pub
 *   keys = HKDF-SHA256(salt T, ikm X25519, "catcard-ncry-v2", 64): host→device, device→host
 *   code = HKDF-SHA256(salt T, ikm X25519, "catcard-pair-v2/code", 8) as big-endian u64 mod 10^6
 *   record = ChaCha20-Poly1305(key, nonce = u64 LE counter ‖ 4 zero bytes, no AAD)
 */
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

const enc = new TextEncoder();
const INFO = enc.encode('catcard-ncry-v2');
const COMMIT_LABEL = enc.encode('catcard-pair-v2/commit');
const CODE_INFO = enc.encode('catcard-pair-v2/code');
export const KEY_LEN = 32;
export const TAG_LEN = 16;

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function commitment(hostPub: Uint8Array): Uint8Array {
  return sha256(concat(COMMIT_LABEL, hostPub));
}

/** Six digits, zero padded, grouped as both screens show them: `123 456`. */
export function codeText(code: number): string {
  const s = code.toString().padStart(6, '0');
  return `${s.slice(0, 3)} ${s.slice(3)}`;
}

function nonce(counter: bigint): Uint8Array {
  const n = new Uint8Array(12);
  new DataView(n.buffer).setBigUint64(0, counter, true);
  return n;
}

export class NcryError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'NcryError';
  }
}

/** One end of an established channel. Every failure is final: open a new session. */
export class Session {
  private sendCtr = 0n;
  private recvCtr = 0n;
  private broken = false;

  constructor(
    private readonly sendKey: Uint8Array,
    private readonly recvKey: Uint8Array,
    readonly code: number,
  ) {}

  seal(plaintext: Uint8Array): Uint8Array {
    if (this.broken) throw new NcryError('the encrypted session has ended');
    const out = chacha20poly1305(this.sendKey, nonce(this.sendCtr)).encrypt(plaintext);
    this.sendCtr++;
    return out;
  }

  open(record: Uint8Array): Uint8Array {
    if (this.broken) throw new NcryError('the encrypted session has ended');
    if (record.length < TAG_LEN) {
      this.broken = true;
      throw new NcryError('short record');
    }
    try {
      const out = chacha20poly1305(this.recvKey, nonce(this.recvCtr)).decrypt(record);
      this.recvCtr++;
      return out;
    } catch {
      this.broken = true;
      throw new NcryError('a reply from the device did not authenticate');
    }
  }
}

/** The host's half of the handshake: commit first, reveal once the device has answered. */
export class Initiator {
  readonly public: Uint8Array;
  readonly commit: Uint8Array;

  constructor(private readonly priv: Uint8Array = x25519.utils.randomSecretKey()) {
    this.public = x25519.getPublicKey(priv);
    this.commit = commitment(this.public);
  }

  finish(devicePub: Uint8Array): Session {
    if (devicePub.length !== KEY_LEN) throw new NcryError('the device key has the wrong length');
    const dh = x25519.getSharedSecret(this.priv, devicePub);
    if (dh.every((b) => b === 0)) throw new NcryError('the device key is not usable');
    const transcript = concat(this.commit, devicePub, this.public);
    const okm = hkdf(sha256, dh, transcript, INFO, 64);
    const c = hkdf(sha256, dh, transcript, CODE_INFO, 8);
    const code = Number(new DataView(c.buffer, c.byteOffset, 8).getBigUint64(0, false) % 1_000_000n);
    // The host sends on initiator→responder and receives on responder→initiator.
    return new Session(okm.slice(0, 32), okm.slice(32, 64), code);
  }
}

/** The device's half, for tests only: check the reveal, derive its session. */
export function responder(priv: Uint8Array, commit: Uint8Array, hostPub: Uint8Array): { devicePub: Uint8Array; session: Session } {
  const expect = commitment(hostPub);
  if (!expect.every((b, i) => b === commit[i])) throw new NcryError('the reveal does not match the commitment');
  const devicePub = x25519.getPublicKey(priv);
  const dh = x25519.getSharedSecret(priv, hostPub);
  const transcript = concat(commit, devicePub, hostPub);
  const okm = hkdf(sha256, dh, transcript, INFO, 64);
  const c = hkdf(sha256, dh, transcript, CODE_INFO, 8);
  const code = Number(new DataView(c.buffer, c.byteOffset, 8).getBigUint64(0, false) % 1_000_000n);
  return { devicePub, session: new Session(okm.slice(32, 64), okm.slice(0, 32), code) };
}
