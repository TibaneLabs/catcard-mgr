import { TransportClosed, TransportTimeout, type Transport } from '../src/protocol/transport';

/** A transport whose device side is a function from request reports to reply reports. */
export class FakeTransport implements Transport {
  readonly reportLength = 64;
  readonly written: Uint8Array[] = [];
  private inbox: Uint8Array[] = [];

  constructor(private readonly device: (report: Uint8Array, all: Uint8Array[]) => Uint8Array[]) {}

  async write(report: Uint8Array): Promise<void> {
    if (report.length !== 64) throw new RangeError('bad report');
    this.written.push(report);
    this.inbox.push(...this.device(report, this.written));
  }

  /** Set to make the device leave the bus once its queued replies are read. */
  gone = false;

  /** Queue a report the device sends by itself. */
  push(report: Uint8Array): void {
    this.inbox.push(report);
  }

  async read(timeoutMs: number): Promise<Uint8Array> {
    const r = this.inbox.shift();
    if (!r && this.gone) throw new TransportClosed();
    if (!r) throw new TransportTimeout(timeoutMs);
    return r;
  }

  poll(): Uint8Array | null {
    return this.inbox.shift() ?? null;
  }

  drain(): void {
    this.inbox.length = 0;
  }

  async close(): Promise<void> {}
}
