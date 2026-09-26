/**
 * The 128-byte firmware header at 0x3F80 of a Coldcard-format image, as CatCard's own
 * `catcard-fwhdr` describes it. Read here so the page can refuse an image for the wrong
 * board before sending a byte, instead of letting the device refuse it afterwards.
 */
export const HEADER_OFFSET = 0x4000 - 128;
export const HEADER_LEN = 128;
export const MAGIC = 0xcc001234;

/** Bits of `hw_compat`. */
export const HW = {
  mk3: 0x04,
  mk4: 0x08,
  q1: 0x10,
  mk5: 0x20,
} as const;

export interface FirmwareHeader {
  version: string;
  /** `YYYY-MM-DD HH:MM`, from the BCD timestamp. */
  built: string;
  pubkeyNum: number;
  firmwareLength: number;
  hwCompat: number;
  /** The raw 128 bytes, which the upload repeats as a trailer. */
  raw: Uint8Array;
}

export class HeaderError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'HeaderError';
  }
}

function bcd(b: number): string {
  const hi = b >> 4;
  const lo = b & 0xf;
  return hi <= 9 && lo <= 9 ? `${hi}${lo}` : '??';
}

export function parseHeader(image: Uint8Array): FirmwareHeader {
  if (image.length < HEADER_OFFSET + HEADER_LEN) throw new HeaderError('image is shorter than its header');
  const raw = image.slice(HEADER_OFFSET, HEADER_OFFSET + HEADER_LEN);
  const v = new DataView(raw.buffer);
  if (v.getUint32(0, true) !== MAGIC) throw new HeaderError('no firmware header: bad magic');
  const ts = raw.subarray(4, 12);
  const built = `20${bcd(ts[0]!)}-${bcd(ts[1]!)}-${bcd(ts[2]!)} ${bcd(ts[3]!)}:${bcd(ts[4]!)}`;
  const vb = raw.subarray(12, 20);
  const end = vb.indexOf(0);
  const version = String.fromCharCode(...vb.subarray(0, end < 0 ? 8 : end));
  return {
    version,
    built,
    pubkeyNum: v.getUint32(20, true),
    firmwareLength: v.getUint32(24, true),
    hwCompat: v.getUint32(32, true),
    raw,
  };
}

/** Hardware labels an image says it runs on; empty means it does not say. */
export function compatibleHardware(hwCompat: number): string[] {
  return (Object.keys(HW) as (keyof typeof HW)[]).filter((k) => (hwCompat & HW[k]) !== 0);
}

/**
 * Everything checkable about an image without the signing key: header present, length
 * as declared and aligned, and made for this board. Returns the problems found.
 */
export function checkImage(image: Uint8Array, header: FirmwareHeader, hardware: string | null): string[] {
  const problems: string[] = [];
  if (header.firmwareLength !== image.length) {
    problems.push(`the header declares ${header.firmwareLength} bytes but the image holds ${image.length}`);
  }
  if (image.length % 256 !== 0) problems.push('the image length is not a multiple of 256 bytes');
  const hw = hardware?.toLowerCase() as keyof typeof HW | undefined;
  if (hw && hw in HW && header.hwCompat !== 0 && (header.hwCompat & HW[hw]) === 0) {
    problems.push(`the image is built for ${compatibleHardware(header.hwCompat).join(', ') || 'other hardware'}, not ${hw}`);
  }
  return problems;
}
