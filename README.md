<p align="center">
  <img src="public/favicon.svg" alt="CatCard" width="96" height="96">
</p>

<h1 align="center">CatCard Manager</h1>

A web page for managing a [CatCard](https://github.com/TibaneLabs/catcard) or a stock Coldcard over USB. It runs
entirely in your browser and talks to the device with WebHID. No server is involved and nothing leaves the page.

**Use it:** https://tibanelabs.github.io/catcard-mgr/

## What it does today

- **Identifies the connected device.** A CatCard reports its board, firmware version, USB protocol version, whether
  it is locked, unlocked or not yet set up, and which USB features its build accepts. A bench build that exposes
  key injection, PIN entry or the memory monitor is flagged as unsafe for real funds. A Coldcard reports its
  firmware version, build date, bootloader, hardware and network.
- **Checks the connection.** Ping sends random bytes and checks the echo.
- **Reads the CatCard diagnostic log**, which never contains the PIN or seed.
- **Reconnects on its own** to a device the site was already allowed to use, when it is plugged back in.

## Browser support

WebHID exists only in Chromium-based desktop browsers: Chrome, Edge, Opera and Brave. Firefox and Safari do not
implement it. The page must be served over HTTPS or from `localhost`.

On Linux, `/dev/hidraw*` is root-only by default. Add a udev rule and replug:

```
# /etc/udev/rules.d/70-catcard.rules
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="39f2", ATTRS{idProduct}=="0401", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="d13e", ATTRS{idProduct}=="cc10", TAG+="uaccess"
```

## Devices

| Device | USB ID | Protocol |
|---|---|---|
| CatCard | `39f2:0401` | `catcard-usb` framing: 64-byte START/CONT frames with a sequence byte, u16 opcode/status |
| Coldcard | `d13e:cc10` | Stock framing: a length/last/encrypted header byte and 63 bytes of a 4-character command |

Only the unencrypted Coldcard commands are implemented so far. Chromium hides HID interfaces that it treats as
FIDO security keys; if a Coldcard's interface falls in that class, the page reports that the browser gave it no
writable report instead of hanging.

## Development

```sh
npm install
npm run dev       # http://localhost:5173
npm run check     # type check and unit tests
npm run build     # static site in dist/
```

The protocol code in `src/protocol/` is plain TypeScript over byte arrays, independent of Vue, and is tested against
a fake transport in `test/`. `src/session.ts` holds the one connected device as reactive state for the UI.

Every push to `master` is checked, built and published to GitHub Pages by `.github/workflows/pages.yml`.

## License

MIT. Copyright © 2026 Karpelès Lab Inc.
