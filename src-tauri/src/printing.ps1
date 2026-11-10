$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
Add-Type -AssemblyName System.Drawing
if ($env:RAD_PRINT_MODE -eq 'list') {
    $names = @([System.Drawing.Printing.PrinterSettings]::InstalledPrinters | ForEach-Object { [string]$_ })
    ConvertTo-Json -InputObject $names -Compress
    exit 0
}
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Printing;
using System.Text.RegularExpressions;
public static class RadPhotoPrint {
    public static void PrintChecked(PrintDocument document) {
        bool pageRendered = false, ended = false, cancelled = false;
        PrintPageEventHandler page = (sender, e) => { pageRendered = !e.Cancel; };
        PrintEventHandler end = (sender, e) => { ended = true; cancelled = e.Cancel; };
        document.PrintPage += page;
        document.EndPrint += end;
        try {
            document.Print();
            if (!pageRendered || !ended || cancelled)
                throw new Exception("Windows or the printer driver cancelled the print job. No completed page was submitted. Check the printer's paper/media settings and Windows printer status, then retry.");
        } finally {
            document.PrintPage -= page;
            document.EndPrint -= end;
        }
    }
    public static bool IsFourBySix(PaperSize paper) {
        string name = paper.PaperName ?? "";
        // Never choose the driver's two-up/cut-strip modes for a single photo.
        if (Regex.IsMatch(name, @"[x\u00d7].*[x\u00d7]\s*[234]\s*$", RegexOptions.IgnoreCase)) return false;
        int shortEdge = Math.Min(paper.Width, paper.Height), longEdge = Math.Max(paper.Width, paper.Height);
        if (Math.Abs(shortEdge - 400) <= 5 && Math.Abs(longEdge - 600) <= 5) return true;
        // DNP's (6x4) / PR (4x6) modes include bleed: 105.0 x 156.1 mm,
        // approximately 413 x 615 hundredths of an inch. Keep the driver form
        // (and its RawKind) rather than inventing an unsupported custom size.
        bool namedPhoto = Regex.IsMatch(name, @"^\s*(?:PR\s*)?\(?\s*(?:4\s*[x\u00d7]\s*6|6\s*[x\u00d7]\s*4)\s*\)?\s*$", RegexOptions.IgnoreCase);
        return namedPhoto && Math.Abs(shortEdge - 400) <= 20 && Math.Abs(longEdge - 600) <= 20;
    }
    public static void Print(string path, string printer) {
        using (var bitmap = Image.FromFile(path))
        using (var document = new PrintDocument()) {
            document.PrinterSettings.PrinterName = printer;
            if (!document.PrinterSettings.IsValid) throw new Exception("The selected printer is unavailable.");
            PaperSize photo = null;
            foreach (PaperSize paper in document.PrinterSettings.PaperSizes) {
                if (IsFourBySix(paper)) { photo = paper; break; }
            }
            if (photo == null) throw new Exception("This printer driver does not offer 4 x 6 inch paper. Install/configure the DNP RX1HS driver and 4 x 6 media, then retry.");
            document.DefaultPageSettings.PaperSize = photo;
            document.DefaultPageSettings.Landscape = photo.Width < photo.Height;
            document.DefaultPageSettings.Margins = new Margins(0, 0, 0, 0);
            document.PrinterSettings.Copies = 1;
            document.DocumentName = "RAD Viewer - 4x6 radiographs";
            document.PrintController = new StandardPrintController();
            document.PrintPage += (sender, e) => {
                // The device origin is its printable area's corner. Respect hard
                // margins and fit the complete composition without edge cropping.
                var area = e.PageSettings.PrintableArea;
                float w = area.Width, h = area.Height;
                if (w < h) { float swap = w; w = h; h = swap; }
                float factor = Math.Min(w / bitmap.Width, h / bitmap.Height);
                e.Graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                e.Graphics.DrawImage(bitmap, new RectangleF((w - bitmap.Width * factor) / 2, (h - bitmap.Height * factor) / 2, bitmap.Width * factor, bitmap.Height * factor));
                e.HasMorePages = false;
            };
            PrintChecked(document);
        }
    }
}
'@
[RadPhotoPrint]::Print($env:RAD_PRINT_FILE, $env:RAD_PRINT_PRINTER)
[Console]::Out.WriteLine('RAD_PRINT_SUBMITTED')
} catch {
    $failure = $_.Exception
    while ($null -ne $failure.InnerException) { $failure = $failure.InnerException }
    [Console]::Error.WriteLine($failure.Message)
    exit 1
}
