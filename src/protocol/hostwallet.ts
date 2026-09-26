/**
 * CatCard host-wallet commands: a computer asks for addresses or a signature, the person
 * holding the device decides on its screen, and the host polls for the outcome.
 *
 * Written from catcard's docs/USB.md, "Host-wallet commands". Every command travels
 * inside a paired ncry session; in the clear the device answers UnknownOpcode.
 */

export const Host = {
  Addresses: 0x0050,
  SignBegin: 0x0051,
  SignData: 0x0052,
  SignCommit: 0x0053,
  Result: 0x0054,
  Abort: 0x0055,
} as const;

export const HARDENED = 0x8000_0000;
export const MAX_DEPTH = 8;
export const MAX_KEYS = 32;
/** Sealed plaintext bound (1024) less the opcode and the offset. */
export const DATA_MAX = 1024 - 2 - 4;
const VERSION = 1;

export const Chain = {
  Bitcoin: 1,
  Ethereum: 2,
  Solana: 3,
  Litecoin: 4,
  Dogecoin: 5,
  BitcoinCash: 6,
  Monacoin: 7,
  Electra: 8,
  Tron: 9,
  Namecoin: 10,
} as const;

export const CHAIN_NAMES: Record<number, string> = {
  1: 'Bitcoin',
  2: 'Ethereum',
  3: 'Solana',
  4: 'Litecoin',
  5: 'Dogecoin',
  6: 'Bitcoin Cash',
  7: 'Monacoin',
  8: 'Electra Protocol',
  9: 'Tron',
  10: 'Namecoin',
};

/** Chains the device can sign for over USB; the others only share addresses. */
export const SIGNING_CHAINS = [Chain.Bitcoin, Chain.Ethereum, Chain.Solana] as const;

export const FORMAT_NAMES: Record<number, string> = {
  1: 'Legacy (P2PKH)',
  2: 'Nested SegWit (P2SH-P2WPKH)',
  3: 'Native SegWit (P2WPKH)',
  4: 'Taproot (P2TR)',
  5: 'EVM',
  6: 'Tron',
  7: 'Solana',
};

export const STAGE_TEXT: Record<number, string> = {
  0: 'nothing was asked',
  1: 'the upload is still open',
  2: 'waiting for the CatCard screen',
  3: 'the question is on the CatCard screen',
  4: 'the CatCard is busy with another computer',
};

export const BUSY_TEXT: Record<number, string> = {
  1: 'The CatCard is locked. Enter the PIN on it first.',
  2: 'The CatCard is busy with another request or an upgrade. Finish that first.',
};

// ---- paths -------------------------------------------------------------------------

export function parsePath(text: string): number[] {
  const parts = text.trim().split('/');
  if (parts[0] === 'm' || parts[0] === 'M') parts.shift();
  const steps = parts.map((p) => {
    const hard = /['hH]$/.test(p);
    const digits = hard ? p.slice(0, -1) : p;
    if (!/^\d+$/.test(digits)) throw new Error(`"${text}" is not a derivation path`);
    const n = Number(digits);
    if (n >= HARDENED) throw new Error(`path step ${p} is out of range`);
    return hard ? (n | HARDENED) >>> 0 : n;
  });
  if (steps.length < 1 || steps.length > MAX_DEPTH) throw new Error(`a path has 1 to ${MAX_DEPTH} steps`);
  return steps;
}

export function pathText(steps: readonly number[]): string {
  return `m/${steps.map((s) => (s & HARDENED ? `${(s & ~HARDENED) >>> 0}'` : `${s}`)).join('/')}`;
}

export function isUnder(path: readonly number[], account: readonly number[]): boolean {
  return path.length > account.length && account.every((s, i) => path[i] === s);
}

function encPath(steps: readonly number[]): Uint8Array {
  const b = new Uint8Array(1 + steps.length * 4);
  const v = new DataView(b.buffer);
  b[0] = steps.length;
  steps.forEach((s, i) => v.setUint32(1 + i * 4, s, true));
  return b;
}

// ---- layouts -----------------------------------------------------------------------

export function signBlob(chain: number, keys: readonly (readonly number[])[], tx: Uint8Array): Uint8Array {
  if (keys.length < 1 || keys.length > MAX_KEYS) throw new Error(`a request lists 1 to ${MAX_KEYS} keys`);
  if (!tx.length) throw new Error('the transaction is empty');
  const paths = keys.map(encPath);
  const out = new Uint8Array(3 + paths.reduce((n, p) => n + p.length, 0) + 4 + tx.length);
  out.set([VERSION, chain, keys.length], 0);
  let at = 3;
  for (const p of paths) {
    out.set(p, at);
    at += p.length;
  }
  new DataView(out.buffer).setUint32(at, tx.length, true);
  out.set(tx, at + 4);
  return out;
}

export class LayoutError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'LayoutError';
  }
}

