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
- **Switches a Coldcard to CatCard.** With a Coldcard connected, the page offers to install CatCard. You pick a
  release, Bitcoin only or all chains, and with or without the games. The page picks the image for the Coldcard's
  model, then checks it before sending anything. The file must match the SHA-256 that GitHub lists for it, and the
  firmware header must be present, declare the right length and name this model. The image then goes through stock
  firmware's own uploader, and the Coldcard's digest of what it received is compared with the page's before the
  device is asked to restart and install.
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

Only the unencrypted Coldcard commands are implemented so far.

## Where firmware comes from

The page reads the release list and each file's SHA-256 live from GitHub's releases API, so a new CatCard release
is offered as soon as it is published. GitHub serves the files themselves from a host that sends no CORS headers,
which stops a web page from reading them, so the page downloads them through
[gh-release.tibane.net](https://gh-release.tibane.net/), a caching proxy that adds those headers. The proxy is not
trusted: a file that does not match GitHub's digest is refused.

## Clean-room note

CatCard's firmware is written without studying stock Coldcard software; see its `CLEANROOM.md`. This manager is a
separate project and does speak the stock USB protocol, in `src/protocol/coldcard.ts`. CatCard firmware
contributors should not read that file.

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
