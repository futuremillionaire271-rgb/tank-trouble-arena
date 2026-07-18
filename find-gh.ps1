$paths = @('C:\Program Files', 'C:\Program Files (x86)', $env:LOCALAPPDATA)
foreach ($p in $paths) {
  Get-ChildItem -Path $p -Recurse -Filter gh.exe -ErrorAction SilentlyContinue -Depth 5 | Select-Object -First 2 -ExpandProperty FullName
}
