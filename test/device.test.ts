import { describe, expect, it } from 'vitest';
import { classify, hexId, hidFilters } from '../src/protocol/device';

describe('device classification', () => {
  it('knows both devices by VID:PID', () => {
    expect(classify({ vendorId: 0x39f2, productId: 0x0401 })?.kind).toBe('catcard');
    expect(classify({ vendorId: 0xd13e, productId: 0xcc10 })?.kind).toBe('coldcard');
    expect(classify({ vendorId: 0x39f2, productId: 0x0402 })).toBeNull();
  });

  it('offers exactly those two to the picker', () => {
    expect(hidFilters()).toHaveLength(2);
    expect(hexId(0x401)).toBe('0401');
  });
});
