// Pure helpers for the firmware mirror, shared by the fetch script and the tests.

/** Boards as release asset names spell them. */
export const BOARDS = ['mk3', 'mk4-mk5', 'q1'];

const NAME = /^catcard-(mk3|mk4-mk5|q1)(-bitcoin)?(-games)?-(.+)\.dfu$/;

/**
 * `catcard-{board}[-bitcoin][-games]-{version}.dfu`, as the release notes define it.
 * Returns null for anything else, so an unexpected asset is skipped rather than guessed at.
 */
export function parseAssetName(name) {
  const m = NAME.exec(name);
  if (!m) return null;
  return { board: m[1], bitcoinOnly: Boolean(m[2]), games: Boolean(m[3]), version: m[4] };
}

/** `sha256sum` output: `<64 hex>  <name>` per line. */
export function parseSums(text) {
  const sums = new Map();
  for (const line of text.split('\n')) {
    const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(line.trim());
    if (m) sums.set(m[2], m[1]);
  }
  return sums;
}

/**
 * A short digest of what the mirror would contain, from release metadata alone. The
 * scheduled workflow compares it with the deployed manifest to decide whether to rebuild.
 */
export async function fingerprint(releases) {
  const parts = releases.map((r) => [r.tag_name, r.prerelease, ...r.assets.map((a) => `${a.id}:${a.updated_at}`).sort()].join('|'));
  const data = new TextEncoder().encode(parts.join('\n'));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Buffer.from(digest).toString('hex').slice(0, 32);
}
