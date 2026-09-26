import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { archivePath, boardsFor, compareVersions, imagesFromSignedText, parseStockName } from '../src/firmware/coldcard-archive';
import { COINKITE_KEY } from '../src/firmware/coinkite-key';
import { readPublicKey, verifyClearsigned } from '../src/firmware/pgp';

describe('Coldcard firmware names', () => {
  it('reads board, version and Edge from the name', () => {
    expect(parseStockName('2026-09-03T1541-v5.6.2-mk-coldcard.dfu')).toMatchObject({ board: 'mk', version: '5.6.2', edge: false, built: '2026-09-03 15:41' });
    expect(parseStockName('2023-06-26T1241-v4.1.9-coldcard.dfu')).toMatchObject({ board: 'mk3', version: '4.1.9' });
    expect(parseStockName('2025-11-03T1527-v5.4.5-mk4-coldcard.dfu')?.board).toBe('mk4');
    expect(parseStockName('2026-08-31T1604-v6.6.1QX-q1-coldcard.dfu')).toMatchObject({ board: 'q1', version: '6.6.1QX', edge: true });
    expect(parseStockName('2024-01-01T0000-v0.0.3Q-q1-coldcard.dfu')?.version).toBe('0.0.3Q');
  });

  it('never offers factory images', () => {
    expect(parseStockName('2026-09-03T1541-v5.6.2-mk-coldcard-factory.dfu')).toBeNull();
    expect(parseStockName('README.md')).toBeNull();
  });

  it('finds each file where the archive keeps it', () => {
    const p = (f: string) => archivePath(parseStockName(f)!);
    expect(p('2026-09-03T1541-v5.6.2-mk-coldcard.dfu')).toBe('mk/2026-09-03T1541-v5.6.2-mk-coldcard.dfu');
    expect(p('2026-08-31T1606-v6.6.1X-mk-coldcard.dfu')).toBe('edge-mk/2026-08-31T1606-v6.6.1X-mk-coldcard.dfu');
    expect(p('2026-09-03T1540-v1.5.2Q-q1-coldcard.dfu')).toBe('q1/2026-09-03T1540-v1.5.2Q-q1-coldcard.dfu');
    expect(p('2026-08-31T1604-v6.6.1QX-q1-coldcard.dfu')).toBe('edge-q1/2026-08-31T1604-v6.6.1QX-q1-coldcard.dfu');
  });

  it('matches hardware to file names', () => {
    expect(boardsFor('mk4')).toEqual(['mk4', 'mk']);
    expect(boardsFor('mk5')).toEqual(['mk']);
    expect(boardsFor('MK3')).toEqual(['mk3']);
    expect(boardsFor('mystery')).toEqual([]);
  });

  it('orders versions numerically', () => {
    expect(compareVersions('5.10.0', '5.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.5.0Q', '1.5.0')).toBe(0);
    expect(compareVersions('4.1.9', '5.0.0')).toBeLessThan(0);
  });
});

describe('the real signed list', () => {
  it('yields every non-factory image, newest first, with its checksum', async () => {
    const signed = readFileSync(new URL('./fixtures/coldcard-signatures.txt', import.meta.url), 'utf8');
    const v = await verifyClearsigned(signed, await readPublicKey(COINKITE_KEY));
    const images = imagesFromSignedText(v.text);
    expect(images.length).toBeGreaterThan(60);
    expect(images.some((i) => i.file.includes('factory'))).toBe(false);
    expect(images[0]!.file).toBe('2026-09-03T1541-v5.6.2-mk-coldcard.dfu');
    expect(images[0]!.sha256).toBe('49eb41b6b06c97f2622bc9a7496f9d5d792c0b0906e619ba0ddaf6333b561398');
    expect(images[0]!.url).toBe(
      'https://media.githubusercontent.com/media/TibaneLabs/coldcard-firmware-archive/main/mk/2026-09-03T1541-v5.6.2-mk-coldcard.dfu',
    );
    const boards = new Set(images.map((i) => i.board));
    expect([...boards].sort()).toEqual(['mk', 'mk3', 'mk4', 'q1']);
  });
});
