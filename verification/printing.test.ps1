$ErrorActionPreference = 'Stop'
$source = Get-Content (Join-Path $PSScriptRoot '../src-tauri/src/printing.ps1') -Raw
$csharp = [regex]::Match($source, "(?s)-TypeDefinition @'\r?\n(.*?)\r?\n'@").Groups[1].Value
if (!$csharp) { throw 'Print adapter C# source was not found' }
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition $csharp
$cases = @(
    @('(6x4)', 615, 413, $true),
    @('PR (4x6)', 413, 615, $true),
    @('(6x4)', 614, 413, $true),
    @('4 x 6', 400, 600, $true),
    @('6x4', 600, 400, $true),
    @('6x4', 615, 413, $true),
    @('Photo', 600, 400, $true),
    @('(6x4) x 2', 615, 413, $false),
    @('PR (4x6) x 2', 413, 615, $false),
    @('(6x4)', 600, 800, $false),
    @('(6x8)', 615, 812, $false),
    @('(5x3.5)', 516, 363, $false),
    @('A4', 827, 1169, $false)
)
foreach ($case in $cases) {
    $paper = New-Object System.Drawing.Printing.PaperSize($case[0], $case[1], $case[2])
    $actual = [RadPhotoPrint]::IsFourBySix($paper)
    if ($actual -ne $case[3]) { throw "Unexpected selection for $($case[0]) $($case[1])x$($case[2])" }
}
$script = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($source))
$start = New-Object System.Diagnostics.ProcessStartInfo
$start.FileName = "$env:SystemRoot/System32/WindowsPowerShell/v1.0/powershell.exe"
$start.Arguments = "-NoProfile -NonInteractive -EncodedCommand $script"
$start.UseShellExecute = $false
$start.CreateNoWindow = $true
$start.RedirectStandardOutput = $true
$start.RedirectStandardError = $true
$start.EnvironmentVariables['RAD_PRINT_MODE'] = 'print'
$start.EnvironmentVariables['RAD_PRINT_FILE'] = 'Z:\nonexistent-rad-print-test.png'
$process = [Diagnostics.Process]::Start($start)
$stdout = $process.StandardOutput.ReadToEnd()
$stderr = $process.StandardError.ReadToEnd()
$process.WaitForExit()
if ($process.ExitCode -ne 1 -or !$stderr.Trim() -or $stderr -match 'CLIXML|<Objs|_x000D_|At line:') { throw "Error formatting regression: $stderr" }
$start.EnvironmentVariables['RAD_PRINT_MODE'] = 'list'
$process = [Diagnostics.Process]::Start($start)
$stdout = $process.StandardOutput.ReadToEnd()
$stderr = $process.StandardError.ReadToEnd()
$process.WaitForExit()
if ($process.ExitCode -ne 0 -or $stderr.Trim()) { throw "Printer enumeration failed: $stderr" }
$null = ConvertFrom-Json $stdout
Write-Output "PASS: 13 paper selection cases, plain-text encoded-command failure, and installed printer enumeration. No print jobs submitted."

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System.Drawing.Printing;
public class CancelledPrintController : PrintController {
    public override void OnStartPrint(PrintDocument document, PrintEventArgs e) { e.Cancel = true; }
}
"@
$document = New-Object System.Drawing.Printing.PrintDocument
$document.PrintController = New-Object CancelledPrintController
$rejected = $false
try { [RadPhotoPrint]::PrintChecked($document) }
catch { $rejected = $_.Exception.ToString().Contains('cancelled the print job') }
finally { $document.Dispose() }
if (!$rejected) { throw 'Silent driver cancellation was incorrectly reported as success' }
Write-Output 'PASS: cancelled PrintDocument rejected without submitting a physical job.'
