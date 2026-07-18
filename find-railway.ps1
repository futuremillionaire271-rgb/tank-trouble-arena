Get-ChildItem -Path $env:USERPROFILE -Filter '*.json' -Recurse -Depth 4 -Force -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match 'railway' } |
  Select-Object -First 5 -ExpandProperty FullName
