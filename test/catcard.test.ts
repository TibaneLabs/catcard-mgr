import { describe, expect, it } from 'vitest';
import {
  CatCardClient,
  CatCardError,
  CONT_PAYLOAD,
  encodeFrames,
  FramingError,
  KIND_CONT,
  KIND_START,
  Opcode,
  parseIdentify,
  ReplyDecoder,
  START_PAYLOAD,
  Status,
  caps,
} from '../src/protocol/catcard';
import { FakeTransport } from './fake';

const enc = new TextEncoder();

function identifyBody(board: string, version: string, st: number, capBits: number): Uint8Array {
  const b = enc.encode(board);
  const v = enc.encode(version);
  return Uint8Array.from([1, 0, st, capBits, b.length, ...b, v.length, ...v]);
}

describe('CatCard framing', () => {
  it('puts a short message in one START frame', () => {
    const [f, ...rest] = encodeFrames(Opcode.Ping, enc.encode('hi'));
    expect(rest).toHaveLength(0);
    expect(f).toHaveLength(64);
    expect(Array.from(f!.subarray(0, 10))).toEqual([KIND_START, 0, 0x01, 0x00, 2, 0, 0, 0, 0x68, 0x69]);
  });

  it('sends an empty payload as a START frame with length zero', () => {
    const frames = encodeFrames(Opcode.Identify);
    expect(frames).toHaveLength(1);
    expect(Array.from(frames[0]!.subarray(0, 8))).toEqual([1, 0, 2, 0, 0, 0, 0, 0]);
  });

  it('splits a long message into CONT frames with rising sequence numbers', () => {
    const payload = Uint8Array.from({ length: START_PAYLOAD + CONT_PAYLOAD * 2 + 5 }, (_, i) => i & 0xff);
    const frames = encodeFrames(Opcode.UpgradeOffer, payload);
    expect(frames).toHaveLength(4);
    expect(frames.map((f) => [f[0], f[1]])).toEqual([
      [KIND_START, 0],
      [KIND_CONT, 1],
      [KIND_CONT, 2],
      [KIND_CONT, 3],
    ]);
  });

  it('round-trips through the decoder, including the sequence check', () => {
    const payload = Uint8Array.from({ length: 300 }, (_, i) => (i * 7) & 0xff);
    const d = new ReplyDecoder();
    let reply = null;
    for (const f of encodeFrames(Status.Ok, payload)) reply = d.feed(f) ?? reply;
    expect(reply?.status).toBe(Status.Ok);
    expect(Array.from(reply!.body)).toEqual(Array.from(payload));
  });

  it('refuses a skipped frame rather than returning a short body', () => {
    const frames = encodeFrames(0, new Uint8Array(200));
    const d = new ReplyDecoder();
    d.feed(frames[0]!);
    expect(() => d.feed(frames[2]!)).toThrow(FramingError);
  });

  it('ignores empty reports', () => {
    const d = new ReplyDecoder();
    expect(d.feed(new Uint8Array(64))).toBeNull();
  });
});

describe('CatCard Identify', () => {
  it('reads the strings after the capability byte', () => {
    const id = parseIdentify(identifyBody('mk4', '7.0.0', 0b01, caps.UPGRADE | caps.PAIRING));
    expect(id).toEqual({
      protocol: 1,
      unlocked: true,
      blank: false,
      caps: caps.UPGRADE | caps.PAIRING,
      board: 'mk4',
      version: '7.0.0',
    });
  });

  it('rejects a truncated reply', () => {
    expect(() => parseIdentify(Uint8Array.from([1, 0, 0]))).toThrow(FramingError);
    expect(() => parseIdentify(Uint8Array.from([1, 0, 0, 0, 3, 0x6d, 0x6b, 0x34]))).toThrow(FramingError);
  });
});

describe('CatCardClient', () => {
  function device(handler: (opcode: number, payload: Uint8Array) => [number, Uint8Array]) {
    return new FakeTransport((report) => {
      const v = new DataView(report.buffer);
      const len = v.getUint32(4, true);
      const [status, body] = handler(v.getUint16(2, true), report.slice(8, 8 + len));
      return encodeFrames(status, body);
    });
  }

  it('identifies a device whose reply spans two frames', async () => {
    const long = 'x'.repeat(60);
    const t = device((op) => (op === Opcode.Identify ? [Status.Ok, identifyBody('q1', long, 0b10, 0)] : [1, new Uint8Array()]));
    const id = await new CatCardClient(t).identify();
    expect(id.board).toBe('q1');
    expect(id.version).toBe(long);
    expect(id.blank).toBe(true);
  });

  it('turns a refusal into a CatCardError carrying the status', async () => {
    const t = device(() => [Status.UnknownOpcode, new Uint8Array()]);
    await expect(new CatCardClient(t).identify()).rejects.toMatchObject({
      name: 'CatCardError',
      status: Status.UnknownOpcode,
    } satisfies Partial<CatCardError>);
  });

  it('echoes a ping', async () => {
    const t = device((op, p) => (op === Opcode.Ping ? [Status.Ok, p] : [1, new Uint8Array()]));
    const r = await new CatCardClient(t).ping('purr');
    expect(new TextDecoder().decode(r.echo)).toBe('purr');
  });

  it('pages through the log until it has the total', async () => {
    const text = enc.encode('boot ok\n'.repeat(20));
    const t = device((op, p) => {
      const off = new DataView(p.buffer, p.byteOffset).getUint32(0, true);
      const page = text.subarray(off, off + START_PAYLOAD - 5);
      const body = new Uint8Array(5 + page.length);
      new DataView(body.buffer).setUint32(0, text.length, true);
      body.set(page, 5);
      return op === Opcode.ReadLog ? [Status.Ok, body] : [1, new Uint8Array()];
    });
    const log = await new CatCardClient(t).readLog();
    expect(log.text).toBe('boot ok\n'.repeat(20));
    expect(log.wrapped).toBe(false);
  });
});
