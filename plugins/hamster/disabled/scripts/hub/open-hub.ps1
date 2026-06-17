# open-hub.ps1 — PowerShell handler for the `/hub` UserPromptExpansion hook (Windows).
#
# Paired with open-hub.sh. Self-guards to Windows; no-ops elsewhere. Reads the
# token from ~/.hamster/config and passes it in the URL fragment (#t=...) so
# it stays client-side. Start-Process opens the default browser.
$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') { exit 0 }   # not Windows — bash handler opens it

$config = if ($env:HAMSTER_CONFIG) { $env:HAMSTER_CONFIG } `
          else { Join-Path $env:USERPROFILE '.hamster\config' }

$base  = 'http://localhost:8787'
$token = ''
if (Test-Path $config) {
  foreach ($line in Get-Content $config) {
    if ($line -match '^\s*HAMSTER_API_URL\s*=\s*(.+?)\s*$') { $base  = $Matches[1] }
    elseif ($line -match '^\s*HAMSTER_TOKEN\s*=\s*(.+?)\s*$') { $token = $Matches[1] }
  }
}
$base = $base.TrimEnd('/')
$url  = "$base/app#t=$token"

Start-Process $url | Out-Null

# Show only the base URL to the user — never echo the token.
@{
  decision = 'block'
  reason   = "Opening your hub at $base/app in your browser."
} | ConvertTo-Json -Compress
