# show-qr.ps1 — PowerShell handler for the `/qr` UserPromptExpansion hook (Windows).
#
# Paired with show-qr.sh. Self-guards to Windows; no-ops elsewhere. Fetches the
# rotating featured game and renders a QR of its monitored go_url via Node
# (cross-platform), so Git Bash is NOT required on Windows — only Node.
$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') { exit 0 }   # not Windows — bash handler renders

$root = if ($env:CLAUDE_PLUGIN_ROOT) { $env:CLAUDE_PLUGIN_ROOT } `
        else { Split-Path -Parent (Split-Path -Parent $PSScriptRoot) }

# Load ~/.hamster/config so the renderer can call the authenticated API.
$config = if ($env:HAMSTER_CONFIG) { $env:HAMSTER_CONFIG } `
          else { Join-Path $env:USERPROFILE '.hamster\config' }
$base = 'http://localhost:8787'
$token = ''
if (Test-Path $config) {
  foreach ($line in Get-Content $config) {
    if ($line -match '^\s*HAMSTER_API_URL\s*=\s*(.+?)\s*$') { $base = $Matches[1] }
    elseif ($line -match '^\s*HAMSTER_TOKEN\s*=\s*(.+?)\s*$') { $token = $Matches[1] }
  }
}
$env:HAMSTER_API_URL = $base
$env:HAMSTER_TOKEN = $token

if (Get-Command node -ErrorAction SilentlyContinue) {
  & node (Join-Path $root 'scripts/qr/render-qr.js') --featured
} else {
  @{
    decision = 'block'
    reason   = 'Install Node.js to render the QR inline, then run /qr again.'
  } | ConvertTo-Json -Compress
}
