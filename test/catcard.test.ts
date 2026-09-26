import { describe, expect, it } from 'vitest';
import {
  CatCardClient,
  CatCardError,
  CONT_PAYLOAD,
  encodeFrames,
  FramingError,
  packImage,
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

describe('pairing refusals', () => {
  it('passes on the reason when the device has blocked pairing', async () => {
    const t = new FakeTransport((report) => {
      const op = new DataView(report.buffer).getUint16(2, true);
      return op === Opcode.PairCommit ? encodeFrames(Status.Refused, new TextEncoder().encode('pairing blocked: acknowledge it on the device')) : [];
    });
    await expect(new CatCardClient(t).startPairing()).rejects.toThrow(/pairing blocked: acknowledge it on the device/);
  });

  it('says to wait when a pairing was started moments ago', async () => {
    const t = new FakeTransport(() => encodeFrames(Status.Busy, new Uint8Array()));
    await expect(new CatCardClient(t).startPairing()).rejects.toThrow(/wait/);
  });
});

describe('firmware offers', () => {
  const image = Uint8Array.from({ length: 40_000 }, (_, i) => (i % 97 === 0 ? i & 0xff : 0));
  const accepted = () => {
    const b = new Uint8Array(23);
    b[0] = 1;
    new DataView(b.buffer).setUint32(1, image.length, true);
    b.set(new TextEncoder().encode('7.1.0a1'), 13);
    b[21] = 0;
    b[22] = 1;
    return b;
  };

  it('packs an image into one raw deflate stream per block', async () => {
    const { inflateRawSync } = await import('node:zlib');
    const one = (await packImage(image, 64 * 1024))!;
    const v = new DataView(one.buffer);
    expect(v.getUint32(0, true)).toBe(image.length);
    expect(v.getUint32(4, true)).toBe(64 * 1024);
    expect(new Uint8Array(inflateRawSync(one.subarray(8)))).toEqual(image);
    const blocks = (await packImage(image))!;
    expect(blocks.length).toBeLessThan(image.length);
    expect(await packImage(crypto.getRandomValues(new Uint8Array(4096)))).toBeNull();
  });

  it('stops sending as soon as the device answers early', async () => {
    let frames = 0;
    const t = new FakeTransport((report) => {
      frames++;
      return report[0] === KIND_START ? encodeFrames(Status.NotNow, new Uint8Array()) : [];
    });
    await expect(new CatCardClient(t).offerImage(image, caps.UPGRADE)).rejects.toThrow(/earlier offer is waiting/);
    expect(frames).toBeLessThan(40);
  });

  it('resends uncompressed when the device has no room to inflate', async () => {
    const ops: number[] = [];
    const t = new FakeTransport((report, all) => {
      if (report[0] === KIND_START) ops.push(new DataView(report.buffer).getUint16(2, true));
      const d = new ReplyDecoder();
      let msg = null;
      for (const r of all) msg = d.feed(r) ?? msg;
      if (!msg) return [];
      all.length = 0;
      return ops.at(-1) === Opcode.UpgradePacked ? encodeFrames(Status.RetryUncompressed, new Uint8Array()) : encodeFrames(Status.Ok, accepted());
    });
    const stages: string[] = [];
    const a = await new CatCardClient(t).offerImage(image, caps.UPGRADE | caps.UPGRADE_PACKED, (p) => stages.push(p.stage));
    expect(ops).toEqual([Opcode.UpgradePacked, Opcode.UpgradeOffer]);
    expect(a).toEqual({ verified: true, length: image.length, version: '7.1.0a1', keySlot: 0, older: true });
    expect(stages).toContain('upload');
    expect(stages.at(-1)).toBe('inspect');
  });

  it('says why an image was refused', async () => {
    const t = new FakeTransport((report, all) => {
      const d = new ReplyDecoder();
      let msg = null;
      for (const r of all) msg = d.feed(r) ?? msg;
      if (!msg) return [];
      all.length = 0;
      return encodeFrames(Status.Refused, Uint8Array.of(8));
    });
    await expect(new CatCardClient(t).offerImage(image, caps.UPGRADE)).rejects.toThrow('The CatCard refused the image: it is built for a different board.');
  });

  it('hears a decline, or the device leaving to install', async () => {
    const declined = new FakeTransport(() => []);
    declined.push(encodeFrames(Status.Declined, new Uint8Array())[0]!);
    expect(await new CatCardClient(declined).awaitApproval(5_000)).toBe('declined');
    const gone = new FakeTransport(() => []);
    gone.gone = true;
    expect(await new CatCardClient(gone).awaitApproval(5_000)).toBe('restarting');
  });
});
