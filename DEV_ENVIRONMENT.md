# RAD Viewer — Development Environment

Verified on 2026-10-13 (America/Toronto). The Windows development prerequisites are installed and the checks below passed.

## Installed and existing tools

| Component | Verified version / configuration | Status |
|---|---|---|
| Visual Studio Build Tools 2022 | Installation version 17.14.37710.0; winget package 17.14.41 | Installed in this setup |
| MSVC C++ toolset | 14.44.35207, x64 tools | Installed in this setup |
| Windows SDK | 10.0.26100.0 | Installed in this setup |
| rustup | 1.29.1 | Installed in this setup |
| Rust compiler | 1.99.0 | Installed in this setup |
| Cargo | 1.99.0 | Installed in this setup |
| Default Rust host/toolchain | stable-x86_64-pc-windows-msvc | Installed and active |
| Clippy | 0.1.99 | Installed in this setup |
| rustfmt | 1.10.0-stable | Installed in this setup |
| Node.js | 24.15.0 | Already installed |
| npm | 11.14.1 | Already installed |
| WebView2 Runtime | 155.0.4283.45 | Already installed |
| Git | Available at C:\Program Files\Git\cmd\git.exe | Already installed |

Visual Studio location: `C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools`.

Rust command location: `C:\Users\administrator.KidsDent\.cargo\bin`.

## Verification performed

1. Microsoft Build Tools and rustup installers both completed successfully with exit code 0.
2. Compiled and ran a C program using `windows.h` and `GetCurrentProcessId`, with MSVC warnings treated as errors. This exercised Windows SDK headers, native compilation, linking, and execution.
3. Used Cargo to compile and run a release-mode Rust program that links to `kernel32` and calls `GetCurrentProcessId`. The Rust/Cargo/MSVC/Windows API check passed.
4. Confirmed the default MSVC Rust toolchain, compiler, Cargo, Clippy, and rustfmt versions.
5. Ran `npm.cmd exec --yes --package=@tauri-apps/cli@2 -- tauri info` from a temporary directory. Tauri reported its Environment section as passing and detected WebView2, MSVC, rustc, Cargo, rustup, and the active toolchain.
6. Confirmed that the Rust installer persisted `.cargo\bin` in the user's PATH.

The verification programs are temporary setup checks, not the viewer implementation. They are retained at:

`C:\Users\ADMINI~1.KID\AppData\Local\Temp\rad-viewer-dependency-check-b66bc4db5dac45f4b6f557c464f5ad32`

No complete Tauri viewer has been built or launched. There is no application scaffold or application dependency manifest yet, so Tauri's Packages, Plugins, and App sections were empty as expected. The implementing agent should install and lock project-specific Cargo and npm dependencies when it creates the application. The CLI environment check used npm's cache, not a global CLI installation.

The sample radiographs have not been decoded as part of dependency setup. Physical photo-printer validation remains part of the implementation plan.

## PATH in an already-running Codex session

Rust was added to the persistent user PATH. An already-running Codex process or terminal can still inherit the old PATH. If `cargo` or `rustc` is not found, prepend the installed directory in that shell:

```powershell
$env:Path = (Join-Path $env:USERPROFILE '.cargo\bin') + ';' + $env:Path
rustc --version
cargo --version
```

Restarting Codex after installation also lets it inherit the updated environment. Do not reinstall Rust solely because an existing process has an old PATH.

## Disk usage

Approximately **8.7 GiB** less free space was available after setup than at its start. Approximately **192.8 GiB** remained free on C:. This before/after measurement includes installation caches and temporary/system changes, and may include unrelated background activity.

Measured logical folder sizes:

| Folder group | Size |
|---|---:|
| Visual Studio Build Tools | 3.34 GiB |
| Windows SDK | 1.67 GiB |
| Visual Studio package cache | 1.26 GiB |
| Rust toolchains, components, and documentation | 1.30 GiB |
| Cargo directory before project dependencies | 0.01 GiB |

Folder sizes are not a complete accounting of physical disk allocation and do not sum to the disk-space change. Future Cargo/npm caches and application build outputs will consume additional space.

## Handoff

Read `IMPLEMENTATION.md` for the product requirements, multi-agent expectations, reasoning-level recommendation, performance requirements, and mandatory user image-quality review before expanding the application.
