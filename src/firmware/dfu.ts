/**
 * DfuSe container (ST UM0391), just enough to take the image out of it.
 *
 *   prefix  11 B   "DfuSe", u8 version, u32 image size, u8 target count
 *   target 274 B   "Target", u8 alt, u32 named, 255 B name, u32 size, u32 element count
 *   element  8 B   u32 address, u32 size, then the bytes
 *   suffix  16 B   bcdDevice, PID, VID, bcdDFU, "UFD", length, CRC32
 */
export interface DfuImage {
  targetName: string;
  address: number;
  image: Uint8Array;
}

export class DfuError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'DfuError';
  }
}

const PREFIX_LEN = 11;
const TARGET_LEN = 274;
const ELEMENT_LEN = 8;
const SUFFIX_LEN = 16;

/** The first element of the first target: where a firmware image lives. */
export function parseDfu(file: Uint8Array): DfuImage {
  const v = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const ascii = (at: number, n: number) => String.fromCharCode(...file.subarray(at, at + n));
  if (file.length < PREFIX_LEN + TARGET_LEN + ELEMENT_LEN + SUFFIX_LEN || ascii(0, 5) !== 'DfuSe') {
    throw new DfuError('not a DfuSe file');
  }
  if ((file[10] ?? 0) < 1) throw new DfuError('the file holds no targets');
  let at = PREFIX_LEN;
  if (ascii(at, 6) !== 'Target') throw new DfuError('target prefix missing');
  const named = v.getUint32(at + 7, true);
  const rawName = file.subarray(at + 11, at + 11 + 255);
  const nul = rawName.indexOf(0);
  const targetName = named ? ascii(at + 11, nul < 0 ? 255 : nul) : '';
  const elements = v.getUint32(at + 270, true);
  if (elements < 1) throw new DfuError('the target holds no elements');
  at += TARGET_LEN;
  const address = v.getUint32(at, true);
  const size = v.getUint32(at + 4, true);
  at += ELEMENT_LEN;
  if (at + size > file.length - SUFFIX_LEN) throw new DfuError('the element runs past the end of the file');
  return { targetName, address, image: file.slice(at, at + size) };
}
