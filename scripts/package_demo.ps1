$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$installer = Join-Path $projectRoot "target\release\bundle\nsis\RAD Viewer_${version}_x64-setup.exe"
$destination = Join-Path $projectRoot "output\RAD-Viewer-Demo-$version"
$samples = Join-Path $projectRoot 'demo\John Smith'
$demoDestination = Join-Path $destination 'John Smith'
New-Item -ItemType Directory -Path $demoDestination -Force | Out-Null
$setup = Join-Path $destination "RAD-Viewer-$version-Setup.exe"
Copy-Item -LiteralPath $installer -Destination $setup
if ((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash) { throw 'Installer copy verification failed' }
$guide = Join-Path $projectRoot 'output\pdf\RAD-Viewer-Quick-Guide.pdf'
if (-not (Test-Path -LiteralPath $guide)) { throw 'Generate the one-page guide with scripts/create_user_guide.py before packaging.' }
Copy-Item -LiteralPath $guide -Destination (Join-Path $destination 'RAD-Viewer-Quick-Guide.pdf')
$iconDestination = Join-Path $destination 'Icons'
New-Item -ItemType Directory -Path $iconDestination -Force | Out-Null
foreach ($name in @('rad-viewer-opendental-22.png', 'rad-viewer-icon-1024.png', 'rad-viewer.ico', 'rad-viewer-icon.svg')) {
    $source = Join-Path $projectRoot "output\icons\$name"
    $target = Join-Path $iconDestination $name
    Copy-Item -LiteralPath $source -Destination $target
    if ((Get-FileHash -LiteralPath $source).Hash -ne (Get-FileHash -LiteralPath $target).Hash) { throw "Icon copy verification failed: $name" }
}
$sampleNames = @('PatientInfo.xml') + (1..5 | ForEach-Object { 'Radiograph-{0:00}.dcm' -f $_ })
foreach ($name in $sampleNames) {
    $source = Join-Path $samples $name
    $target = Join-Path $demoDestination $name
    Copy-Item -LiteralPath $source -Destination $target
    if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash) { throw "Sample copy verification failed: $name" }
}
$readme = @"
RAD Viewer $version - John Smith demonstration

1. Run RAD-Viewer-$version-Setup.exe on a Windows 10/11 x64 PC.
2. Launch RAD Viewer and choose 'Open John Smith demo'.
3. Read RAD-Viewer-Quick-Guide.pdf for mouse shortcuts, printing and exports.
4. Demo letter exports save in Pictures\RAD Viewer\John Smith. For other images,
   Export for Letter needs the office server share; Export to JPEG lets you
   choose where to save individual PNGs on any PC.

The five John Smith images are built into the installer. No office drives,
patient numbers or network shares are needed for the demo. The adjacent John
Smith folder is an extra copy of the same demo images, with generic filenames
and John Smith metadata. You can open its DICOM files using 'Open radiographs'.

The app creates its writable sample folder at:
%LOCALAPPDATA%\com.local.radviewer\Samples\John Smith

Sample pixels and image dates are retained. Direct patient identifiers and
private DICOM metadata have been removed; the displayed name is John Smith.
The setup includes the WebView2 bootstrapper. Internet access is needed only
if the PC does not already have the Microsoft Edge WebView2 runtime installed.

Share the ZIP to include the installer, sample images and one-page PDF guide.
The Icons folder includes a 22 x 22 PNG for Open Dental, a 1024 x 1024 PNG,
a multi-size Windows ICO, and the matching vector artwork.
"@
[IO.File]::WriteAllText((Join-Path $destination 'READ ME.txt'), $readme)
$checksums = Get-ChildItem -LiteralPath $destination -Recurse -File | Where-Object { $_.Name -ne 'SHA256SUMS.txt' } | Sort-Object FullName | ForEach-Object {
    '{0}  {1}' -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash, [IO.Path]::GetRelativePath($destination, $_.FullName)
}
$checksums | Set-Content -LiteralPath (Join-Path $destination 'SHA256SUMS.txt')
$archive = Join-Path $projectRoot "output\RAD-Viewer-$version-Demo.zip"
Compress-Archive -LiteralPath $destination -DestinationPath $archive -Force
[ordered]@{installer=$setup; samples=$demoDestination; archive=$archive; installerSha256=(Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash} | ConvertTo-Json
