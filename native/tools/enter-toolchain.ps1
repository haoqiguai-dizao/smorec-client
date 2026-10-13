param(
    [string]$ToolchainRoot = (Join-Path $PSScriptRoot '../../.native-build-tools'),
    [switch]$PassThru,
    [switch]$AsJson
)

$ErrorActionPreference = 'Stop'
$toolRoot = [IO.Path]::GetFullPath($ToolchainRoot)
$vcRoot = Join-Path $toolRoot 'msvc/VC/Tools/MSVC/14.44.35207'
$vcBin = Join-Path $vcRoot 'bin/Hostx64/x64'
$sdkRoot = Join-Path $toolRoot 'sdk/c'
$sdkVersion = '10.0.26100.0'
$sdkInclude = Join-Path $sdkRoot "Include/$sdkVersion"
$sdkBin = Join-Path $sdkRoot "bin/$sdkVersion/x64"
$sdkLib = Join-Path $toolRoot 'sdk-x64/c'
$net48 = Join-Path $toolRoot 'net48/build/.NETFramework/v4.8'
$netfxSdk = Join-Path $toolRoot 'netfx-sdk'

$required = @(
    "$vcBin/cl.exe", "$vcBin/link.exe", "$vcBin/lib.exe",
    "$vcRoot/include/vcclr.h", "$vcRoot/atlmfc/include/atlbase.h",
    "$sdkBin/fxc.exe", "$sdkInclude/um/Windows.h",
    "$sdkInclude/cppwinrt/winrt/base.h", "$sdkLib/um/x64/kernel32.lib",
    "$sdkLib/ucrt/x64/ucrt.lib", "$net48/mscorlib.dll", "$netfxSdk/lib/x64/mscoree.lib"
)
foreach ($item in $required) {
    if (-not (Test-Path -LiteralPath $item)) {
        throw "Toolchain file missing: $item. Run python native/tools/bootstrap_toolchain.py first."
    }
}

$includes = @(
    "$vcRoot/include", "$vcRoot/atlmfc/include", "$sdkInclude/ucrt",
    "$sdkInclude/shared", "$sdkInclude/um", "$sdkInclude/winrt", "$sdkInclude/cppwinrt",
    "$netfxSdk/include/um"
)
$libraries = @(
    "$vcRoot/lib/x64", "$vcRoot/atlmfc/lib/x64", "$sdkLib/ucrt/x64", "$sdkLib/um/x64",
    "$netfxSdk/lib/x64"
)
# These assignments affect only this PowerShell process and its children.
$env:PATH = (@($vcBin, $sdkBin) + ($env:PATH -split ';') | Select-Object -Unique) -join ';'
$env:INCLUDE = $includes -join ';'
$env:LIB = $libraries -join ';'
$env:LIBPATH = @($net48, "$vcRoot/lib/x64", "$vcRoot/lib/x64/store/references") -join ';'
$env:FRAMEFLOW_TOOLCHAIN_ROOT = $toolRoot
$env:FRAMEFLOW_NET48_REFS = $net48
$env:VCToolsInstallDir = "$vcRoot/"
$env:WindowsSdkDir = "$sdkRoot/"
$env:WindowsSDKVersion = "$sdkVersion/"

$FrameFlowToolchain = [pscustomobject]@{
    Root = $toolRoot
    VcRoot = $vcRoot
    VcBin = $vcBin
    SdkRoot = $sdkRoot
    SdkIncludeRoot = $sdkInclude
    SdkLibRoot = $sdkLib
    SdkBin = $sdkBin
    Net48References = $net48
    Net48Sdk = $netfxSdk
    Cl = Join-Path $vcBin 'cl.exe'
    Link = Join-Path $vcBin 'link.exe'
    Lib = Join-Path $vcBin 'lib.exe'
    Fxc = Join-Path $sdkBin 'fxc.exe'
}
if ($AsJson) { $FrameFlowToolchain | ConvertTo-Json }
elseif ($PassThru) { $FrameFlowToolchain }
