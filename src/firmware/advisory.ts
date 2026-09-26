/**
 * Coldcard firmware that must be upgraded at once.
 *
 * Seeds generated on the device by these versions come from a weak random number
 * generator. The fixed releases are 4.2.0 (Mk3 line), 5.6.0 (Mk4 and Mk5 line) and
 * 1.5.0Q (Q1 line). Anything older on the same line is flagged, including 3.x and 0.xQ,
 * which predate the fix too. Edge builds (`X`) are not covered by this rule.
 */
import { compareVersions } from './coldcard-archive';

export interface Advisory {
  /** The first fixed release on this device's line. */
  fixedIn: string;
}

export function urgentUpgrade(version: string): Advisory | null {
  const v = version.trim();
  if (!/^\d+(\.\d+)*Q?X?$/.test(v) || v.endsWith('X')) return null;
  if (v.endsWith('Q')) return compareVersions(v, '1.5.0') < 0 ? { fixedIn: '1.5.0Q' } : null;
  const major = Number(v.split('.')[0]);
  if (major <= 4) return compareVersions(v, '4.2.0') < 0 ? { fixedIn: '4.2.0' } : null;
  if (major === 5) return compareVersions(v, '5.6.0') < 0 ? { fixedIn: '5.6.0' } : null;
  return null;
}
