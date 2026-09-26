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
import type { InstallProgress } from '../firmware/install';
import { Serial, TransportTimeout, type Transport } from './transport';

export type { InstallProgress };

export const COLDCARD_VID = 0xd13e;
export const COLDCARD_PID = 0xcc10;

export const REPORT_LEN = 64;
export const PACKET_PAYLOAD = 63;
export const FLAG_LAST = 0x80;
export const FLAG_ENCRYPTED = 0x40;
export const LEN_MASK = 0x3f;
/** Largest block one upload message carries. */
export const MAX_BLK_LEN = 2048;
/** Largest message the device accepts: 4-byte command + two u32 + a block. */
export const MAX_MSG_LEN = 4 + 4 + 4 + MAX_BLK_LEN;

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

function u32s(...values: number[]): Uint8Array {
  const b = new Uint8Array(values.length * 4);
  const v = new DataView(b.buffer);
  values.forEach((x, i) => v.setUint32(i * 4, x, true));
  return b;
}

/** `upld`: one block of a file, at `offset` of `total`. */
export function uploadMessage(offset: number, total: number, data: Uint8Array): Uint8Array {
  if (data.length > MAX_BLK_LEN) throw new RangeError(`block of ${data.length} bytes exceeds ${MAX_BLK_LEN}`);
  return cmd('upld', u32s(offset, total), data);
}

export class ColdcardClient {
  private readonly serial = new Serial();

  constructor(
    readonly transport: Transport,
    readonly timeoutMs = 3000,
  ) {}

  /**
   * Resets the device's packet reassembly: an empty packet flagged last. A page reloaded
   * mid-message would otherwise leave the device waiting for the rest of it.
   */
  resync(): Promise<void> {
    return this.serial.run(async () => {
      const p = new Uint8Array(REPORT_LEN).fill(0xff);
      p[0] = FLAG_LAST;
      await this.transport.write(p);
      // Whatever it says to a zero-length message is not an answer to anything.
      try {
        await this.transport.read(150);
      } catch {
        // Silence is fine.
      }
      this.transport.drain();
    });
  }

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

  /** Sends one block; the device answers with the offset it stored it at. */
  async uploadBlock(offset: number, total: number, data: Uint8Array, timeoutMs = 10_000): Promise<void> {
    const r = await this.expect(uploadMessage(offset, total, data), 'int1', timeoutMs);
    if (r.values[0] !== offset) {
      throw new ColdcardError('int1', `the device stored the block at ${r.values[0]}, not ${offset}`);
    }
  }

  /** SHA-256 of everything uploaded so far, as the device computed it. */
  async uploadedSha256(timeoutMs = 10_000): Promise<Uint8Array> {
    const r = await this.expect(cmd('sha2'), 'biny', timeoutMs);
    if (r.data.length !== 32) throw new ColdcardError('biny', `digest of ${r.data.length} bytes`);
    return r.data;
  }

  /**
   * Asks the device to restart. It may go before it answers, so a timeout is taken as
   * the request having worked.
   */
  async reboot(): Promise<void> {
    try {
      await this.send(cmd('rebo'), 1500);
    } catch (err) {
      if (!(err instanceof TransportTimeout) && !(err instanceof Error && err.name === 'TransportClosed')) throw err;
    }
  }

  /**
   * Installs a firmware image through stock firmware's uploader: the image in blocks,
   * the device's digest of it checked, then the 128-byte header again as a trailer (which
   * tells the bootloader the whole image arrived), checked again, then a restart into
   * the bootloader to install it.
   */
  async installFirmware(
    image: Uint8Array,
    header: Uint8Array,
    digest: (b: Uint8Array) => Promise<Uint8Array>,
    onProgress?: (p: InstallProgress) => void,
  ): Promise<void> {
    const total = image.length;
    for (let at = 0; at < total; at += MAX_BLK_LEN) {
      const block = image.subarray(at, Math.min(at + MAX_BLK_LEN, total));
      await this.uploadBlock(at, total, block);
      onProgress?.({ stage: 'upload', sent: at + block.length, total });
    }
    onProgress?.({ stage: 'verify', sent: total, total });
    const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
    if (!same(await this.uploadedSha256(), await digest(image))) {
      throw new ColdcardError('biny', 'the device received different bytes than were sent');
    }
    onProgress?.({ stage: 'trailer', sent: total, total });
    await this.uploadBlock(total, total + header.length, header);
    const whole = new Uint8Array(total + header.length);
    whole.set(image, 0);
    whole.set(header, total);
    if (!same(await this.uploadedSha256(), await digest(whole))) {
      throw new ColdcardError('biny', 'the device received a different trailer than was sent');
    }
    onProgress?.({ stage: 'reboot', sent: total, total });
    await this.reboot();
  }
}
