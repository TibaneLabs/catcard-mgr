/** The firmware mirror's manifest, written at build time by scripts/fetch-firmware.mjs. */
export type Board = 'mk3' | 'mk4-mk5' | 'q1';

export interface FirmwareImage {
  file: string;
  path: string;
  size: number;
  sha256: string;
  board: Board;
  bitcoinOnly: boolean;
  games: boolean;
  version: string;
}

export interface FirmwareRelease {
  tag: string;
  name: string;
  prerelease: boolean;
  published: string;
  url: string;
  images: FirmwareImage[];
}

export interface FirmwareManifest {
  repo: string;
  generated: string;
  releases: FirmwareRelease[];
}

export const BOARD_LABELS: Record<Board, string> = {
  mk3: 'Mk3',
  'mk4-mk5': 'Mk4 or Mk5',
  q1: 'Q1',
};

/** Which release image fits a Coldcard, from the hardware label its `vers` reply carries. */
export function boardFor(hardware: string | null): Board | null {
  switch (hardware?.toLowerCase()) {
    case 'mk3':
      return 'mk3';
    case 'mk4':
    case 'mk5':
      return 'mk4-mk5';
    case 'q1':
      return 'q1';
    default:
      return null;
  }
}

export function pickImage(release: FirmwareRelease, board: Board, bitcoinOnly: boolean, games: boolean): FirmwareImage | null {
  return release.images.find((i) => i.board === board && i.bitcoinOnly === bitcoinOnly && i.games === games) ?? null;
}

export async function loadManifest(base: string): Promise<FirmwareManifest> {
  const r = await fetch(`${base}firmware/index.json`, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`the firmware list is not available (HTTP ${r.status})`);
  return (await r.json()) as FirmwareManifest;
}

export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));
}

/** Downloads an image from the mirror and checks it against the manifest's digest. */
export async function downloadImage(base: string, image: FirmwareImage, onProgress?: (got: number, total: number) => void): Promise<Uint8Array> {
  const r = await fetch(`${base}${image.path}`);
  if (!r.ok || !r.body) throw new Error(`download failed (HTTP ${r.status})`);
  const out = new Uint8Array(image.size);
  let got = 0;
  const reader = r.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (got + value.length > out.length) throw new Error('the download is larger than the release says');
    out.set(value, got);
    got += value.length;
    onProgress?.(got, image.size);
  }
  if (got !== image.size) throw new Error(`the download stopped at ${got} of ${image.size} bytes`);
  const digest = hex(await sha256(out));
  if (digest !== image.sha256) throw new Error(`the download does not match the release checksum (got ${digest})`);
  return out;
}
