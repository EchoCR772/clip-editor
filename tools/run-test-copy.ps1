# Runs the app from source with its own copy of your settings (names, trims, folders), so the
# installed app and its data stay as they are. Dev only; not part of the installed app.
$proj = Split-Path -Parent $PSScriptRoot
$profile = Join-Path $env:TEMP "clip-editor-test-profile"
$real = Join-Path $env:APPDATA "Clip Trimmer"
if (-not (Test-Path $profile) -and (Test-Path $real)) { Copy-Item $real $profile -Recurse }
Set-Location $proj
Start-Process (Join-Path $proj "node_modules\electron\dist\electron.exe") -ArgumentList ".", "--user-data-dir=`"$profile`""
