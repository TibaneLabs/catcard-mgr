/**
 * Stock Coldcard USB protocol, host side.
 *
 * Every 64-byte report carries a one-byte header and up to 63 bytes of message:
 *
 *   header = length (bits 0..5) | 0x80 if this is the last packet | 0x40 if encrypted
 *
 * A message is a four-character ASCII command followed by its arguments; a reply is a
 * four-character tag followed by its data. Only the unencrypted subset is implemented.
 */
import { Serial, type Transport } from './transport';

export const COLDCARD_VID = 0xd13e;
export const COLDCARD_PID = 0xcc10;

export const REPORT_LEN = 64;
export const PACKET_PAYLOAD = 63;
export const FLAG_LAST = 0x80;
export const FLAG_ENCRYPTED = 0x40;
export const LEN_MASK = 0x3f;
/** Largest message the device accepts: 4-byte command + two u32 + a 2048-byte block. */
export const MAX_MSG_LEN = 4 + 4 + 4 + 2048;

const enc = new TextEncoder();
const ascii = new TextDecoder('ascii');
const utf8 = new TextDecoder('utf-8', { fatal: false });

export function encodePackets(msg: Uint8Array): Uint8Array[] {
  if (msg.length < 4 || msg.length > MAX_MSG_LEN) {
    throw new RangeError(`message length ${msg.length} out of range 4..${MAX_MSG_LEN}`);
  }
  const packets: Uint8Array[] = [];
  let at = 0;
  do {
    const n = Math.min(PACKET_PAYLOAD, msg.length - at);
    const p = new Uint8Array(REPORT_LEN);
    p[0] = n | (at + n === msg.length ? FLAG_LAST : 0);
    p.set(msg.subarray(at, at + n), 1);
    packets.push(p);
    at += n;
  } while (at < msg.length);
  return packets;
}

export class ColdcardFramingError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'ColdcardFramingError';
  }
}

/** Reassembles a reply from its packets; returns the message once the last one is in. */
export class ReplyDecoder {
  private chunks: Uint8Array[] = [];

  feed(report: Uint8Array): Uint8Array | null {
    const flag = report[0] ?? 0;
    const n = flag & LEN_MASK;
    if (flag & FLAG_ENCRYPTED) throw new ColdcardFramingError('encrypted reply, but no session was negotiated');
    this.chunks.push(report.subarray(1, 1 + n));
    if (!(flag & FLAG_LAST)) return null;
    const out = new Uint8Array(this.chunks.reduce((s, c) => s + c.length, 0));
    let at = 0;
    for (const c of this.chunks) {
      out.set(c, at);
      at += c.length;
    }
    this.chunks = [];
    return out;
  }
}

export class ColdcardError extends Error {
  constructor(
    readonly tag: string,
    readonly detail: string,
  ) {
    super(detail ? `${describeTag(tag)}: ${detail}` : describeTag(tag));
    this.name = 'ColdcardError';
  }
}

function describeTag(tag: string): string {
  switch (tag) {
    case 'err_':
      return 'Coldcard error';
    case 'fram':
      return 'Framing error';
    case 'refu':
      return 'Refused on the device';
    case 'busy':
      return 'The Coldcard is busy with another request';
    default:
      return `Unexpected reply tag "${tag}"`;
  }
}

export type Decoded =
  | { tag: 'okay' }
  | { tag: 'biny'; data: Uint8Array }
  | { tag: 'asci'; text: string }
  | { tag: 'int1'; values: [number] }
  | { tag: 'int2'; values: [number, number] }
  | { tag: 'int3'; values: [number, number, number] }
  | { tag: 'mypb'; pubkey: Uint8Array; fingerprint: number; xpub: string };