class Reader {
  private at = 0;
  private readonly v: DataView;
  constructor(private readonly b: Uint8Array) {
    this.v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  take(n: number): Uint8Array {
    if (this.at + n > this.b.length) throw new LayoutError('the reply is truncated');
    const s = this.b.subarray(this.at, this.at + n);
    this.at += n;
    return s;
  }
  u8(): number {
    return this.take(1)[0]!;
  }
  u32(): number {
    this.take(4);
    return this.v.getUint32(this.at - 4, true);
  }
  path(): number[] {
    const d = this.u8();
    if (d < 1 || d > MAX_DEPTH) throw new LayoutError('bad path depth');
    return Array.from({ length: d }, () => this.u32());
  }
  short(): Uint8Array {
    return this.take(this.u8());
  }
  done(): void {
    if (this.at !== this.b.length) throw new LayoutError('the reply has trailing bytes');
  }
}

const ascii = new TextDecoder();
const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export interface AddressEntry {
  shape: 'utxo' | 'account';
  chain: number;
  format: number;
  accountPath: number[];
  addressPath: number[];
  /** The account's extended public key, UTXO chains only. */
  xpub: string;
  address: string;
  pubkey: string;
}

export interface AddressReply {
  fingerprint: string;
  account: number;
  entries: AddressEntry[];
}

export function decodeAddresses(r: Uint8Array): AddressReply {
  const rd = new Reader(r);
  if (rd.u8() !== 1 || rd.u8() !== VERSION) throw new LayoutError('not an address reply');
  const fingerprint = toHex(rd.take(4));
  const account = rd.u32();
  const n = rd.u8();
  const entries: AddressEntry[] = [];
  for (let i = 0; i < n; i++) {
    const shape = rd.u8();
    if (shape !== 1 && shape !== 2) throw new LayoutError('bad entry shape');
    const chain = rd.u8();
    const format = rd.u8();
    const accountPath = rd.path();
    const addressPath = rd.path();
    const xpub = shape === 1 ? ascii.decode(rd.short()) : '';
    const address = ascii.decode(rd.short());
    const pubkey = toHex(rd.short());
    entries.push({ shape: shape === 1 ? 'utxo' : 'account', chain, format, accountPath, addressPath, xpub, address, pubkey });
  }
  rd.done();
  return { fingerprint, account, entries };
}

export type SignResult =
  | { kind: 'bitcoin'; psbtVersion: number; psbt: Uint8Array; networkTx: Uint8Array }
  | { kind: 'evm'; tx: Uint8Array }
  | { kind: 'solana'; signatures: { slot: number; signature: Uint8Array }[]; tx: Uint8Array };

export function decodeSignResult(r: Uint8Array): SignResult {
  const rd = new Reader(r);
  const kind = rd.u8();
  let out: SignResult;
  if (kind === 2) {
    const psbtVersion = rd.u8();
    const psbt = rd.take(rd.u32());
    const networkTx = rd.take(rd.u32());
    out = { kind: 'bitcoin', psbtVersion, psbt, networkTx };
  } else if (kind === 3) {
    out = { kind: 'evm', tx: rd.take(rd.u32()) };
  } else if (kind === 4) {
    const n = rd.u8();
    const signatures = Array.from({ length: n }, () => ({ slot: rd.u8(), signature: rd.take(64) }));
    out = { kind: 'solana', signatures, tx: rd.take(rd.u32()) };
  } else throw new LayoutError('not a signing result');
  rd.done();
  return out;
}

// ---- flows -------------------------------------------------------------------------

/** One command inside the paired channel: (inner status, inner payload). */
export type Call = (opcode: number, payload?: Uint8Array) => Promise<{ status: number; body: Uint8Array }>;

const OK = 0;
const NOT_NOW = 2;
const DECLINED = 4;
const REFUSED = 5;

/** The device, or the person holding it, said no. The message is for a person to read. */
export class HostRefused extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'HostRefused';
  }
}

const reason = (b: Uint8Array) => ascii.decode(b).trim() || 'no reason given';
const u32le = (n: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
};

