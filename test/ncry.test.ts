import { describe, expect, it } from 'vitest';
import { codeText, Initiator, NcryError, responder } from '../src/protocol/ncry';

const hex = (s: string) => Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));
// The v2 vector shared by the firmware's ncry tests and tools/ncry.py.
const HOST_PRIV = hex('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a');
const DEV_PRIV = hex('5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb');
const KAT_COMMIT = [65, 181, 194, 108, 161, 34, 111, 179, 156, 98, 166, 84, 21, 115, 147, 169, 108, 1, 121, 169, 26, 246, 122, 111, 98, 247, 189, 154, 215, 47, 20, 74];
const KAT_CODE = 398660;
const KAT_RECORD = [128, 168, 83, 37, 40, 20, 198, 221, 119, 225, 110, 89, 217, 140, 246, 68, 129, 191, 40, 248, 83, 179, 22];

describe('ncry v2', () => {
  it('matches the firmware vector: commitment, code and first sealed record', () => {
    const host = new Initiator(HOST_PRIV);
    expect(Array.from(host.commit)).toEqual(KAT_COMMIT);
    const dev = responder(DEV_PRIV, host.commit, host.public);
    const session = host.finish(dev.devicePub);
    expect(session.code).toBe(KAT_CODE);
    expect(dev.session.code).toBe(KAT_CODE);
    expect(Array.from(session.seal(new TextEncoder().encode('catcard')))).toEqual(KAT_RECORD);
  });

  it('carries messages both ways and refuses a replayed or altered record', () => {
    const host = new Initiator(HOST_PRIV);
    const dev = responder(DEV_PRIV, host.commit, host.public);
    const s = host.finish(dev.devicePub);
    const r1 = s.seal(Uint8Array.of(1, 2, 3));
    expect(Array.from(dev.session.open(r1))).toEqual([1, 2, 3]);
    const back = dev.session.seal(Uint8Array.of(9));
    expect(Array.from(s.open(back))).toEqual([9]);
    // The same record again authenticates against the wrong counter.
    expect(() => s.open(back)).toThrow(NcryError);
    // And the session is over after that.
    expect(() => s.seal(Uint8Array.of(0))).toThrow(/ended/);
  });

  it('shows a relay different codes on each side', () => {
    const relayToHost = new Uint8Array(32).fill(0x24);
    const relayToDev = new Initiator(new Uint8Array(32).fill(0x42));
    const hostSide = new Initiator(HOST_PRIV).finish(responder(relayToHost, new Initiator(HOST_PRIV).commit, new Initiator(HOST_PRIV).public).devicePub);
    const devSide = responder(DEV_PRIV, relayToDev.commit, relayToDev.public).session;
    expect(hostSide.code).not.toBe(devSide.code);
  });

  it('refuses a reveal that misses the commitment', () => {
    const host = new Initiator(HOST_PRIV);
    const other = new Initiator(new Uint8Array(32).fill(0x42));
    expect(() => responder(DEV_PRIV, host.commit, other.public)).toThrow(/commitment/);
  });

  it('formats codes as both screens do', () => {
    expect(codeText(7)).toBe('000 007');
    expect(codeText(123456)).toBe('123 456');
    expect(codeText(KAT_CODE)).toBe('398 660');
  });
});
