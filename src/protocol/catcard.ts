/**
 * CatCard USB protocol, host side.
 *
 * Written from the framing description in catcard's `docs/USB.md`:
 *
 *   byte 0   kind    0x01 START, 0x02 CONT
 *   byte 1   seq     increments per frame within a message, wrapping
 *   START:   2..4 u16 opcode (request) / status (reply), 4..8 u32 total length, 8..64 payload
 *   CONT:    2..64 payload
 */
import { Serial, type Transport } from './transport';

export const CATCARD_VID = 0x39f2;
export const CATCARD_PID = 0x0401;

export const REPORT_LEN = 64;
export const KIND_START = 0x01;
export const KIND_CONT = 0x02;
export const START_PAYLOAD = REPORT_LEN - 8;
export const CONT_PAYLOAD = REPORT_LEN - 2;

export const Opcode = {
  Ping: 0x0001,
  Identify: 0x0002,
  UpgradeOffer: 0x0010,
  UpgradeCommit: 0x0011,
  ReadLog: 0x0012,
  UpgradePacked: 0x0013,
  InjectKey: 0x0020,
  UnlockPin: 0x0021,
  NcryStart: 0x0040,
  NcryMsg: 0x0041,
} as const;
export type Opcode = (typeof Opcode)[keyof typeof Opcode];

export const Status = {
  Ok: 0x0000,
  UnknownOpcode: 0x0001,
  NotNow: 0x0002,
  BadRequest: 0x0003,
  Declined: 0x0004,
  Refused: 0x0005,
  Busy: 0x0006,
  RetryUncompressed: 0x0007,
} as const;

export const STATUS_NAMES: Record<number, string> = {
  0: 'Ok',
  1: 'UnknownOpcode',
  2: 'NotNow',
  3: 'BadRequest',
  4: 'Declined',
  5: 'Refused',
  6: 'Busy',
  7: 'RetryUncompressed',
};

export function statusName(status: number): string {
  return STATUS_NAMES[status] ?? `0x${status.toString(16).padStart(4, '0')}`;
}

/** Device state bits in an Identify reply. */
export const state = {
  UNLOCKED: 1 << 0,
  BLANK: 1 << 1,
} as const;

/** Capability bits in an Identify reply. */
export const caps = {
  KEY_INJECTION: 1 << 0,
  UPGRADE: 1 << 1,
  DEBUG_MEM: 1 << 2,
  UNLOCK_PIN: 1 << 3,
  UPGRADE_PACKED: 1 << 4,
  NCRY: 1 << 5,
} as const;

export const CAP_NAMES: ReadonlyArray<{ bit: number; name: string; description: string; hazard?: boolean }> = [
  { bit: caps.UPGRADE, name: 'Upgrade', description: 'Can stage and install a firmware image over USB.' },
  { bit: caps.UPGRADE_PACKED, name: 'Packed upgrade', description: 'Accepts a deflated firmware image.' },
  { bit: caps.NCRY, name: 'Encrypted channel', description: 'Accepts an X25519 / ChaCha20-Poly1305 session.' },
  { bit: caps.KEY_INJECTION, name: 'Key injection', description: 'Accepts keypresses over USB. Bench builds only.', hazard: true },
  { bit: caps.UNLOCK_PIN, name: 'PIN over USB', description: 'Accepts the login PIN over USB. Bench builds only.', hazard: true },
  { bit: caps.DEBUG_MEM, name: 'Memory monitor', description: 'Raw peek / poke / jsr. Must never ship.', hazard: true },
];

/** Bits in the flags byte of a ReadLog reply. */
export const LOG_WRAPPED = 1 << 0;

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: false });

/** Split one message into 64-byte frames. */
export function encodeFrames(opcode: number, payload: Uint8Array = new Uint8Array(0)): Uint8Array[] {
  const frames: Uint8Array[] = [];
  let seq = 0;
  let n = Math.min(payload.length, START_PAYLOAD);
  const first = new Uint8Array(REPORT_LEN);
  const fv = new DataView(first.buffer);
  first[0] = KIND_START;
  first[1] = seq;
  fv.setUint16(2, opcode, true);
  fv.setUint32(4, payload.length, true);
  first.set(payload.subarray(0, n), 8);
  frames.push(first);
  let at = n;
  while (at < payload.length) {
    seq = (seq + 1) & 0xff;
    n = Math.min(payload.length - at, CONT_PAYLOAD);
    const f = new Uint8Array(REPORT_LEN);
    f[0] = KIND_CONT;
    f[1] = seq;
    f.set(payload.subarray(at, at + n), 2);
    frames.push(f);
    at += n;
  }
  return frames;
}

export interface Reply {
  status: number;
  body: Uint8Array;
}

export class FramingError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'FramingError';
  }
}

/**
 * Reassembles a reply from its frames. Feed it reports; it returns the reply once the
 * last frame is in. Empty reports (kind 0) are the device having nothing to say and are
 * ignored, not errors.
 */
export class ReplyDecoder {
  private status = 0;
  private total = 0;
  private body: Uint8Array | null = null;
  private got = 0;
  private seq = 0;

