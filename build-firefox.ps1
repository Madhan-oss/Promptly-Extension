# Promptly - Build Script for Firefox (Manifest V2)
# Creates: dist\promptly-firefox-v1.2.0.zip
# Usage:   .\build-firefox.ps1

$ErrorActionPreference = "Stop"

$VERSION    = "1.2.0"
$BUILD_DIR  = "dist\firefox"
$ZIP_NAME   = "promptly-firefox-v${VERSION}.zip"
$SOURCE_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path

$INCLUDE = @(
  "background.js",
  "browser-polyfill.js",
  "chat-exporter.js",
  "content-script.js",
  "icons\icon16.png",
  "icons\icon48.png",
  "icons\icon128.png",
  "popup\popup.html",
  "popup\popup.js",
  "popup\popup.css"
)

Write-Host "Building Promptly for Firefox v${VERSION} ..." -ForegroundColor Magenta

if (Test-Path $BUILD_DIR) { Remove-Item -Recurse -Force $BUILD_DIR }
New-Item -ItemType Directory -Force -Path "$BUILD_DIR\icons" | Out-Null
New-Item -ItemType Directory -Force -Path "$BUILD_DIR\popup"  | Out-Null

foreach ($file in $INCLUDE) {
  $src = Join-Path $SOURCE_DIR $file
  $dst = Join-Path $BUILD_DIR  $file
  if (Test-Path $src) {
    Copy-Item $src $dst -Force
    Write-Host "  OK  $file" -ForegroundColor Green
  } else {
    Write-Warning "  MISSING: $file"
  }
}

# Swap to Firefox manifest
$ffManifest = Join-Path $SOURCE_DIR "manifest_firefox.json"
if (Test-Path $ffManifest) {
  Copy-Item $ffManifest (Join-Path $BUILD_DIR "manifest.json") -Force
  Write-Host "  OK  manifest.json  (Firefox MV2 variant)" -ForegroundColor Green
} else {
  Write-Error "manifest_firefox.json not found!"
}

$distDir = Join-Path $SOURCE_DIR "dist"
if (-not (Test-Path $distDir)) { New-Item -ItemType Directory -Force -Path $distDir | Out-Null }

$zipPath = Join-Path $distDir $ZIP_NAME
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path "$BUILD_DIR\*" -DestinationPath $zipPath -CompressionLevel Optimal

$sizeKB = [math]::Round((Get-Item $zipPath).Length / 1KB, 1)
Write-Host ""
Write-Host "Firefox build complete! -> dist\$ZIP_NAME  ($sizeKB KB)" -ForegroundColor Green
Write-Host ""
Write-Host "Upload at:" -ForegroundColor Yellow
Write-Host "  Firefox Add-ons (AMO) : https://addons.mozilla.org/developers/" -ForegroundColor Gray
Write-Host "  Local test            : about:debugging#/runtime/this-firefox" -ForegroundColor Gray
