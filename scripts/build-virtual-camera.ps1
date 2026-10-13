param([switch]$SkipSelfTest)
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
. (Join-Path $workspace 'native/tools/enter-toolchain.ps1')
$source = Join-Path $workspace 'native/virtual-camera'
$out = Join-Path $source 'bin/x64'
$objects = Join-Path $source 'obj/x64'
New-Item -ItemType Directory -Force -Path $out, $objects | Out-Null
$common = @('/nologo', '/std:c++17', '/EHsc', '/MT', '/O2', '/utf-8', '/W4', '/DUNICODE', '/D_UNICODE', '/DNOMINMAX', '/DWIN32_LEAN_AND_MEAN')
function Invoke-CameraBuild([string[]]$Arguments) {
    & cl.exe @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Virtual camera build failed with exit code $LASTEXITCODE" }
}
Push-Location $objects
try {
    $filterSources = @('dll.cpp', 'filter.cpp', 'pin.cpp', 'pin-config.cpp', 'enumerators.cpp', 'media.cpp') | ForEach-Object { Join-Path $source $_ }
    Invoke-CameraBuild ($common + @('/LD', "/Fe:$out/XiaoLu.VirtualCamera.dll") + $filterSources + @('/link', "/DEF:$source/camera.def", '/DYNAMICBASE', '/NXCOMPAT', 'ole32.lib', 'oleaut32.lib', 'strmiids.lib', 'advapi32.lib', 'uuid.lib'))
    $bridgeSources = @('bridge.cpp', 'bridge-setup.cpp', 'bridge-test.cpp', 'media.cpp') | ForEach-Object { Join-Path $source $_ }
    Invoke-CameraBuild ($common + @("/Fe:$out/XiaoLu.CameraBridge.exe") + $bridgeSources + @('/link', '/DYNAMICBASE', '/NXCOMPAT', 'ole32.lib', 'oleaut32.lib', 'strmiids.lib', 'advapi32.lib', 'shell32.lib', 'uuid.lib'))
}
finally { Pop-Location }
if (!$SkipSelfTest) {
    & (Join-Path $out 'XiaoLu.CameraBridge.exe') self-test
    if ($LASTEXITCODE -ne 0) { throw 'Virtual camera unregistered DirectShow self-test failed' }
}
foreach ($name in @('XiaoLu.VirtualCamera.dll', 'XiaoLu.CameraBridge.exe')) {
    $artifact = Join-Path $out $name
    $stream = [IO.File]::OpenRead($artifact)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try {
        $hash = [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()
        Write-Output ([pscustomobject]@{ Path = $artifact; SHA256 = $hash })
    }
    finally { $algorithm.Dispose(); $stream.Dispose() }
}
