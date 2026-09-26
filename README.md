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
- **Pairs with a CatCard, shares addresses, and signs.** The page pairs an encrypted channel with the CatCard
  (ncry v2): both screens show the same six-digit code, and the person checks that they match. Once paired, the
  page can ask for the wallet's addresses and extended keys, and send a transaction to sign: a Bitcoin PSBT, an
  Ethereum transaction or a Solana transaction. Every request is approved on the CatCard, and only accounts shared
  in the same session can sign. For a PSBT the page finds this wallet's keys from its derivation records, so nobody
  types paths. Pairing ends when the CatCard is unplugged or the page reloads.
- **Warns about vulnerable Coldcard firmware.** A Coldcard running 4.x below 4.2.0, 5.x below 5.6.0, or a Q1 below
  1.5.0Q (the early 0.xQ builds included) gets a full-width warning to upgrade now, with buttons for the official update or CatCard. Seeds
  those versions generate on the device are weak, and the warning says so: a seed made there stays weak after the
  upgrade and should be replaced.
- **Updates a Coldcard's own firmware.** With a Coldcard connected, the page offers every official release for its
  model, newest first, with Coinkite's experimental Edge builds behind a switch. The list comes from Coinkite's
  `signatures.txt`, whose PGP signature is checked against Coinkite's release key before any line of it is used.
  A downloaded file must match the checksum in that signed list. Images that also rewrite the bootloader are never
  offered, and an older version than the one installed is flagged.
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

### Official Coldcard firmware

Coldcard releases come from [TibaneLabs/coldcard-firmware-archive](https://github.com/TibaneLabs/coldcard-firmware-archive),
an unofficial archive of Coinkite's signed images. The archive is not trusted either. Trust comes from Coinkite's
`signatures.txt`, a list of SHA-256 checksums clearsigned with Coinkite's release key:

```
Peter D. Gray <peter@coinkite.com>
4589 779A DFC1 4F33 2753  4EA8 A3A3 1BAD 5A2A 5B10
```

That key is pinned in `src/firmware/coinkite-key.ts`, and the page checks the block against the fingerprint before
using it. The signature check is a small RSA verifier in `src/firmware/pgp.ts` on top of WebCrypto, tested against
the real file and tampered copies. The list is read from raw.githubusercontent.com. The images are stored in Git LFS,
so they are read from media.githubusercontent.com, which serves the real file with CORS headers.

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
