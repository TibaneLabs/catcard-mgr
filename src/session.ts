/**
 * The one connected device, as reactive state the UI renders from.
 *
 * Only one device is held at a time: both protocols are a single request/reply pipe,
 * and a management page acting on two wallets at once is a way to act on the wrong one.
 */
import { reactive, readonly } from 'vue';
import { sha256 } from './firmware/catalog';
import type { InstallProgress } from './firmware/install';
import { CatCardClient, OfferError, PairingError, type DeviceLog, type Identify, type PendingPairing } from './protocol/catcard';
import type { AddressReply, Call } from './protocol/hostwallet';
import type { Session as NcrySession } from './protocol/ncry';
import { ColdcardClient, type ColdcardVersion } from './protocol/coldcard';
import { classify, grantedDevices, isWebHidSupported, requestDevice, type DeviceKind, type KnownDevice } from './protocol/device';
import { WebHidTransport } from './protocol/transport';

export type Info =
  | { kind: 'catcard'; identify: Identify }
  | { kind: 'coldcard'; version: ColdcardVersion; chain: string | null };

export type Phase = 'idle' | 'connecting' | 'ready' | 'error';

/** What an install puts on the device: decides what the page says while it restarts. */
export type InstallTarget = 'catcard' | 'coldcard';

export interface PingResult {
  ms: number;
  ok: boolean;
  at: Date;
}

interface State {
  supported: boolean;
  phase: Phase;
  error: string | null;
  known: KnownDevice | null;
  productName: string;
  vendorId: number;
  productId: number;
  info: Info | null;
  identifiedAt: Date | null;
  pings: PingResult[];
  log: DeviceLog | null;
  busy: boolean;
  /** Set while a firmware install runs, and after it asks the device to restart. */
  installing: boolean;
  /** Set when the device left because it restarted to install firmware. */
  restarted: boolean;
  /** Which firmware that restart installs. */
  restartTarget: InstallTarget | null;
  /** Which device restarted: decides whether it comes back under the same name. */
  restartFrom: DeviceKind | null;
  /** A CatCard channel paired for this connection; gone on unplug or reload. */
  paired: boolean;
  /** What the CatCard last shared on this paired session; signing needs it. */
  addresses: AddressReply | null;
}

const state = reactive<State>({
  supported: isWebHidSupported(),
  phase: 'idle',
  error: null,
  known: null,
  productName: '',
  vendorId: 0,
  productId: 0,
  info: null,
  identifiedAt: null,
  pings: [],
  log: null,
  busy: false,
  installing: false,
  restarted: false,
  restartTarget: null,
  restartFrom: null,
  paired: false,
  addresses: null,
});

let device: HIDDevice | null = null;
let transport: WebHidTransport | null = null;
let client: CatCardClient | ColdcardClient | null = null;
let paired: NcrySession | null = null;

export const session = readonly(state);

