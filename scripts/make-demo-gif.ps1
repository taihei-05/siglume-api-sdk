param(
    [Parameter(Mandatory = $true)]
    [string]$InputFile,
    [string]$OutputFile = "docs/assets/demo/siglume-owner-publish-demo.gif",
    [string]$PaletteFile = "docs/assets/demo/palette.png",
    [string]$Start = "00:00:08",
    [int]$DurationSeconds = 9,
    [int]$Width = 1200,
    [int]$Fps = 12
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
if (-not $ffmpeg) {
    throw "ffmpeg is not installed. Install ffmpeg and run this script again."
}

$sdkRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$resolvedInput = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $InputFile).Path)
$resolvedOutput = if ([System.IO.Path]::IsPathRooted($OutputFile)) {
    $OutputFile
} else {
    Join-Path $sdkRoot $OutputFile
}
$resolvedPalette = if ([System.IO.Path]::IsPathRooted($PaletteFile)) {
    $PaletteFile
} else {
    Join-Path $sdkRoot $PaletteFile
}

$outputDir = Split-Path -Parent $resolvedOutput
$paletteDir = Split-Path -Parent $resolvedPalette
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
New-Item -ItemType Directory -Force -Path $paletteDir | Out-Null

$paletteFilter = "fps=${Fps},scale=${Width}:-1:flags=lanczos,palettegen"
$gifFilter = "fps=${Fps},scale=${Width}:-1:flags=lanczos[x];[x][1:v]paletteuse"

& $ffmpeg.Source -y `
    -ss $Start `
    -t $DurationSeconds `
    -i $resolvedInput `
    -frames:v 1 `
    -vf $paletteFilter `
    -update 1 `
    $resolvedPalette

& $ffmpeg.Source -y `
    -ss $Start `
    -t $DurationSeconds `
    -i $resolvedInput `
    -i $resolvedPalette `
    -lavfi $gifFilter `
    -loop 0 `
    $resolvedOutput

Write-Host "Wrote GIF to $resolvedOutput"
