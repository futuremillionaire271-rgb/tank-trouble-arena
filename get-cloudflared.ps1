$ProgressPreference = 'SilentlyContinue'
$dest = Join-Path $env:USERPROFILE 'tank-trouble\cloudflared.exe'
Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile $dest
Write-Host "Downloaded: $((Get-Item $dest).Length) bytes"
