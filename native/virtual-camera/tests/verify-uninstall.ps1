$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
. (Join-Path $workspace 'native/tools/enter-toolchain.ps1')
$out = Join-Path $workspace 'native/virtual-camera/obj/x64'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$source = Join-Path $PSScriptRoot 'uninstall-fixture.cpp'
& cl.exe /nologo /std:c++17 /EHsc /MT /O2 /utf-8 /W4 "/Fe:$out/uninstall-fixture.exe" "/Fo:$out/uninstall-fixture.obj" $source
if ($LASTEXITCODE -ne 0) { throw 'Uninstall test fixture compilation failed' }
Push-Location $workspace
try {
    node native/virtual-camera/tests/verify-uninstall.mjs
    if ($LASTEXITCODE -ne 0) { throw 'NSIS camera uninstall lifecycle verification failed' }
}
finally { Pop-Location }
