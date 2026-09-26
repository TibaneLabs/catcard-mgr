/**
 * Official Coldcard firmware, from TibaneLabs/coldcard-firmware-archive.
 *
 * Trust comes from Coinkite, not from the archive: the list of files and their SHA-256
 * is `signatures.txt`, clearsigned by Coinkite's release key, which this page pins. A file
 * is offered only if the signed text names it, and installed only if its bytes match.
 * The archive and GitHub only have to deliver bytes.
 */
import { COINKITE_FINGERPRINT, COINKITE_KEY } from './coinkite-key';
import { hex, sha256 } from './catalog';
import { PgpError, readPublicKey, verifyClearsigned } from './pgp';

export const ARCHIVE_REPO = 'TibaneLabs/coldcard-firmware-archive';
const SIGNATURES_URL = `https://raw.githubusercontent.com/${ARCHIVE_REPO}/main/signatures.txt`;
// The .dfu files are in Git LFS; raw.githubusercontent.com would return the pointer.
const MEDIA_BASE = `https://media.githubusercontent.com/media/${ARCHIVE_REPO}/main`;

/** How Coinkite names a file's hardware: no name (Mk3), `mk3`, `mk4`, `mk` (Mk4 and Mk5), `q1`. */
export type NamedBoard = 'mk3' | 'mk4' | 'mk' | 'q1';

export interface StockImage {
  file: string;
  url: string;
  sha256: string;
  version: string;
  /** Build time from the file name, `YYYY-MM-DD HH:MM` UTC. */
  built: string;
  board: NamedBoard;
  edge: boolean;
}

export interface SignedList {
  images: StockImage[];
  signedAt: Date | null;
}

const NAME = /^(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})-v(\d+(?:\.\d+)*Q?X?)-(?:(mk3|mk4|mk|q1)-)?coldcard(-factory)?\.dfu$/;

/**
 * `<build time>-v<version>-[<board>-]coldcard[-factory].dfu`. Factory images also rewrite
 * the bootloader and are never offered, so they parse as null like anything unexpected.
 */
export function parseStockName(file: string): Omit<StockImage, 'url' | 'sha256'> | null {
  const m = NAME.exec(file);
  if (!m || m[6]) return null;
  const version = m[4]!;
  return {
    file,
    version,
    built: `${m[1]} ${m[2]}:${m[3]}`,
    board: (m[5] as NamedBoard | undefined) ?? 'mk3',
    edge: version.endsWith('X'),
  };
}

/** Where the archive keeps a file: by line (Mk or Q1) and by stable or Edge. */
export function archivePath(img: Pick<StockImage, 'file' | 'board' | 'edge'>): string {
  const line = img.board === 'q1' ? 'q1' : 'mk';
  return `${img.edge ? `edge-${line}` : line}/${img.file}`;
}

/** Firmware entries from the verified text of signatures.txt, newest build first. */
export function imagesFromSignedText(text: string): StockImage[] {
  const out: StockImage[] = [];
  for (const line of text.split('\n')) {
    const m = /^([0-9a-f]{64}) [ *]?(\S+)$/.exec(line.trim());
    if (!m) continue;
    const meta = parseStockName(m[2]!);
    if (!meta) continue;
    out.push({ ...meta, sha256: m[1]!, url: `${MEDIA_BASE}/${archivePath(meta)}` });
  }
  return out.sort((a, b) => b.file.localeCompare(a.file));
}

/** Which named boards a Coldcard can take, from the hardware label in its `vers` reply. */
export function boardsFor(hardware: string): NamedBoard[] {
  switch (hardware.toLowerCase()) {
    case 'mk3':
      return ['mk3'];
    case 'mk4':
      return ['mk4', 'mk'];
    case 'mk5':
      return ['mk'];
    case 'q1':
      return ['q1'];
    default:
      return [];
  }
}

/** Numeric parts of a version, for ordering: `5.4.5`, `1.5.0Q`, `6.6.1X` alike. */
export function versionParts(v: string): number[] {
  return (v.match(/\d+(?:\.\d+)*/)?.[0] ?? '').split('.').filter(Boolean).map(Number);
}

export function compareVersions(a: string, b: string): number {
  const x = versionParts(a);
  const y = versionParts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Fetches signatures.txt and checks Coinkite's signature before reading a line of it. */
export async function loadSignedList(): Promise<SignedList> {
  const key = await readPublicKey(COINKITE_KEY);
  if (key.fingerprint !== COINKITE_FINGERPRINT) throw new PgpError('the pinned Coinkite key does not match its fingerprint');
  let r: Response;
  try {
    r = await fetch(SIGNATURES_URL, { cache: 'no-cache' });
  } catch {
    throw new Error('The firmware list could not be fetched. Check the network connection and try again.');
  }
  if (!r.ok) throw new Error(`The firmware list could not be fetched (HTTP ${r.status}).`);
  let verified;
  try {
    verified = await verifyClearsigned(await r.text(), key);
  } catch (err) {
    throw new Error(`The firmware list failed Coinkite's signature check, so nothing from it is offered: ${err instanceof Error ? err.message : String(err)}.`);
  }
  return { images: imagesFromSignedText(verified.text), signedAt: verified.created };
}

/** Downloads an image and checks it against the signed list. */
export async function downloadStock(image: StockImage, onProgress?: (got: number, total: number | null) => void): Promise<Uint8Array> {
  let r: Response;
  try {
    r = await fetch(image.url);
  } catch {
    throw new Error('The download could not start. Check the network connection and try again.');
  }
  if (r.status === 404) throw new Error('The archive does not hold this file. Pick another version.');
  if (!r.ok || !r.body) throw new Error(`The download failed (HTTP ${r.status}).`);
  const declared = Number(r.headers.get('Content-Length')) || null;
  const chunks: Uint8Array[] = [];
  let got = 0;
  const reader = r.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    if (got > 4 * 1024 * 1024) throw new Error('The download is far larger than any Coldcard firmware.');
    onProgress?.(got, declared);
  }
  const out = new Uint8Array(got);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  const digest = hex(await sha256(out));
  if (digest !== image.sha256) throw new Error(`The download does not match Coinkite's signed checksum (got ${digest}).`);
  return out;
}
