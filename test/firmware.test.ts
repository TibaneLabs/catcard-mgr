import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { boardFor, parseAssetName, pickImage, releasesFromGithub, type FirmwareRelease, type GithubRelease } from '../src/firmware/catalog';
import { DfuError, parseDfu } from '../src/firmware/dfu';
import { checkImage, compatibleHardware, HEADER_OFFSET, HW, MAGIC, parseHeader } from '../src/firmware/header';

/** An image of `len` bytes with a header, as `catcard-image` lays one out. */
export function makeImage(len: number, hwCompat: number, version = '7.0.0a1', declared = len): Uint8Array {
  const img = new Uint8Array(len).map((_, i) => (i * 31) & 0xff);
  const h = new DataView(img.buffer, HEADER_OFFSET, 128);
  new Uint8Array(img.buffer, HEADER_OFFSET, 128).fill(0);
  h.setUint32(0, MAGIC, true);
  img.set([0x26, 0x09, 0x26, 0x13, 0x11, 0x42, 0, 0], HEADER_OFFSET + 4);
  img.set(new TextEncoder().encode(version), HEADER_OFFSET + 12);
  h.setUint32(20, 0, true);
  h.setUint32(24, declared, true);
  h.setUint32(32, hwCompat, true);
  return img;
}

/** Wraps an image in a one-target, one-element DfuSe container. */
export function makeDfu(image: Uint8Array, name = 'CatCard mk5'): Uint8Array {
  const out = new Uint8Array(11 + 274 + 8 + image.length + 16);
  const v = new DataView(out.buffer);
  out.set(new TextEncoder().encode('DfuSe'), 0);
  out[5] = 1;
  v.setUint32(6, out.length - 16, true);
  out[10] = 1;
  out.set(new TextEncoder().encode('Target'), 11);
  v.setUint32(11 + 7, 1, true);
  out.set(new TextEncoder().encode(name), 11 + 11);
  v.setUint32(11 + 266, 8 + image.length, true);
  v.setUint32(11 + 270, 1, true);
  v.setUint32(285, 0x08020000, true);
  v.setUint32(289, image.length, true);
  out.set(image, 293);
  return out;
}

describe('release asset names', () => {
  it('reads board and flavour', () => {
    expect(parseAssetName('catcard-mk4-mk5-bitcoin-games-7.0.0-alpha1.dfu')).toEqual({
      board: 'mk4-mk5',
      bitcoinOnly: true,
      games: true,
      version: '7.0.0-alpha1',
    });
    expect(parseAssetName('catcard-q1-7.0.0-alpha1.dfu')).toEqual({ board: 'q1', bitcoinOnly: false, games: false, version: '7.0.0-alpha1' });
    expect(parseAssetName('catcard-mk3-games-7.0.0.dfu')?.games).toBe(true);
  });

  it('skips anything else', () => {
    expect(parseAssetName('SHA256SUMS')).toBeNull();
    expect(parseAssetName('catcard-mk9-7.0.0.dfu')).toBeNull();
  });

});

describe('releases from the GitHub API', () => {
  const h = 'ab'.repeat(32);
  const release = (over: Partial<GithubRelease> = {}): GithubRelease => ({
    tag_name: 'v7.0.0-alpha1',
    name: 'CatCard v7.0.0-alpha1',
    draft: false,
    prerelease: true,
    published_at: '2026-09-26T13:15:35Z',
    html_url: 'https://github.com/TibaneLabs/catcard/releases/tag/v7.0.0-alpha1',
    assets: [
      { name: 'catcard-q1-games-7.0.0-alpha1.dfu', size: 10, digest: `sha256:${h}`, state: 'uploaded' },
      { name: 'catcard-mk3-7.0.0-alpha1.dfu', size: 20, digest: `sha256:${h}`, state: 'uploaded' },
      { name: 'SHA256SUMS', size: 5, digest: `sha256:${h}`, state: 'uploaded' },
    ],
    ...over,
  });

  it('offers the images with GitHub digests and proxy URLs', () => {
    const [r] = releasesFromGithub([release()]);
    expect(r?.images.map((i) => i.file)).toEqual(['catcard-mk3-7.0.0-alpha1.dfu', 'catcard-q1-games-7.0.0-alpha1.dfu']);
    expect(r?.images[0]).toMatchObject({
      url: 'https://gh-release.tibane.net/TibaneLabs/catcard/v7.0.0-alpha1/catcard-mk3-7.0.0-alpha1.dfu',
      sha256: h,
      board: 'mk3',
      size: 20,
    });
  });

  it('leaves out drafts, files without a digest, and releases with nothing usable', () => {
    const noDigest = release({ tag_name: 'v1', assets: [{ name: 'catcard-mk3-1.dfu', size: 1, digest: null }] });
    const pending = release({ tag_name: 'v2', assets: [{ name: 'catcard-mk3-2.dfu', size: 1, digest: `sha256:${h}`, state: 'starter' }] });
    expect(releasesFromGithub([release({ draft: true }), noDigest, pending])).toEqual([]);
  });
});

