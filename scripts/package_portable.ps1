$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$release = Join-Path $projectRoot 'target\release\rad-viewer.exe'
if ((Get-Item -LiteralPath $release).VersionInfo.FileVersion -ne $version) { throw 'Build the matching Windows release before packaging.' }
$destination = Join-Path $projectRoot "output\RAD-Viewer-Portable-$version"
New-Item -ItemType Directory -Path $destination -Force | Out-Null
$executable = Join-Path $destination 'rad-viewer.exe'
Copy-Item -LiteralPath $release -Destination $executable
if ((Get-FileHash -LiteralPath $release).Hash -ne (Get-FileHash -LiteralPath $executable).Hash) { throw 'Portable executable verification failed' }
$instructions = @"
RAD Viewer $version - Portable trial (Windows 10/11 x64)

1. Extract this entire ZIP to a folder on your PC.
2. Double-click rad-viewer.exe. No RAD Viewer installation is required.
3. Choose Open John Smith demo to try the five built-in sample radiographs.
   If images are already open, choose Open Patient to find the demo button.
4. Choose About & help in the bottom bar for credits, build information and
   the offline quick guide. Use Open Images to try your own supported files.

Microsoft Edge WebView2 Runtime must already be installed on the PC. It is
present on most current Windows PCs. If the app reports that it is missing,
install the Evergreen Runtime from Microsoft's official page:
https://developer.microsoft.com/microsoft-edge/webview2/
The installer edition can also set up this prerequisite automatically.

The demo works without office drives or network shares. Demo letter exports
save in Pictures\RAD Viewer\John Smith. For other images, Export for Letter
requires the office share; Export to JPEG lets you choose a local folder.

This edition runs without installing RAD Viewer, but is not a fully isolated
USB workspace: preferences, saved adjustments, demo samples and WebView2 data
use the current Windows user profile. Original image files are preserved when
adjusting them. Close the app before moving or removing its portable folder.

Created by: Michal Goralski, DDS, MSc FRCD(C) - pediatric dentist
goralsi@kidsdentistry.ca
Barrie, ON - Canada
"@
[IO.File]::WriteAllText((Join-Path $destination 'START HERE.txt'), $instructions)
$checksums = Get-ChildItem -LiteralPath $destination -File | Where-Object Name -ne 'SHA256SUMS.txt' | Sort-Object Name | ForEach-Object {
    '{0}  {1}' -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash, $_.Name
}
$checksums | Set-Content -LiteralPath (Join-Path $destination 'SHA256SUMS.txt')
$archive = Join-Path $projectRoot "output\RAD-Viewer-$version-Portable.zip"
Compress-Archive -LiteralPath $destination -DestinationPath $archive -Force
[ordered]@{ version=$version; executable=$executable; archive=$archive; executableSha256=(Get-FileHash -LiteralPath $executable).Hash; archiveSha256=(Get-FileHash -LiteralPath $archive).Hash } | ConvertTo-Json
