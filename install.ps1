# Installs (or updates) Basalt on Windows. In PowerShell:
#
#   irm https://raw.githubusercontent.com/Nabhyaraj-Sonagara/Basalt/main/install.ps1 | iex
#
# It reads the latest release's update manifest, downloads the installer, checks its SHA-512
# against the manifest, and runs it silently for the current user (no admin rights needed).
# Set BASALT_RELEASES to install from another releases URL (for testing).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'  # Invoke-WebRequest is far faster without the progress bar

$releases = if ($env:BASALT_RELEASES) { $env:BASALT_RELEASES } else { 'https://github.com/Nabhyaraj-Sonagara/Basalt/releases' }
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

function Fail($message) {
  Write-Host "Basalt install failed: $message" -ForegroundColor Red
  throw $message
}

$manifest = (Invoke-WebRequest "$releases/latest/download/latest.yml" -UseBasicParsing).Content
if ($manifest -is [byte[]]) { $manifest = [Text.Encoding]::UTF8.GetString($manifest) }
$version = if ($manifest -match '(?m)^version:\s*(\S+)') { $Matches[1] } else { Fail 'the release manifest has no version' }
$file = if ($manifest -match '(?m)^path:\s*(\S+)') { $Matches[1] } else { Fail 'the release manifest has no installer' }
$sha512 = if ($manifest -match '(?m)^sha512:\s*(\S+)') { $Matches[1] } else { Fail 'the release manifest has no checksum' }

$dir = Join-Path ([IO.Path]::GetTempPath()) ("basalt-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $dir | Out-Null
try {
  $exe = Join-Path $dir $file
  Write-Host "Downloading Basalt $version ($file)..."
  Invoke-WebRequest "$releases/download/v$version/$file" -OutFile $exe -UseBasicParsing

  $hex = (Get-FileHash $exe -Algorithm SHA512).Hash
  $bytes = [byte[]]::new($hex.Length / 2)
  for ($i = 0; $i -lt $bytes.Length; $i++) { $bytes[$i] = [Convert]::ToByte($hex.Substring($i * 2, 2), 16) }
  if ([Convert]::ToBase64String($bytes) -ne $sha512) { Fail "the download's checksum doesn't match the release. Nothing was installed; try again." }

  Write-Host 'Installing...'
  $p = Start-Process -FilePath $exe -ArgumentList '/S' -Wait -PassThru
  if ($p.ExitCode -ne 0) { Fail "the installer exited with code $($p.ExitCode)" }
  Write-Host ''
  Write-Host "Installed Basalt $version. Open it from the Start menu." -ForegroundColor Green
}
finally {
  Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue
}
