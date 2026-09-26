import { describe, expect, it } from 'vitest';
import {
  awaitResult,
  decodeAddresses,
  decodeSignResult,
  Host,
  HostRefused,
  HARDENED as H,
  isUnder,
  parsePath,
  pathText,
  requestSignature,
  signBlob,
  type Call,
} from '../src/protocol/hostwallet';
import { readPsbt, walletKeys } from '../src/wallet/psbt';

const ascii = (s: string) => Array.from(new TextEncoder().encode(s));

describe('host-wallet layouts, pinned as in the firmware tests', () => {
  it('builds a sign blob', () => {
    const blob = signBlob(1, [[84 | H, H, H, 0, 3].map((x) => x >>> 0)], Uint8Array.from([0x70, 0x73, 0x62, 0x74]));
    expect(Array.from(blob)).toEqual([1, 1, 1, 5, 84, 0, 0, 0x80, 0, 0, 0, 0x80, 0, 0, 0, 0x80, 0, 0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0, 0x70, 0x73, 0x62, 0x74]);
  });

  it('reads and writes paths', () => {
    expect(parsePath("m/84'/0h/0H/0/3")).toEqual([(84 | H) >>> 0, H, H, 0, 3]);
    expect(pathText([(44 | H) >>> 0, (501 | H) >>> 0, (7 | H) >>> 0, H])).toBe("m/44'/501'/7'/0'");
    expect(isUnder([(84 | H) >>> 0, H, H, 0, 3], [(84 | H) >>> 0, H, H])).toBe(true);
    expect(isUnder([(84 | H) >>> 0, H], [(84 | H) >>> 0, H, H])).toBe(false);
    expect(() => parsePath('m/x')).toThrow();
  });

  const reply = Uint8Array.from([
    1, 1, 0xde, 0xad, 0xbe, 0xef, 7, 0, 0, 0, 2,
    1, 1, 3,
    3, 84, 0, 0, 0x80, 0, 0, 0, 0x80, 0, 0, 0, 0x80,
    5, 84, 0, 0, 0x80, 0, 0, 0, 0x80, 0, 0, 0, 0x80, 0, 0, 0, 0, 0, 0, 0, 0,
    4, ...ascii('xpub'), 4, ...ascii('bc1q'), 2, 2, 3,
    2, 3, 7,
    3, 44, 0, 0, 0x80, 0xf5, 1, 0, 0x80, 7, 0, 0, 0x80,
    4, 44, 0, 0, 0x80, 0xf5, 1, 0, 0x80, 7, 0, 0, 0x80, 0, 0, 0, 0x80,
    3, ...ascii('So1'), 1, 9,
  ]);

  it('decodes an address reply', () => {
    const r = decodeAddresses(reply);
    expect(r.fingerprint).toBe('deadbeef');
    expect(r.account).toBe(7);
    expect(r.entries[0]).toMatchObject({ shape: 'utxo', chain: 1, format: 3, xpub: 'xpub', address: 'bc1q', pubkey: '0203' });
    expect(r.entries[1]).toMatchObject({ shape: 'account', chain: 3, format: 7, xpub: '', address: 'So1' });
    expect(pathText(r.entries[1]!.addressPath)).toBe("m/44'/501'/7'/0'");
  });

  it('refuses every truncation and trailing bytes', () => {
    for (let cut = 0; cut < reply.length; cut++) expect(() => decodeAddresses(reply.subarray(0, cut))).toThrow();
    expect(() => decodeAddresses(Uint8Array.from([...reply, 0]))).toThrow(/trailing/);
  });

  it('decodes signing results', () => {
    expect(decodeSignResult(Uint8Array.from([2, 2, 2, 0, 0, 0, 0xaa, 0xbb, 1, 0, 0, 0, 0xcc]))).toMatchObject({ kind: 'bitcoin', psbtVersion: 2 });
    expect(decodeSignResult(Uint8Array.from([3, 2, 0, 0, 0, 2, 0xf8]))).toMatchObject({ kind: 'evm' });
    const sol = decodeSignResult(Uint8Array.from([4, 1, 1, ...new Array(64).fill(0x55), 1, 0, 0, 0, 0xee]));
    expect(sol.kind === 'solana' && sol.signatures[0]!.slot).toBe(1);
  });
});