describe('picking an image', () => {
  const images = ['mk3', 'mk4-mk5', 'q1'].flatMap((board) =>
    [false, true].flatMap((bitcoinOnly) =>
      [false, true].map((games) => ({ file: `${board}-${bitcoinOnly}-${games}`, url: '', size: 1, sha256: '', board, bitcoinOnly, games, version: '7' })),
    ),
  ) as FirmwareRelease['images'];
  const rel: FirmwareRelease = { tag: 'v7', name: 'v7', prerelease: true, published: '', url: '', images };

  it('maps Coldcard hardware labels to release boards', () => {
    expect(boardFor('mk4')).toBe('mk4-mk5');
    expect(boardFor('MK5')).toBe('mk4-mk5');
    expect(boardFor('q1')).toBe('q1');
    expect(boardFor(null)).toBeNull();
  });

  it('finds the one image for a flavour', () => {
    expect(pickImage(rel, 'q1', true, false)?.file).toBe('q1-true-false');
  });
});

describe('DfuSe', () => {
  it('unwraps the element', () => {
    const img = makeImage(0x5000, HW.mk4 | HW.mk5);
    const d = parseDfu(makeDfu(img));
    expect(d.targetName).toBe('CatCard mk5');
    expect(d.address).toBe(0x08020000);
    expect(d.image).toEqual(img);
  });

  it('refuses a raw image and a truncated container', () => {
    expect(() => parseDfu(makeImage(0x5000, 0))).toThrow(DfuError);
    const dfu = makeDfu(makeImage(0x5000, 0));
    expect(() => parseDfu(dfu.subarray(0, dfu.length - 100))).toThrow(/past the end/);
  });
});

describe('firmware header', () => {
  it('reads version, build time and compatibility', () => {
    const h = parseHeader(makeImage(0x5000, HW.mk4 | HW.mk5));
    expect(h.version).toBe('7.0.0a1');
    expect(h.built).toBe('2026-09-26 13:11');
    expect(h.firmwareLength).toBe(0x5000);
    expect(compatibleHardware(h.hwCompat)).toEqual(['mk4', 'mk5']);
    expect(h.raw).toHaveLength(128);
  });

  it('refuses an image for another board', () => {
    const img = makeImage(0x5000, HW.q1);
    expect(checkImage(img, parseHeader(img), 'mk4')).toEqual(['the image is built for q1, not mk4']);
    expect(checkImage(img, parseHeader(img), 'q1')).toEqual([]);
  });

  it('refuses a length that disagrees with the header', () => {
    const img = makeImage(0x5000, 0, '7', 0x5200);
    expect(checkImage(img, parseHeader(img), null)[0]).toMatch(/declares/);
  });

  it('refuses a missing header', () => {
    expect(() => parseHeader(new Uint8Array(0x5000))).toThrow(/magic/);
  });

  it('agrees with node about SHA-256', async () => {
    const { sha256, hex } = await import('../src/firmware/catalog');
    const b = new TextEncoder().encode('meow');
    expect(hex(await sha256(b))).toBe(createHash('sha256').update(b).digest('hex'));
  });
});
