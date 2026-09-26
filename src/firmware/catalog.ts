/**
 * CatCard releases, read live from GitHub.
 *
 * The release list and each file's SHA-256 come from GitHub's releases API, which lets
 * any page read it. The files themselves come through gh-release.tibane.net, a proxy
 * that adds the CORS headers GitHub's file host leaves out. Every download is checked
 * against GitHub's digest, so the proxy only has to deliver bytes, not be trusted.
 */
export type Board = 'mk3' | 'mk4-mk5' | 'q1';

export const RELEASE_REPO = 'TibaneLabs/catcard';
export const PROXY = 'https://gh-release.tibane.net';

export interface FirmwareImage {
  file: string;
  /** Where the page downloads it: the proxy. */
  url: string;
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

export const BOARD_LABELS: Record<Board, string> = {
  mk3: 'Mk3',
  'mk4-mk5': 'Mk4 or Mk5',
  q1: 'Q1',
};

const NAME = /^catcard-(mk3|mk4-mk5|q1)(-bitcoin)?(-games)?-(.+)\.dfu$/;

/**
 * `catcard-{board}[-bitcoin][-games]-{version}.dfu`, as the release notes define it.
 * Anything else is null, so an unexpected asset is skipped rather than guessed at.
 */
export function parseAssetName(name: string): Pick<FirmwareImage, 'board' | 'bitcoinOnly' | 'games' | 'version'> | null {
  const m = NAME.exec(name);
  if (!m) return null;
  return { board: m[1] as Board, bitcoinOnly: Boolean(m[2]), games: Boolean(m[3]), version: m[4]! };
}

/** The parts of GitHub's release JSON this page reads. */
export interface GithubRelease {
  tag_name: string;
  name: string | null;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  html_url: string;
  assets: { name: string; size: number; digest?: string | null; state?: string }[];
}

/**
 * Releases with at least one usable image, newest first. An asset without a SHA-256
 * digest is left out: it could not be checked, so it is not offered.
 */
export function releasesFromGithub(json: GithubRelease[], repo = RELEASE_REPO, proxy = PROXY): FirmwareRelease[] {
  const out: FirmwareRelease[] = [];
  for (const r of json) {
    if (r.draft) continue;
    const images: FirmwareImage[] = [];
    for (const a of r.assets) {
      const meta = parseAssetName(a.name);
      const digest = /^sha256:([0-9a-f]{64})$/.exec(a.digest ?? '');
      if (!meta || !digest || (a.state && a.state !== 'uploaded')) continue;
      images.push({
        file: a.name,
        url: `${proxy}/${repo}/${encodeURIComponent(r.tag_name)}/${encodeURIComponent(a.name)}`,
        size: a.size,
        sha256: digest[1]!,
        ...meta,
      });
    }
    if (!images.length) continue;
    images.sort((x, y) => x.file.localeCompare(y.file));
    out.push({
      tag: r.tag_name,
      name: r.name || r.tag_name,
      prerelease: r.prerelease,
      published: r.published_at ?? '',
      url: r.html_url,
      images,
    });
  }
  return out;
}

export async function loadReleases(repo = RELEASE_REPO): Promise<FirmwareRelease[]> {
  const r = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=10`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (r.status === 403 || r.status === 429) {
    const reset = Number(r.headers.get('X-RateLimit-Reset'));
    const when = reset ? ` Try again after ${new Date(reset * 1000).toLocaleTimeString()}.` : ' Try again later.';
    throw new Error(`GitHub is limiting how often this network can ask for the release list.${when}`);
  }
  if (!r.ok) throw new Error(`GitHub did not return the release list (HTTP ${r.status}).`);
  return releasesFromGithub((await r.json()) as GithubRelease[], repo);
}

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

export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));
}

/** Downloads an image and checks it against GitHub's digest for it. */
export async function downloadImage(image: FirmwareImage, onProgress?: (got: number, total: number) => void): Promise<Uint8Array> {
  let r: Response;
  try {
    r = await fetch(image.url);
  } catch {
    throw new Error('The download could not start. Check the network connection and try again.');
  }
  if (!r.ok || !r.body) {
    const detail = (await r.text().catch(() => '')).trim();
    throw new Error(`The download failed (HTTP ${r.status})${detail ? `: ${detail}` : '.'}`);
  }
  const out = new Uint8Array(image.size);
  let got = 0;
  const reader = r.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (got + value.length > out.length) throw new Error('The download is larger than GitHub says the file is.');
    out.set(value, got);
    got += value.length;
    onProgress?.(got, image.size);
  }
  if (got !== image.size) throw new Error(`The download stopped at ${got} of ${image.size} bytes.`);
  const digest = hex(await sha256(out));
  if (digest !== image.sha256) throw new Error(`The download does not match GitHub's checksum for this file (got ${digest}).`);
  return out;
}