describe('host-wallet flows against a scripted device', () => {
  function device(script: (op: number, p: Uint8Array) => [number, number[]]) {
    const calls: number[] = [];
    const call: Call = async (op, p = new Uint8Array()) => {
      calls.push(op);
      const [status, body] = script(op, p);
      return { status, body: Uint8Array.from(body) };
    };
    return { call, calls };
  }

  it('polls through the stages and pages a long result in', async () => {
    let polls = 0;
    const result = Array.from({ length: 1000 }, (_, i) => i & 0xff);
    const stages: number[] = [];
    const d = device((op, p) => {
      if (op !== Host.Result) return [1, []];
      const off = new DataView(p.buffer, p.byteOffset).getUint32(0, true);
      if (off === 0 && polls++ < 2) return [2, [polls === 1 ? 2 : 3]];
      const page = result.slice(off, off + 448);
      return [0, [1000 & 0xff, 1000 >> 8, 0, 0, ...page]];
    });
    const got = await awaitResult(d.call, { pollMs: 1, onStage: (s) => stages.push(s) });
    expect(Array.from(got)).toEqual(result);
    expect(stages).toEqual([2, 3]);
  });

  it('reports a decline and a refusal in words', async () => {
    await expect(awaitResult(device(() => [4, []]).call)).rejects.toThrow('Declined on the CatCard.');
    await expect(awaitResult(device(() => [5, ascii('fee too high')]).call)).rejects.toThrow('fee too high');
    await expect(awaitResult(device(() => [5, ascii('fee too high')]).call)).rejects.toBeInstanceOf(HostRefused);
  });

  it('uploads a sign blob in chunks, in order, then waits', async () => {
    const received: number[] = [];
    const tx = Uint8Array.from({ length: 2500 }, (_, i) => i & 0xff);
    const d = device((op, p) => {
      if (op === Host.SignBegin) return [0, [0, 4, 0, 0]]; // largest chunk 1024
      if (op === Host.SignData) {
        const off = new DataView(p.buffer, p.byteOffset).getUint32(0, true);
        if (off !== received.length) return [3, []];
        received.push(...p.subarray(4));
        return [0, []];
      }
      if (op === Host.SignCommit) return [0, []];
      if (op === Host.Result) return [0, [7, 0, 0, 0, 3, 2, 0, 0, 0, 0x01, 0x02]];
      return [1, []];
    });
    const r = await requestSignature(d.call, 2, [[(44 | H) >>> 0, (60 | H) >>> 0, H, 0, 0]], tx);
    expect(r.kind).toBe('evm');
    const blob = signBlob(2, [[(44 | H) >>> 0, (60 | H) >>> 0, H, 0, 0]], tx);
    expect(Uint8Array.from(received)).toEqual(blob);
    // Chunks never exceed what fits one sealed record.
    expect(d.calls.filter((c) => c === Host.SignData).length).toBe(Math.ceil(blob.length / 1018));
  });

  it('aborts the upload when a chunk fails', async () => {
    const d = device((op) => (op === Host.SignBegin ? [0, [0, 4, 0, 0]] : op === Host.SignData ? [3, []] : [0, []]));
    await expect(requestSignature(d.call, 1, [[1]], Uint8Array.of(1))).rejects.toThrow(/upload failed/);
    expect(d.calls.at(-1)).toBe(Host.Abort);
  });
});

describe('PSBT keys', () => {
  const varint = (n: number) => (n < 0xfd ? [n] : [0xfd, n & 0xff, n >> 8]);
  const kv = (type: number, keydata: number[], value: number[]) => [...varint(1 + keydata.length), type, ...keydata, ...varint(value.length), ...value];
  const le = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, n >>> 24];
  const path = (...p: number[]) => p.flatMap(le);
  const fp = [0xde, 0xad, 0xbe, 0xef];
  const other = [1, 2, 3, 4];
  const pk = new Array(33).fill(2);
  // Unsigned tx with two inputs and no outputs, enough for the counter.
  const tx = [2, 0, 0, 0, 2, ...new Array(36).fill(0), 0, 0xff, 0xff, 0xff, 0xff, ...new Array(36).fill(1), 0, 0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0, 0];

  it("finds this wallet's paths in a v0 PSBT, taproot records included", () => {
    const psbt = Uint8Array.from([
      0x70, 0x73, 0x62, 0x74, 0xff,
      ...kv(0x00, [], tx), 0,
      ...kv(0x06, pk, [...fp, ...path(84 | H, H, H, 0, 3)]), ...kv(0x06, pk, [...other, ...path(84 | H, H, H, 0, 9)]), 0,
      ...kv(0x16, new Array(32).fill(5), [0, ...fp, ...path(86 | H, H, H, 1, 0)]), 0,
    ]);
    const k = walletKeys(psbt, 'deadbeef');
    expect(k.version).toBe(0);
    expect(k.inputs).toBe(2);
    expect(k.paths.map(pathText)).toEqual(["m/84'/0'/0'/0/3", "m/86'/0'/0'/1/0"]);
    expect(k.foreignInputs).toBe(0);
  });

  it('reads a v2 PSBT and counts inputs that are not ours', () => {
    const psbt = Uint8Array.from([
      0x70, 0x73, 0x62, 0x74, 0xff,
      ...kv(0xfb, [], le(2)), ...kv(0x04, [], [2]), ...kv(0x05, [], [0]), 0,
      ...kv(0x06, pk, [...fp, ...path(84 | H, H, H, 0, 1)]), 0,
      ...kv(0x06, pk, [...other, ...path(84 | H, H, H, 0, 1)]), 0,
    ]);
    const k = walletKeys(psbt, 'deadbeef');
    expect(k.version).toBe(2);
    expect(k.paths.map(pathText)).toEqual(["m/84'/0'/0'/0/1"]);
    expect(k.foreignInputs).toBe(1);
  });

  it('accepts binary, base64 and hex, and refuses anything else', () => {
    const b = Uint8Array.from([0x70, 0x73, 0x62, 0x74, 0xff, 0]);
    expect(readPsbt(b)).toEqual(b);
    expect(readPsbt(btoa(String.fromCharCode(...b)))).toEqual(b);
    expect(readPsbt('70736274ff00')).toEqual(b);
    expect(() => readPsbt('hello')).toThrow(/not a PSBT/);
  });
});