export interface Waiting {
  onStage?: (stage: number) => void;
  signal?: AbortSignal;
  pollMs?: number;
  /** Give up after this long without an answer. Default 15 minutes. */
  waitMs?: number;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('stopped waiting', 'AbortError'));
    });
  });

/** Polls HostResult until the person has answered, then pages the whole result in. */
export async function awaitResult(call: Call, w: Waiting = {}): Promise<Uint8Array> {
  const deadline = Date.now() + (w.waitMs ?? 15 * 60_000);
  let said: number | null = null;
  for (;;) {
    const { status, body } = await call(Host.Result, u32le(0));
    if (status === NOT_NOW) {
      const stage = body[0] ?? 0;
      if (stage !== said) {
        said = stage;
        w.onStage?.(stage);
      }
      if (stage === 0 || stage === 4) throw new HostRefused(`Nothing to fetch: ${STAGE_TEXT[stage]}.`);
      if (Date.now() > deadline) throw new HostRefused('Nobody answered on the CatCard.');
      await sleep(w.pollMs ?? 500, w.signal);
      continue;
    }
    if (status === DECLINED) throw new HostRefused('Declined on the CatCard.');
    if (status === REFUSED) throw new HostRefused(reason(body));
    if (status !== OK || body.length < 4) throw new Error(`unexpected reply to HostResult (status ${status})`);
    const total = new DataView(body.buffer, body.byteOffset).getUint32(0, true);
    const out = new Uint8Array(total);
    let got = Math.min(body.length - 4, total);
    out.set(body.subarray(4, 4 + got));
    while (got < total) {
      const page = await call(Host.Result, u32le(got));
      if (page.status !== OK) throw new Error(`a result page failed (status ${page.status})`);
      const bytes = page.body.subarray(4);
      if (!bytes.length) throw new Error('an empty result page before the end');
      const n = Math.min(bytes.length, total - got);
      out.set(bytes.subarray(0, n), got);
      got += n;
    }
    return out;
  }
}

function notNow(body: Uint8Array): string {
  return BUSY_TEXT[body[0] ?? 0] ?? 'The CatCard cannot take a question right now.';
}

export async function requestAddresses(call: Call, w: Waiting = {}): Promise<AddressReply> {
  const { status, body } = await call(Host.Addresses);
  if (status === NOT_NOW) throw new HostRefused(notNow(body));
  if (status !== OK) throw new Error(`unexpected reply to HostAddresses (status ${status})`);
  return decodeAddresses(await awaitResult(call, w));
}

export interface SignProgress {
  sent: number;
  total: number;
}

export async function requestSignature(
  call: Call,
  chain: number,
  keys: readonly (readonly number[])[],
  tx: Uint8Array,
  w: Waiting & { onUpload?: (p: SignProgress) => void; onQueued?: () => void } = {},
): Promise<SignResult> {
  const blob = signBlob(chain, keys, tx);
  const begin = new Uint8Array(5);
  begin[0] = chain;
  new DataView(begin.buffer).setUint32(1, blob.length, true);
  const b = await call(Host.SignBegin, begin);
  if (b.status === NOT_NOW) throw new HostRefused(notNow(b.body));
  if (b.status === REFUSED) throw new HostRefused(reason(b.body));
  if (b.status !== OK) throw new Error(`unexpected reply to HostSignBegin (status ${b.status})`);
  const offered = b.body.length >= 4 ? new DataView(b.body.buffer, b.body.byteOffset).getUint32(0, true) : DATA_MAX;
  const chunk = Math.max(1, Math.min(offered, DATA_MAX));
  let commit;
  try {
    for (let at = 0; at < blob.length; at += chunk) {
      const part = blob.subarray(at, Math.min(at + chunk, blob.length));
      const payload = new Uint8Array(4 + part.length);
      payload.set(u32le(at), 0);
      payload.set(part, 4);
      const d = await call(Host.SignData, payload);
      if (d.status !== OK) throw new Error(`the upload failed at byte ${at} (status ${d.status})`);
      w.onUpload?.({ sent: at + part.length, total: blob.length });
    }
    commit = await call(Host.SignCommit);
  } catch (err) {
    await call(Host.Abort).catch(() => undefined);
    throw err;
  }
  if (commit.status === REFUSED) throw new HostRefused(reason(commit.body));
  if (commit.status !== OK) throw new Error(`unexpected reply to HostSignCommit (status ${commit.status})`);
  w.onQueued?.();
  return decodeSignResult(await awaitResult(call, w));
}
