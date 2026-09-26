import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ColdcardClient,
  ColdcardError,
  decodeReply,
  encodePackets,
  FLAG_LAST,
  parseVersion,
  ReplyDecoder,
} from '../src/protocol/coldcard';
import { FakeTransport } from './fake';
import { sha256 } from '../src/firmware/catalog';
import { MAX_BLK_LEN, type InstallProgress } from '../src/protocol/coldcard';

const enc = new TextEncoder();

describe('Coldcard framing', () => {
  it('marks the only packet of a short message as last', () => {
    const [p, ...rest] = encodePackets(enc.encode('vers'));
    expect(rest).toHaveLength(0);
    expect(p![0]).toBe(4 | FLAG_LAST);
    expect(new TextDecoder().decode(p!.subarray(1, 5))).toBe('vers');
  });

  it('fills 63-byte packets and flags only the final one', () => {
    const packets = encodePackets(new Uint8Array(130).fill(1));
    expect(packets.map((p) => p[0])).toEqual([63, 63, 4 | FLAG_LAST]);
  });

  it('refuses messages shorter than a command', () => {
    expect(() => encodePackets(new Uint8Array(3))).toThrow(RangeError);
  });

  it('reassembles a multi-packet reply', () => {
    const msg = new Uint8Array(100).map((_, i) => i);
    const d = new ReplyDecoder();
    let out = null;
    for (const p of encodePackets(msg)) out = d.feed(p) ?? out;
    expect(Array.from(out!)).toEqual(Array.from(msg));
  });
});

describe('Coldcard replies', () => {
  it('decodes tags', () => {
    expect(decodeReply(enc.encode('okay'))).toEqual({ tag: 'okay' });
    expect(decodeReply(enc.encode('asciBTC'))).toEqual({ tag: 'asci', text: 'BTC' });
    const int1 = Uint8Array.from([...enc.encode('int1'), 5, 0, 0, 0]);
    expect(decodeReply(int1)).toEqual({ tag: 'int1', values: [5] });
  });

  it('turns error tags into ColdcardError', () => {
    expect(() => decodeReply(enc.encode('err_Not ready'))).toThrow(/Not ready/);
    expect(() => decodeReply(enc.encode('refu'))).toThrow(ColdcardError);
    expect(() => decodeReply(enc.encode('busy'))).toThrow(/busy/);
  });

  it('parses a version reply by shape', () => {
    const v = parseVersion('2025-11-03\n5.4.5\n3.0.3\n251103152712\nmk4\n');
    expect(v.date).toBe('2025-11-03');
    expect(v.version).toBe('5.4.5');
    expect(v.edge).toBe(false);
    expect(v.bootloader).toBe('3.0.3');
    expect(v.hardware).toBe('mk4');
  });

  it('marks an Edge build and tolerates a short reply', () => {
    const v = parseVersion('2026-07-31\n6.3.5X');
    expect(v.edge).toBe(true);
    expect(v.hardware).toBeNull();
    expect(v.bootloader).toBeNull();
  });
});

describe('ColdcardClient', () => {
  function device(handler: (msg: string) => string) {
    return new FakeTransport((report, all) => {
      if (!(report[0]! & FLAG_LAST)) return [];
      const d = new ReplyDecoder();
      let msg: Uint8Array | null = null;
      for (const r of all) msg = d.feed(r) ?? msg;
      all.length = 0;
      return encodePackets(enc.encode(handler(new TextDecoder().decode(msg!))));
    });
  }

  it('reads version and chain', async () => {
    const t = device((m) => (m === 'vers' ? 'asci2026-07-31\n1.5.0Q\n3.1.0\n260731051700\nq1' : m === 'blkc' ? 'asciXTN' : 'err_?'));
    const c = new ColdcardClient(t);
    const v = await c.version();
    expect(v.hardware).toBe('q1');
    expect(await c.blockChain()).toBe('XTN');
  });

  it('pings with a payload longer than one packet', async () => {
    const t = device((m) => `biny${m.slice(4)}`);
    const payload = 'meow'.repeat(30);
    const r = await new ColdcardClient(t).ping(payload);
    expect(new TextDecoder().decode(r.echo)).toBe(payload);
  });
});

describe('firmware install', () => {
  /** A Coldcard that stores uploads, hashes them, and records a restart. */
  function uploader(opts: { corrupt?: boolean } = {}) {
    const stored: number[] = [];
    let rebooted = false;
    const cmds: string[] = [];
    const t = new FakeTransport((report, all) => {
      if (!(report[0]! & FLAG_LAST)) return [];
      const d = new ReplyDecoder();
      let msg: Uint8Array | null = null;
      for (const r of all) msg = d.feed(r) ?? msg;
      all.length = 0;
      const m = msg!;
      const name = new TextDecoder().decode(m.subarray(0, 4));
      cmds.push(name);
      const v = new DataView(m.buffer, m.byteOffset, m.byteLength);
      if (name === 'upld') {
        const off = v.getUint32(4, true);
        const data = m.subarray(12);
        for (let i = 0; i < data.length; i++) stored[off + i] = data[i]!;
        if (opts.corrupt && off === 0) stored[5] = (stored[5]! + 1) & 0xff;
        const r = new Uint8Array(8);
        r.set(enc.encode('int1'));
        new DataView(r.buffer).setUint32(4, off, true);
        return encodePackets(r);
      }
      if (name === 'sha2') {
        const digest = createHash('sha256').update(Uint8Array.from(stored)).digest();
        return encodePackets(Uint8Array.from([...enc.encode('biny'), ...digest]));
      }
      if (name === 'rebo') {
        rebooted = true;
        return [];
      }
      return encodePackets(enc.encode('err_?'));
    });
    return { t, stored, cmds, rebooted: () => rebooted };
  }

  const image = Uint8Array.from({ length: MAX_BLK_LEN * 3 + 512 }, (_, i) => (i * 13) & 0xff);
  const header = Uint8Array.from({ length: 128 }, (_, i) => 255 - i);

  it('sends the image in blocks, then the header as a trailer, then restarts', async () => {
    const dev = uploader();
    const seen: InstallProgress['stage'][] = [];
    await new ColdcardClient(dev.t).installFirmware(image, header, sha256, (p) => seen.push(p.stage));
    expect(dev.stored).toEqual([...image, ...header]);
    expect(dev.cmds).toEqual(['upld', 'upld', 'upld', 'upld', 'sha2', 'upld', 'sha2', 'rebo']);
    expect(dev.rebooted()).toBe(true);
    expect(seen.at(-1)).toBe('reboot');
  });

  it('stops before the trailer when the device holds different bytes', async () => {
    const dev = uploader({ corrupt: true });
    await expect(new ColdcardClient(dev.t).installFirmware(image, header, sha256)).rejects.toThrow(/different bytes/);
    expect(dev.cmds).not.toContain('rebo');
    expect(dev.stored).toHaveLength(image.length);
  });
});
