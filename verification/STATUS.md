# Current releases

## Windows 0.9.11

- Canonical executable: `D:\APPS\RAD-Viewer\rad-viewer.exe`.
- SHA-256: `EDD91D02534803A486EF7EE1498440391BB90ECFA072D8CC1379A4FA8B95501B`.
- Installer: `target/release/bundle/nsis/RAD Viewer_0.9.11_x64-setup.exe`.
- Portable and demo ZIPs were verified in `output/` and the deployment Share folder.
- [Release details and verification](RELEASE_0.9.11.md).

## macOS source port 0.9.3

The frozen archive, checksum, handoff, release notes and Mac pixel fixture remain
unchanged. Native Mac compilation and device acceptance remain pending.
Archive SHA-256: `4cafd75f7088842848d0eeba6b3eddbcd77d5dfce2407330abeb29ffd9bfc61d`.
See [Mac verification](RELEASE_0.9.3.md) and [handoff](../MAC_HANDOFF.md).

## Deployment and cleanup (2026-11-08)

Windows deployment succeeded and all four running viewer sessions were preserved.
Automatic approval review rejected removal of superseded Windows installers,
packages, release notes and rollback executables as blocked by policy. Those
files remain on disk.
