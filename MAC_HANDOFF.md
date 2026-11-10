# RAD Viewer 0.9.3 — Apple Silicon Mac handoff

This source is prepared on Windows. **A native Mac build, Finder launch, WKWebView
image loading, trackpad behavior and Retina appearance still need verification on
your Mac.** The Windows release is validated separately; see verification/RELEASE_0.9.3.md.

## What to copy

Copy `output/RAD-Viewer-0.9.3-Mac-source.zip` and its `.zip.sha256` file to your
Mac. Extract the ZIP into a local writable folder, for example
`~/Projects/RAD-Viewer-0.9.3-Mac-source`. Keep the folder on the Mac's internal
drive for the first test. The package captures the current working source,
including untracked files and all six required `demo/John Smith` assets. It does
not contain node_modules, target, dist, Git history, credentials or private input
sample folders. It includes patient-derived demo pixels: keep this archive private.

In Terminal, in the folder containing the ZIP:

```sh
shasum -a 256 -c RAD-Viewer-0.9.3-Mac-source.zip.sha256
```

From the extracted project root, verify all packaged source files **before editing**:

```sh
python3 scripts/package_mac_source.py --verify .
```

## Set up the Mac

Use an Apple Silicon Mac running macOS 12 or newer. The selected Node.js version
may require a newer macOS version; use a version supported by your Mac. The build
must run natively as arm64, not inside a Terminal configured for Rosetta.

```sh
uname -m
xcode-select --install
```

The first command should print `arm64`. Complete the Apple command-line tools
installation if needed. Install native ARM64 Node.js 24 LTS (or Node.js 22.12+)
from https://nodejs.org/ and current stable Rust via https://rustup.rs/. Reopen
Terminal after installation. Rust must be at least 1.89 for the existing file
locking API; use current stable. Python 3.10+ is needed only for package and pixel
verification. Command-line tools include Python on many setups; otherwise install
Python 3 from https://www.python.org/downloads/macos/.

Check the environment, then install the pinned dependencies:

```sh
node --version
npm --version
rustc --version
rustup show active-toolchain
npm ci
```

The Rust host should be `aarch64-apple-darwin`. Keep Cargo.lock and
package-lock.json. Do not copy Windows node_modules or target folders.

## Test and build

```sh
npm test
npm run build
cargo test --workspace --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
python3 scripts/check_platform_pixels.py
npm run tauri -- dev
```

The frontend suite exercises Windows behavior explicitly and has a separate
Mac-specific suite, so it can run on either host. The pixel script compares all
five demo inputs, float32 decoded samples, neutral/suggested RGBA, and lossless PNG
exports against the included Windows reference. Do **not** use `--record` on Mac.
Any difference needs investigation; it is not automatically an acceptable change.
Additional clinical formats and actual display appearance require manual checks.

After exiting the development viewer, make the native release:

```sh
npm run tauri -- build --target aarch64-apple-darwin -- --locked
open "target/aarch64-apple-darwin/release/bundle/macos/RAD Viewer.app"
```

Tauri automatically merges `src-tauri/tauri.macos.conf.json`. It builds a native
`.app` with the Mac icon, minimum macOS 12, and ad-hoc signing for local use.
No Apple Developer membership, provisioning profile or notarization is configured.
Use the entire `.app` bundle, rather than its executable alone. Build locally for
this trial; distribution to other Macs needs a separate signing/notarization step.

## Intended Mac behavior

- Open Images and drag/drop open local supported files. The start screen also
  offers the embedded John Smith demo. Patient-number lookup is disabled.
- Command-click a pane, header or thumbnail to change the selection. Command-scroll
  changes processing level. Scroll zooms; Control-scroll/pinch follows the zoom
  path. Shift-drag or middle-button drag pans. Secondary click rotates; double
  secondary click pins. Use the on-screen buttons if your trackpad setup differs.
- Command-Z undoes; Command-Shift-Z redoes. Fullscreen and Escape work through the
  on-screen control even if macOS reserves F11 for another action.
- About & help reports macOS, the target architecture and WKWebView.
- Export Selected uses a native save dialog for full-resolution PNGs.
- Export for Letter saves combined JPEGs under `~/Pictures/RAD Viewer/Exports`.
  Demo letter exports use `~/Pictures/RAD Viewer/John Smith`.
- Direct printing is disabled with an explanation. Export files for printing from
  another app. LAN lookup, office export shares, DNP printing and the Open Dental
  bridge are deferred on Mac.
- Adjustments use the same XML sidecars and recipes as Windows. Files must be in
  a writable folder for autosave. Delete moves disposable images/sidecars into a
  sibling DELETED folder without replacing an existing destination. The existing
  non-Windows move uses hard links; a filesystem that disallows them fails visibly
  and keeps the source, rather than silently switching to unsafe overwrites.

## Mac acceptance checklist — pending

Use copies of images in a disposable local folder with spaces and non-ASCII
characters in its name. Do not test deletion on the only copy of a radiograph.

- [ ] Release .app opens from Finder with no dev server running; icon and About data are correct.
- [ ] Demo images visibly load (no blank panes); local RVG/PANO/SC/DICOM/PNG/JPEG samples load.
- [ ] Command selection works for panes, headers and thumbnails; group adjustments and undo/redo work.
- [ ] Trackpad scroll/pinch zooms, Shift-drag pans, secondary click rotates/pins; native page zoom stays fixed.
- [ ] Retina 100% view, Fit, fullscreen/Escape, pane order, A/B comparison and ellipses behave correctly.
- [ ] Save adjustments, quit, reopen: processing/rotation/annotations restore and source hashes stay unchanged.
- [ ] Cancel file/save dialogs: existing images and files remain unchanged.
- [ ] Read-only source folder: autosave reports an error and retains edits; export to a writable folder succeeds.
- [ ] PNG export and combined JPEG have correct pixels, orientation, annotations and destination.
- [ ] Repeat deletion with colliding filenames: both old and new DELETED files survive; sidecars follow images.
- [ ] Rust/frontend suites, Clippy and Windows pixel-reference comparison pass on Mac.

Record results and the exact Mac model/macOS version in verification/RELEASE_0.9.3.md.
The Windows executable deployment rule in AGENTS.md applies when working on the
Windows machine; do not attempt a Windows deployment from the Mac session.

## Prompt for the Mac coding session

> This is the RAD Viewer source prepared on Windows for an Apple Silicon local
> viewer trial. Read AGENTS.md, MAC_HANDOFF.md and verification/RELEASE_0.9.3.md.
> Verify SOURCE-MANIFEST.json before editing, inspect this Mac's architecture and
> macOS version, install missing prerequisites, run the documented tests and pixel
> comparison, then build and launch the native release .app. Fix Mac-specific
> failures while preserving Windows behavior and shared image algorithms/formats.
> Keep patient-number lookup and direct printing disabled on Mac. Complete the
> acceptance checks that this environment permits and record exact results and
> anything requiring my physical trackpad/display review. Do not claim unperformed
> checks or deploy the Windows executable from this Mac.

References: https://v2.tauri.app/start/prerequisites/,
https://v2.tauri.app/distribute/macos-application-bundle/,
https://v2.tauri.app/distribute/sign/macos/.
