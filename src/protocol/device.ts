import { CATCARD_PID, CATCARD_VID } from './catcard';
import { COLDCARD_PID, COLDCARD_VID } from './coldcard';

export type DeviceKind = 'catcard' | 'coldcard';

export interface KnownDevice {
  kind: DeviceKind;
  label: string;
  vendorId: number;
  productId: number;
}

export const KNOWN_DEVICES: readonly KnownDevice[] = [
  { kind: 'catcard', label: 'CatCard', vendorId: CATCARD_VID, productId: CATCARD_PID },
  { kind: 'coldcard', label: 'Coldcard', vendorId: COLDCARD_VID, productId: COLDCARD_PID },
];

export function classify(dev: { vendorId: number; productId: number }): KnownDevice | null {
  return KNOWN_DEVICES.find((k) => k.vendorId === dev.vendorId && k.productId === dev.productId) ?? null;
}

export function hidFilters(): HIDDeviceFilter[] {
  return KNOWN_DEVICES.map((k) => ({ vendorId: k.vendorId, productId: k.productId }));
}

export function isWebHidSupported(): boolean {
  return typeof navigator !== 'undefined' && 'hid' in navigator && typeof navigator.hid?.requestDevice === 'function';
}

export function hexId(n: number): string {
  return n.toString(16).padStart(4, '0');
}

/** Opens the browser's device picker. Resolves to null when the user dismisses it. */
export async function requestDevice(): Promise<HIDDevice | null> {
  const picked = await navigator.hid.requestDevice({ filters: hidFilters() });
  return picked[0] ?? null;
}

/** Devices this origin was already granted, still plugged in. */
export async function grantedDevices(): Promise<HIDDevice[]> {
  const all = await navigator.hid.getDevices();
  return all.filter((d) => classify(d) !== null);
}