  feed(report: Uint8Array): Reply | null {
    const kind = report[0];
    if (kind !== KIND_START && kind !== KIND_CONT) return null;
    if (this.body === null) {
      if (kind !== KIND_START) throw new FramingError('continuation frame with no message open');
      const v = new DataView(report.buffer, report.byteOffset, report.byteLength);
      this.status = v.getUint16(2, true);
      this.total = v.getUint32(4, true);
      this.body = new Uint8Array(this.total);
      this.seq = report[1] ?? 0;
      const n = Math.min(this.total, START_PAYLOAD);
      this.body.set(report.subarray(8, 8 + n), 0);
      this.got = n;
    } else {
      if (kind !== KIND_CONT) throw new FramingError('a new message started while one was in progress');
      const expect = (this.seq + 1) & 0xff;
      if (report[1] !== expect) throw new FramingError(`frame sequence skipped: expected ${expect}, got ${report[1]}`);
      this.seq = expect;
      const n = Math.min(this.total - this.got, CONT_PAYLOAD);
      this.body.set(report.subarray(2, 2 + n), this.got);
      this.got += n;
    }
    if (this.got >= this.total) {
      const reply = { status: this.status, body: this.body };
      this.body = null;
      return reply;
    }
    return null;
  }
}

export interface Identify {
  protocol: number;
  unlocked: boolean;
  blank: boolean;
  caps: number;
  board: string;
  version: string;
}

/**
 * Identify reply: `[u16 protocol][u8 state][u8 caps][u8 len, board][u8 len, version]`.
 * The strings start at byte 4, after the capability byte.
 */
export function parseIdentify(body: Uint8Array): Identify {
  if (body.length < 4) throw new FramingError(`Identify reply too short: ${body.length} bytes`);
  const v = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const protocol = v.getUint16(0, true);
  const st = body[2] ?? 0;
  const capBits = body[3] ?? 0;
  let at = 4;
  const strings: string[] = [];
  for (let i = 0; i < 2; i++) {
    const n = body[at];
    if (n === undefined) throw new FramingError('Identify reply is missing a string');
    strings.push(dec.decode(body.subarray(at + 1, at + 1 + n)));
    at += 1 + n;
  }
  return {
    protocol,
    unlocked: (st & state.UNLOCKED) !== 0,
    blank: (st & state.BLANK) !== 0,
    caps: capBits,
    board: strings[0] ?? '',
    version: strings[1] ?? '',
  };
}

export interface LogPage {
  total: number;
  wrapped: boolean;
  bytes: Uint8Array;
}

/** ReadLog reply: `[u32 total][u8 flags][bytes]`. */
export function parseLogPage(body: Uint8Array): LogPage {
  if (body.length < 5) throw new FramingError(`ReadLog reply too short: ${body.length} bytes`);
  const v = new DataView(body.buffer, body.byteOffset, body.byteLength);
  return {
    total: v.getUint32(0, true),
    wrapped: ((body[4] ?? 0) & LOG_WRAPPED) !== 0,
    bytes: body.subarray(5),
  };
}

export class CatCardError extends Error {
  constructor(
    readonly opcode: number,
    readonly status: number,
    readonly body: Uint8Array,
  ) {
    super(`device answered ${statusName(status)}`);
    this.name = 'CatCardError';
  }
}

export interface DeviceLog {
  text: string;
  total: number;
  wrapped: boolean;
}

export class CatCardClient {
  private readonly serial = new Serial();

  constructor(
    readonly transport: Transport,
    readonly timeoutMs = 3000,
  ) {}

  /** One request, one reply, whatever its status. */
  request(opcode: number, payload: Uint8Array = new Uint8Array(0), timeoutMs = this.timeoutMs): Promise<Reply> {
    return this.serial.run(async () => {
      this.transport.drain();
      for (const f of encodeFrames(opcode, payload)) await this.transport.write(f);
      const decoder = new ReplyDecoder();
      for (;;) {
        const reply = decoder.feed(await this.transport.read(timeoutMs));
        if (reply) return reply;
      }
    });
  }

  /** A request that must succeed; any other status becomes a `CatCardError`. */
  async call(opcode: number, payload?: Uint8Array, timeoutMs?: number): Promise<Uint8Array> {
    const r = await this.request(opcode, payload, timeoutMs);
    if (r.status !== Status.Ok) throw new CatCardError(opcode, r.status, r.body);
    return r.body;
  }

  /** Sends `payload` and returns the echo and the round trip in milliseconds. */
  async ping(payload: Uint8Array | string = 'hello'): Promise<{ echo: Uint8Array; ms: number }> {
    const bytes = typeof payload === 'string' ? enc.encode(payload) : payload;
    const t0 = performance.now();
    const echo = await this.call(Opcode.Ping, bytes);
    return { echo, ms: performance.now() - t0 };
  }

  async identify(): Promise<Identify> {
    return parseIdentify(await this.call(Opcode.Identify));
  }

  /** Reads the whole boot/diagnostic log, one page per round trip. */
  async readLog(): Promise<DeviceLog> {
    const chunks: Uint8Array[] = [];
    let offset = 0;
    let total = 0;
    let wrapped = false;
    for (;;) {
      const req = new Uint8Array(4);
      new DataView(req.buffer).setUint32(0, offset, true);
      const page = parseLogPage(await this.call(Opcode.ReadLog, req));
      total = page.total;
      wrapped = page.wrapped;
      if (page.bytes.length === 0 || offset >= total) break;
      chunks.push(page.bytes);
      offset += page.bytes.length;
      if (offset >= total) break;
    }
    const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let at = 0;
    for (const c of chunks) {
      all.set(c, at);
      at += c.length;
    }
    return { text: dec.decode(all), total, wrapped };
  }
}
