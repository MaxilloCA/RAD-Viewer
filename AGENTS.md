# Release deployment

After every app update, build and verify the Windows release, then update
`D:\APPS\RAD-Viewer\rad-viewer.exe` to that latest version. This is the user's
canonical executable path, including for their shared LAN folder.

Keep the previous executable beside it as `rad-viewer-<version>.exe`. Stage the
new executable, verify its SHA-256 against `target\release\rad-viewer.exe`, then
replace the canonical path and verify its version and hash. Preserve running
viewer sessions; do not force-close them to deploy. Report any deployment failure
explicitly rather than leaving the user to assume the shared copy was updated.
