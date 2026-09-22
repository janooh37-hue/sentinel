# scripts/install-fonts.ps1
# Install the General Book paper's fonts system-wide: the committed OFL
# barcode font plus a caller-supplied folder of commercial fonts (Cronos Pro,
# Univers Next Arabic) that stay untracked (tmp-fonts/, gitignored).
#
# Run as Administrator. Idempotent: skips a font already registered under its
# exact file name, and verifies every expected family name is installed
# afterward via GDI+'s InstalledFontCollection (catches silent copy-without-
# register mistakes).
#
# Usage: powershell -ExecutionPolicy Bypass -File .\scripts\install-fonts.ps1
#        powershell -ExecutionPolicy Bypass -File .\scripts\install-fonts.ps1 -CommercialFontsDir 'C:\path\to\fonts'

[CmdletBinding()]
param(
    [string] $CommercialFontsDir = $(Join-Path (Split-Path -Parent $PSScriptRoot) 'tmp-fonts')
)

$ErrorActionPreference = 'Stop'

function Assert-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $pr = New-Object Security.Principal.WindowsPrincipal($id)
    if (-not $pr.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
        throw 'Run this script from an elevated (Administrator) PowerShell.'
    }
}

Assert-Admin

Add-Type -AssemblyName System.Drawing

$root        = Split-Path -Parent $PSScriptRoot
$ownedFonts  = Join-Path $root 'backend\templates\fonts'
$fontsDir    = Join-Path $env:WINDIR 'Fonts'
$regKey      = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts'

function Get-FontFamilyName([string] $path) {
    $collection = New-Object System.Drawing.Text.PrivateFontCollection
    $collection.AddFontFile($path)
    return $collection.Families[0].Name
}

function Install-Font([System.IO.FileInfo] $file) {
    $familyName = Get-FontFamilyName $file.FullName
    $dest       = Join-Path $fontsDir $file.Name
    $kind       = if ($file.Extension -ieq '.otf') { '(OpenType)' } else { '(TrueType)' }
    $valueName  = "$familyName $kind"

    if ((Test-Path $dest) -and (Get-ItemProperty -Path $regKey -Name $valueName -ErrorAction SilentlyContinue)) {
        Write-Host "  already installed: $familyName ($($file.Name))" -ForegroundColor DarkGray
        return $familyName
    }

    Copy-Item -Path $file.FullName -Destination $dest -Force
    New-ItemProperty -Path $regKey -Name $valueName -Value $file.Name -PropertyType String -Force | Out-Null
    Write-Host "  installed: $familyName ($($file.Name))" -ForegroundColor Green
    return $familyName
}

$expectedFamilies = [System.Collections.Generic.HashSet[string]]::new()

Write-Host 'Installing committed (OFL) fonts...' -ForegroundColor Cyan
foreach ($f in Get-ChildItem -Path $ownedFonts -Include *.ttf, *.otf -File) {
    $expectedFamilies.Add((Install-Font $f)) | Out-Null
}

if (Test-Path $CommercialFontsDir) {
    Write-Host "Installing commercial fonts from $CommercialFontsDir..." -ForegroundColor Cyan
    foreach ($f in Get-ChildItem -Path $CommercialFontsDir -Include *.ttf, *.otf -File) {
        $expectedFamilies.Add((Install-Font $f)) | Out-Null
    }
} else {
    Write-Warning "Commercial fonts dir not found: $CommercialFontsDir -- Word will substitute those families in PDFs until this is run with the real folder."
}

# Broadcast WM_FONTCHANGE so running apps (incl. Word) notice without reboot.
Add-Type -Namespace Native -Name FontChange -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true, CharSet = System.Runtime.InteropServices.CharSet.Auto)]
public static extern int SendMessageTimeout(System.IntPtr hWnd, int msg, System.IntPtr wParam, System.IntPtr lParam, int flags, int timeout, out System.IntPtr result);
'@
$HWND_BROADCAST = [System.IntPtr]0xffff
$WM_FONTCHANGE   = 0x001D
[System.IntPtr]$result = 0
[Native.FontChange]::SendMessageTimeout($HWND_BROADCAST, $WM_FONTCHANGE, [System.IntPtr]::Zero, [System.IntPtr]::Zero, 0, 1000, [ref]$result) | Out-Null

Write-Host ''
Write-Host 'Verifying installed families...' -ForegroundColor Cyan
$installed = New-Object System.Drawing.Text.InstalledFontCollection
$installedNames = $installed.Families | ForEach-Object { $_.Name }
$missing = $expectedFamilies | Where-Object { $installedNames -notcontains $_ }

if ($missing) {
    throw "Font families not visible to GDI+ after install: $($missing -join ', ')"
}

Write-Host "All expected families installed: $($expectedFamilies -join ', ')" -ForegroundColor Green
