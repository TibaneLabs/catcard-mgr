/**
 * A report-level transport: whole HID reports in, whole HID reports out.
 *
 * Both devices talk in 64-byte interrupt reports with no report ID, so the transport
 * knows nothing about either protocol's framing. Keeping it this thin means the framing
 * code is plain functions over byte arrays, which is what the tests exercise.
 */
export interface Transport {
  /** Size of one report, in bytes. */
  readonly reportLength: number;
  /** Send one report. `report` must be exactly `reportLength` bytes. */
  write(report: Uint8Array): Promise<void>;
  /** Receive the next report, or reject with `TransportTimeout` after `timeoutMs`. */
  read(timeoutMs: number): Promise<Uint8Array>;
  /** Throw away any reports received but not yet read. */
  drain(): void;
  close(): Promise<void>;
}

export class TransportTimeout extends Error {
  constructor(ms: number) {
    super(`no reply from the device within ${ms} ms`);
    this.name = 'TransportTimeout';
  }
}

export class TransportClosed extends Error {
  constructor() {
    super('the device is no longer connected');
    this.name = 'TransportClosed';
  }
}

interface Waiter {
  resolve: (r: Uint8Array) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** WebHID-backed transport. The device must already be open. */
export class WebHidTransport implements Transport {
  readonly reportLength = 64;
  private queue: Uint8Array[] = [];
  private waiter: Waiter | null = null;
  private closed = false;

  constructor(private readonly dev: HIDDevice) {
    dev.addEventListener('inputreport', this.onReport);
    navigator.hid.addEventListener('disconnect', this.onDisconnect);
  }

  private onReport = (ev: HIDInputReportEvent): void => {
    const view = ev.data;
    const report = new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
    const w = this.waiter;
    if (w) {
      this.waiter = null;
      clearTimeout(w.timer);
      w.resolve(report);
    } else {
      this.queue.push(report);
    }
  };

  private onDisconnect = (ev: HIDConnectionEvent): void => {
    if (ev.device === this.dev) this.teardown(new TransportClosed());
  };

  private teardown(err: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.dev.removeEventListener('inputreport', this.onReport);
    navigator.hid.removeEventListener('disconnect', this.onDisconnect);
    const w = this.waiter;
    if (w) {
      this.waiter = null;
      clearTimeout(w.timer);
      w.reject(err);
    }
  }

  async write(report: Uint8Array): Promise<void> {
    if (this.closed) throw new TransportClosed();
    if (report.length !== this.reportLength) {
      throw new RangeError(`report must be ${this.reportLength} bytes, got ${report.length}`);
    }
    // Report ID 0: the device defines none, and Chromium wants it said explicitly.
    await this.dev.sendReport(0, new Uint8Array(report));
  }

  read(timeoutMs: number): Promise<Uint8Array> {
    if (this.closed) return Promise.reject(new TransportClosed());
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    if (this.waiter) return Promise.reject(new Error('concurrent read on a transport'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new TransportTimeout(timeoutMs));
      }, timeoutMs);
      this.waiter = { resolve, reject, timer };
    });
  }

  drain(): void {
    this.queue.length = 0;
  }

  async close(): Promise<void> {
    this.teardown(new TransportClosed());
    try {
      await this.dev.close();
    } catch {
      // Already gone; nothing to close.
    }
  }
}

/**
 * Runs async jobs one after another. Both protocols are strictly request/reply on a
 * single pipe, so two commands in flight would read each other's answers.
 */
export class Serial {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(job: () => Promise<T>): Promise<T> {
    const next = this.tail.then(job, job);
    this.tail = next.catch(() => undefined);
    return next;
  }
}
