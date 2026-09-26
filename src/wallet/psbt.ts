/**
 * Reads just enough of a PSBT (BIP-174, and BIP-370 for v2) to find which of this wallet's
 * keys it asks to sign: the derivation records whose fingerprint is the wallet's. The
 * device does its own full parse and review; this only saves a person typing paths.
 */

export class PsbtError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'PsbtError';
  }
}

const MAGIC = [0x70, 0x73, 0x62, 0x74, 0xff];

function fromBase64(text: string): Uint8Array | null {
  const t = text.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(t)) return null;
  try {
    return Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

function fromHex(text: string): Uint8Array | null {
  const t = text.replace(/\s+/g, '').replace(/^0x/i, '');
  if (!t.length || t.length % 2 || !/^[0-9a-fA-F]+$/.test(t)) return null;
  return Uint8Array.from(t.match(/../g)!, (b) => parseInt(b, 16));
}

const isPsbt = (b: Uint8Array) => b.length > 5 && MAGIC.every((m, i) => b[i] === m);

/** A PSBT from a file or pasted text: binary, base64 or hex. */
export function readPsbt(input: Uint8Array | string): Uint8Array {
  if (typeof input !== 'string') {
    if (isPsbt(input)) return input;
    input = new TextDecoder().decode(input);
  }
  for (const b of [fromBase64(input), fromHex(input)]) if (b && isPsbt(b)) return b;
  throw new PsbtError('This is not a PSBT. Give a .psbt file, or the PSBT as base64 or hex.');
}

class Cursor {
  at = 0;
  constructor(readonly b: Uint8Array) {}
  byte(): number {
    if (this.at >= this.b.length) throw new PsbtError('the PSBT is truncated');
    return this.b[this.at++]!;
  }
  take(n: number): Uint8Array {
    if (n < 0 || this.at + n > this.b.length) throw new PsbtError('the PSBT is truncated');
    const s = this.b.subarray(this.at, this.at + n);
    this.at += n;
    return s;
  }
  varint(): number {
    const f = this.byte();
    if (f < 0xfd) return f;
    const n = f === 0xfd ? 2 : f === 0xfe ? 4 : 8;
    const s = this.take(n);
    let v = 0;
    for (let i = n - 1; i >= 0; i--) v = v * 256 + s[i]!;
    if (!Number.isSafeInteger(v)) throw new PsbtError('a length in the PSBT is out of range');
    return v;
  }
}

interface Entry {
  type: number;
  keydata: Uint8Array;
  value: Uint8Array;
}

function readMap(c: Cursor): Entry[] {
  const out: Entry[] = [];
  for (;;) {
    const klen = c.varint();
    if (klen === 0) return out;
    const key = new Cursor(c.take(klen));
    const type = key.varint();
    const keydata = key.take(klen - key.at);
    const value = c.take(c.varint());
    out.push({ type, keydata, value });
  }
}

/** Input count of an unsigned transaction without witnesses, as PSBT v0 carries it. */
function txInputCount(tx: Uint8Array): number {
  const c = new Cursor(tx);
  c.take(4);
  return c.varint();
}

function u32path(b: Uint8Array): number[] {
  if (b.length % 4) throw new PsbtError('a derivation path in the PSBT has a bad length');
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return Array.from({ length: b.length / 4 }, (_, i) => v.getUint32(i * 4, true));
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export interface PsbtKeys {
  version: number;
  inputs: number;
  /** Distinct paths under `fingerprint`, in the order first seen. */
  paths: number[][];
  /** Inputs with no derivation record for this wallet. */
  foreignInputs: number;
}

export function walletKeys(psbt: Uint8Array, fingerprint: string): PsbtKeys {
  const c = new Cursor(psbt);
  c.take(5);
  const global = readMap(c);
  const ver = global.find((e) => e.type === 0xfb);
  const version = ver ? new DataView(ver.value.buffer, ver.value.byteOffset).getUint32(0, true) : 0;
  let inputs: number;
  if (version === 2) {
    const n = global.find((e) => e.type === 0x04);
    if (!n) throw new PsbtError('the PSBT v2 has no input count');
    inputs = new Cursor(n.value).varint();
  } else {
    const tx = global.find((e) => e.type === 0x00);
    if (!tx) throw new PsbtError('the PSBT has no unsigned transaction');
    inputs = txInputCount(tx.value);
  }
  const fp = fingerprint.toLowerCase();
  const seen = new Set<string>();
  const paths: number[][] = [];
  let foreignInputs = 0;
  for (let i = 0; i < inputs; i++) {
    let ours = false;
    for (const e of readMap(c)) {
      let origin: Uint8Array | null = null;
      if (e.type === 0x06) origin = e.value;
      else if (e.type === 0x16) {
        const v = new Cursor(e.value);
        const leaves = v.varint();
        v.take(32 * leaves);
        origin = v.take(e.value.length - v.at);
      }
      if (!origin || origin.length < 4 || hex(origin.subarray(0, 4)) !== fp) continue;
      ours = true;
      const path = u32path(origin.subarray(4));
      const k = path.join('/');
      if (path.length && !seen.has(k)) {
        seen.add(k);
        paths.push(path);
      }
    }
    if (!ours) foreignInputs++;
  }
  return { version, inputs, paths, foreignInputs };
}
