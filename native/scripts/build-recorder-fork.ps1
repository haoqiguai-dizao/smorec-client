param([switch]$ReuseNativeObjects)
$ErrorActionPreference = 'Stop'
if ($ReuseNativeObjects) {
    throw '-ReuseNativeObjects is disabled: shared headers can change class layouts. Run the full build without this switch.'
}
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$toolEnvironment = Join-Path $workspace 'native/tools/enter-toolchain.ps1'
if (!(Test-Path -LiteralPath $toolEnvironment)) { throw 'Run native/tools/bootstrap_toolchain.py first.' }
. $toolEnvironment
$vendor = Join-Path $workspace 'native/vendor/ScreenRecorderLib'
$source = Join-Path $vendor 'ScreenRecorderLibNative'
$managed = Join-Path $vendor 'ScreenRecorderLib'
$out = Join-Path $workspace 'native/vendor/artifacts'
$objects = Join-Path $out 'obj'
New-Item -ItemType Directory -Force -Path $out,$objects | Out-Null
$log = Join-Path $out 'build.log'
[IO.File]::WriteAllText($log, "ScreenRecorderLib 7.0.1 FrameFlow exclusion, software encoder tuning, optional sample diagnostics and exact encoded durations fork`r`n")

function Invoke-Compiler([string]$Tool, [string[]]$Arguments) {
    $stage = Join-Path $out 'stage.log'
    & $Tool @Arguments *> $stage
    $code = $LASTEXITCODE
    Get-Content -LiteralPath $stage | Add-Content -LiteralPath $log
    if ($code -ne 0) {
        Get-Content -LiteralPath $stage -Tail 65 | Write-Output
        throw "$Tool exited $code; full log: $log"
    }
}

Push-Location $source
try {
    Invoke-Compiler 'fxc.exe' @('/nologo','/T','ps_4_0_level_9_1','/E','PS','/Fh',"$out/PixelShader.h",'PixelShader.hlsl')
    Invoke-Compiler 'fxc.exe' @('/nologo','/T','vs_4_0_level_9_1','/E','VS','/Fh',"$out/VertexShader.h",'VertexShader.hlsl')
    [xml]$project = Get-Content -LiteralPath (Join-Path $source 'ScreenRecorderLibNative.vcxproj') -Raw
    $sources = @($project.Project.ItemGroup.ClCompile | Where-Object { $_.Include } | ForEach-Object { $_.Include })
    # Compile every translation unit: the custom build has no header dependency graph.
    $pending = $sources
    $defines = @('/DNDEBUG','/D_WINDOWS','/D_USRDLL','/D_UNICODE','/DUNICODE','/DNOMINMAX',
        '/D_HAS_STD_BYTE=0','/D_DISABLE_CONSTEXPR_MUTEX_CONSTRUCTOR','/DSCREENRECORDERLIBNATIVE_EXPORTS')
    if ($pending.Count) {
        Write-Output "Compiling $($pending.Count) native source files..."
        Invoke-Compiler 'cl.exe' (@('/nologo','/c','/std:c++17','/EHa','/MD','/O2','/MP4','/utf-8',"/I$out", "/Fo$objects/") + $defines + $pending)
    }
    $objectFiles = @($sources | ForEach-Object { Join-Path $objects ([IO.Path]::GetFileNameWithoutExtension($_) + '.obj') })
    Invoke-Compiler 'lib.exe' (@('/nologo',"/OUT:$out/ScreenRecorderLibNative.lib") + $objectFiles)
}
finally { Pop-Location }

Push-Location $managed
try {
    Write-Output 'Compiling managed C++/CLI bridge...'
    Invoke-Compiler 'cl.exe' @('/nologo','/c','/clr','/std:c++17','/EHa','/MD','/O2','/utf-8',
        '/DNDEBUG','/D_WINDOWS','/D_USRDLL','/D_UNICODE','/DUNICODE','/D_HAS_STD_BYTE=0',
        '/D_DISABLE_CONSTEXPR_MUTEX_CONSTRUCTOR',"/I$out", "/Fo$objects/",
        "/FU$($FrameFlowToolchain.Net48References)/System.dll",
        "/FU$($FrameFlowToolchain.Net48References)/System.Data.dll",
        "/FU$($FrameFlowToolchain.Net48References)/System.Xml.dll",'AssemblyInfo.cpp','Recorder.cpp','Recorder.Sources.cpp')
    Invoke-Compiler 'link.exe' @('/NOLOGO','/DLL','/MACHINE:X64',"/OUT:$out/ScreenRecorderLib.dll",
        "$objects/AssemblyInfo.obj","$objects/Recorder.obj","$objects/Recorder.Sources.obj","$out/ScreenRecorderLibNative.lib",
        'D3D11.lib','dxgi.lib','Mfuuid.lib','Mfplat.lib','evr.lib','mfreadwrite.lib',
        'kernel32.lib','user32.lib','gdi32.lib','ole32.lib','oleaut32.lib','uuid.lib','advapi32.lib','shell32.lib')
}
finally { Pop-Location }
Get-FileHash -LiteralPath (Join-Path $out 'ScreenRecorderLib.dll') -Algorithm SHA256
