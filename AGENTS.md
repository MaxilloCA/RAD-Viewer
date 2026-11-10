# Release deployment

The Windows release deployment below applies on the Windows development machine.
For a macOS-only session, follow `MAC_HANDOFF.md`, build and verify the native Mac
release, and report Windows deployment as requiring the Windows machine. Do not
attempt to deploy a Windows executable from macOS or claim it was updated there.

After every app update, build and verify the Windows release, then update
`D:\APPS\RAD-Viewer\rad-viewer.exe` to that latest version. This is the user's
canonical executable path, including for their shared LAN folder.

Keep only the latest verified app version, as requested on 2026-10-18. Stage the
new executable, verify its SHA-256 against `target\release\rad-viewer.exe`, then
replace the canonical path and verify its version and hash. A temporary rollback
copy may be kept during deployment; remove it after successful verification.
Remove superseded installers and release packages from the project and shared
deployment folders. Preserve running viewer sessions; do not force-close them to
deploy or clean up. Report any deployment or cleanup failure explicitly.

# Retained macOS port

The user requested on 2026-10-18 that the macOS port remain at 0.9.3 while
Windows advances. Preserve `output/RAD-Viewer-0.9.3-Mac-source.zip`, its checksum,
`MAC_HANDOFF.md`, `verification/RELEASE_0.9.3.md` and the Mac pixel-reference
fixture. Do not regenerate, upgrade or remove that frozen Mac archive during
Windows release cleanup unless the user requests a Mac update. Retain only the
latest Windows release notes/packages alongside this Mac port; keep
`verification/STATUS.md` focused on the two retained releases.