/** Decodes a reply message by its tag; error tags throw a `ColdcardError`. */
export function decodeReply(msg: Uint8Array): Decoded {
  if (msg.length < 4) throw new ColdcardFramingError(`reply too short: ${msg.length} bytes`);
  const tag = ascii.decode(msg.subarray(0, 4));
  const rest = msg.subarray(4);
  const v = new DataView(rest.buffer, rest.byteOffset, rest.byteLength);
  switch (tag) {
    case 'okay':
      return { tag };
    case 'biny':
      return { tag, data: rest };
    case 'asci':
      return { tag, text: ascii.decode(rest) };
    case 'int1':
      return { tag, values: [v.getUint32(0, true)] };
    case 'int2':
      return { tag, values: [v.getUint32(0, true), v.getUint32(4, true)] };
    case 'int3':
      return { tag, values: [v.getUint32(0, true), v.getUint32(4, true), v.getUint32(8, true)] };
    case 'mypb': {
      const pubkey = rest.subarray(0, 64);
      const fingerprint = v.getUint32(64, true);
      const xpubLen = v.getUint32(68, true);
      const xpub = xpubLen ? ascii.decode(rest.subarray(rest.length - xpubLen)) : '';
      return { tag, pubkey, fingerprint, xpub };
    }
    case 'err_':
    case 'fram':
      throw new ColdcardError(tag, utf8.decode(rest));
    case 'refu':
    case 'busy':
      throw new ColdcardError(tag, '');
    default:
      throw new ColdcardError(tag, '');
  }
}

export interface ColdcardVersion {
  /** Build date, e.g. `2025-11-03`. */
  date: string;
  /** Firmware version, e.g. `5.4.5`. Edge builds end in `X`. */
  version: string;
  /** True for an Edge (experimental) build. */
  edge: boolean;
  /** Bootloader version, when the reply carries one. */
  bootloader: string | null;
  /** Hardware label if the reply carries one (`mk3`, `mk4`, `q1`, ...). */
  hardware: string | null;
  /** Every line, as sent: later firmware may append more. */
  lines: string[];
}

/**
 * The `vers` reply is newline-separated. The first two lines are the build date and the
 * version, which is what host tools rely on (an Edge build is one whose version ends in
 * `X`). Later lines vary between firmware generations, so they are matched by shape
 * rather than by position, and all of them are kept for display.
 */
export function parseVersion(text: string): ColdcardVersion {
  const lines = text.replace(/\n+$/, '').split('\n');
  const version = lines[1] ?? '';
  const rest = lines.slice(2).map((l) => l.trim());
  const hardware = rest.find((l) => /^(mk\d+|q\d+)$/i.test(l)) ?? null;
  const bootloader = rest.find((l) => /^\d+\.\d+\.\d+$/.test(l)) ?? null;
  return {
    date: lines[0] ?? '',
    version,
    edge: version.endsWith('X'),
    bootloader,
    hardware,
    lines,
  };
}

function cmd(name: string, ...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(4 + parts.reduce((s, p) => s + p.length, 0));
  out.set(enc.encode(name), 0);
  let at = 4;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export class ColdcardClient {
  private readonly serial = new Serial();

  constructor(
    readonly transport: Transport,
    readonly timeoutMs = 3000,
  ) {}

  /** Sends one raw message and returns the decoded reply. */
  send(msg: Uint8Array, timeoutMs = this.timeoutMs): Promise<Decoded> {
    return this.serial.run(async () => {
      this.transport.drain();
      for (const p of encodePackets(msg)) await this.transport.write(p);
      const decoder = new ReplyDecoder();
      for (;;) {
        const reply = decoder.feed(await this.transport.read(timeoutMs));
        if (reply) return decodeReply(reply);
      }
    });
  }

  private async expect<T extends Decoded['tag']>(msg: Uint8Array, tag: T, timeoutMs?: number): Promise<Extract<Decoded, { tag: T }>> {
    const r = await this.send(msg, timeoutMs);
    if (r.tag !== tag) throw new ColdcardError(r.tag, `expected a "${tag}" reply`);
    return r as Extract<Decoded, { tag: T }>;
  }

  async ping(payload: Uint8Array | string = 'hello'): Promise<{ echo: Uint8Array; ms: number }> {
    const bytes = typeof payload === 'string' ? enc.encode(payload) : payload;
    const t0 = performance.now();
    const r = await this.expect(cmd('ping', bytes), 'biny');
    return { echo: r.data, ms: performance.now() - t0 };
  }

  async version(): Promise<ColdcardVersion> {
    const r = await this.expect(cmd('vers'), 'asci');
    return parseVersion(r.text);
  }

  /** `BTC` for mainnet, `XTN` for testnet. */
  async blockChain(): Promise<string> {
    const r = await this.expect(cmd('blkc'), 'asci');
    return r.text.trim();
  }
}