function describe(err: unknown): string {
  if (err instanceof DOMException && err.name === 'NotAllowedError') {
    return 'The browser refused access to this device. On Linux, add a udev rule for it and replug.';
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

function reset(): void {
  device = null;
  transport = null;
  client = null;
  state.known = null;
  state.productName = '';
  state.vendorId = 0;
  state.productId = 0;
  state.info = null;
  state.identifiedAt = null;
  state.pings = [];
  state.log = null;
  state.busy = false;
  state.installing = false;
  dropPairing();
}

function dropPairing(): void {
  paired = null;
  state.paired = false;
  state.addresses = null;
}

/** True when the browser exposes a report the page can send to on this device. */
function hasWritableReport(dev: HIDDevice): boolean {
  return dev.collections.some((c) => (c.outputReports?.length ?? 0) > 0);
}

async function attach(dev: HIDDevice): Promise<void> {
  const known = classify(dev);
  if (!known) throw new Error('This is not a CatCard or a Coldcard.');
  await disconnect();
  state.phase = 'connecting';
  state.error = null;
  state.known = known;
  state.productName = dev.productName;
  state.vendorId = dev.vendorId;
  state.productId = dev.productId;
  try {
    if (!dev.opened) await dev.open();
    if (!hasWritableReport(dev)) {
      throw new Error(
        'The browser opened the device but exposes no report the page can write to. ' +
          'Chromium hides HID interfaces it treats as security keys, which would stop this page from reaching it.',
      );
    }
    device = dev;
    transport = new WebHidTransport(dev);
    if (known.kind === 'catcard') {
      client = new CatCardClient(transport);
    } else {
      const cc = new ColdcardClient(transport);
      await cc.resync();
      client = cc;
    }
    state.restarted = false;
    state.restartTarget = null;
    state.restartFrom = null;
    await identify();
    state.phase = 'ready';
  } catch (err) {
    state.phase = 'error';
    state.error = describe(err);
    await transport?.close();
    device = null;
    transport = null;
    client = null;
  }
}

/** Opens the browser's picker and connects to what the user chooses. */
export async function connect(): Promise<void> {
  let dev: HIDDevice | null;
  try {
    dev = await requestDevice();
  } catch (err) {
    state.phase = 'error';
    state.error = describe(err);
    return;
  }
  if (dev) await attach(dev);
}

/** Reconnects silently to a device this site was already allowed to use. */
export async function reconnectGranted(): Promise<void> {
  if (!state.supported || device) return;
  const [dev] = await grantedDevices();
  if (dev) await attach(dev);
}

export async function disconnect(): Promise<void> {
  const t = transport;
  reset();
  state.phase = 'idle';
  state.error = null;
  await t?.close();
}

/** Asks the device who it is. Runs on connect, and again on request. */
export async function identify(): Promise<void> {
  if (!client) return;
  state.busy = true;
  try {
    if (client instanceof CatCardClient) {
      state.info = { kind: 'catcard', identify: await client.identify() };
    } else {
      const version = await client.version();
      // Chain is an extra: an older firmware without it should still identify.
      let chain: string | null = null;
      try {
        chain = await client.blockChain();
      } catch {
        chain = null;
      }
      state.info = { kind: 'coldcard', version, chain };
    }
    state.identifiedAt = new Date();
  } finally {
    state.busy = false;
  }
}

export async function refresh(): Promise<void> {
  try {
    await identify();
    state.error = null;
  } catch (err) {
    state.error = describe(err);
  }
}

export async function ping(): Promise<void> {
  if (!client) return;
  state.busy = true;
  const payload = crypto.getRandomValues(new Uint8Array(16));
  try {
    const r = await client.ping(payload);
    const ok = r.echo.length === payload.length && r.echo.every((b, i) => b === payload[i]);
    state.pings = [{ ms: r.ms, ok, at: new Date() }, ...state.pings].slice(0, 8);
    state.error = ok ? null : 'The device answered the ping with different bytes than it was sent.';
  } catch (err) {
    state.error = describe(err);
  } finally {
    state.busy = false;
  }
}

export async function readLog(): Promise<void> {
  if (!(client instanceof CatCardClient)) return;
  state.busy = true;
  try {
    state.log = await client.readLog();
    state.error = null;
  } catch (err) {
    state.error = describe(err);
  } finally {
    state.busy = false;
  }
}

/** Starts pairing with the connected CatCard; the caller shows the code and asks. */
export async function startPairing(): Promise<PendingPairing> {
  if (!(client instanceof CatCardClient)) throw new Error('No CatCard is connected.');
  dropPairing();
  return client.startPairing();
}

/** Both people accepted the code: from now on, host-wallet commands may run. */
export function setPaired(session: NcrySession): void {
  paired = session;
  state.paired = true;
  state.addresses = null;
}

export function unpair(): void {
  dropPairing();
}

export function setAddresses(a: AddressReply | null): void {
  state.addresses = a;
}

/**
 * Runs one command inside the paired channel. A session that fails is over for good,
 * so the page drops it and asks to pair again rather than retrying on it.
 */
export const hostCall: Call = async (opcode, payload) => {
  const c = client;
  const s = paired;
  if (!(c instanceof CatCardClient) || !s) throw new PairingError('Pair with the CatCard first.');
  try {
    return await c.sealed(s, opcode, payload);
  } catch (err) {
    if (paired === s) dropPairing();
    throw err;
  }
};

/** The connected Coldcard's client, for the firmware switch. */
export function coldcardClient(): ColdcardClient | null {
  return client instanceof ColdcardClient ? client : null;
}

/**
 * Installs a firmware image on whichever device is connected. The device is expected to
 * leave the bus when it restarts to install, so that departure is reported as a restart,
 * not as an unplug. Resolves once the install has been handed to the device.
 *
 * A Coldcard takes the image through stock firmware's uploader and restarts when asked.
 * A CatCard takes it as one offer, checks it, and puts it on its own screen: nothing is
 * installed until the person approves there.
 */
export async function installImage(
  target: InstallTarget,
  image: Uint8Array,
  header: Uint8Array,
  onProgress: (p: InstallProgress) => void,
): Promise<void> {
  const c = client;
  if (!c || !state.known) throw new Error('No device is connected.');
  state.installing = true;
  state.restartTarget = target;
  state.restartFrom = state.known.kind;
  state.busy = true;
  try {
    if (c instanceof ColdcardClient) {
      await c.installFirmware(image, header, sha256, onProgress);
    } else {
      const capBits = state.info?.kind === 'catcard' ? state.info.identify.caps : 0;
      const accepted = await c.offerImage(image, capBits, onProgress);
      const offer = { verified: accepted.verified, older: accepted.older, version: accepted.version };
      onProgress({ stage: 'approve', sent: image.length, total: image.length, offer });
      const outcome = await c.awaitApproval();
      if (outcome === 'declined') throw new OfferError('Declined on the CatCard. Nothing was installed.');
      onProgress({ stage: 'reboot', sent: image.length, total: image.length, offer });
    }
    state.restarted = true;
  } catch (err) {
    // Nothing is restarting after all: a later unplug is an unplug.
    state.installing = false;
    throw err;
  } finally {
    state.busy = false;
  }
}

if (state.supported) {
  navigator.hid.addEventListener('disconnect', (ev) => {
    if (ev.device === device) {
      const restarting = state.installing;
      reset();
      state.phase = 'idle';
      state.restarted = restarting;
      state.error = restarting ? null : 'The device was unplugged.';
    }
  });
  // A device this site already has permission for can be opened without a prompt.
  navigator.hid.addEventListener('connect', () => {
    void reconnectGranted();
  });
}
