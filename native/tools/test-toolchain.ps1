param([string]$ToolchainRoot = (Join-Path $PSScriptRoot '../../.native-build-tools'))

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'enter-toolchain.ps1') -ToolchainRoot $ToolchainRoot
$probeRoot = Join-Path $FrameFlowToolchain.Root 'smoke'
New-Item -ItemType Directory -Force -Path $probeRoot | Out-Null

$signedFiles = @(
    $FrameFlowToolchain.Cl, $FrameFlowToolchain.Link, $FrameFlowToolchain.Lib,
    (Join-Path $FrameFlowToolchain.VcBin 'c1xx.dll'),
    (Join-Path $FrameFlowToolchain.VcBin 'c2.dll'), $FrameFlowToolchain.Fxc
)
$signatures = foreach ($file in $signedFiles) {
    $signature = Get-AuthenticodeSignature -LiteralPath $file
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') {
        throw "Microsoft signature validation failed: $file ($($signature.Status))"
    }
    [pscustomobject]@{
        File = $file
        Status = [string]$signature.Status
        Signer = $signature.SignerCertificate.Subject
        Sha256 = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}
$signatures | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $probeRoot 'signatures.json') -Encoding utf8

@'
#include <windows.h>
#include <d3d11.h>
#include <atlbase.h>
#include <winrt/Windows.UI.h>
#include <windows.ui.interop.h>
int main() {
    CComPtr<ID3D11Device> unused;
    winrt::Windows::UI::WindowId id{};
    return static_cast<int>(id.Value);
}
'@ | Set-Content -LiteralPath (Join-Path $probeRoot 'native-probe.cpp') -Encoding utf8
@'
public ref class ToolchainProbe abstract sealed {
public:
    static int Answer() { return 42; }
};
'@ | Set-Content -LiteralPath (Join-Path $probeRoot 'managed-probe.cpp') -Encoding utf8
@'
float4 main() : SV_TARGET { return float4(0.0, 0.0, 0.0, 1.0); }
'@ | Set-Content -LiteralPath (Join-Path $probeRoot 'probe.hlsl') -Encoding utf8
@'
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <PlatformTarget>x64</PlatformTarget>
  </PropertyGroup>
  <ItemGroup>
    <Reference Include="managed-probe"><HintPath>managed-probe.dll</HintPath></Reference>
  </ItemGroup>
</Project>
'@ | Set-Content -LiteralPath (Join-Path $probeRoot 'net8-probe.csproj') -Encoding utf8
@'
if (ToolchainProbe.Answer() != 42) return 1;
System.Console.WriteLine("NET8_CLI_LOAD_PASS");
return 0;
'@ | Set-Content -LiteralPath (Join-Path $probeRoot 'Program.cs') -Encoding utf8

Push-Location $probeRoot
try {
    & $FrameFlowToolchain.Cl /nologo /std:c++17 /EHsc /MD /DUNICODE /D_UNICODE native-probe.cpp /Fenative-probe.exe
    if ($LASTEXITCODE -ne 0) { throw "Native compiler/linker smoke failed: $LASTEXITCODE" }
    & (Join-Path $probeRoot 'native-probe.exe')
    if ($LASTEXITCODE -ne 0) { throw "Native executable smoke failed: $LASTEXITCODE" }
    & $FrameFlowToolchain.Lib /nologo /OUT:native-probe.lib native-probe.obj
    if ($LASTEXITCODE -ne 0) { throw "Static librarian smoke failed: $LASTEXITCODE" }
    & $FrameFlowToolchain.Cl /nologo /std:c++17 /clr /LD /MD /EHa "/AI$($FrameFlowToolchain.Net48References)" "/FU$($FrameFlowToolchain.Net48References)/mscorlib.dll" managed-probe.cpp /link /OUT:managed-probe.dll
    if ($LASTEXITCODE -ne 0) { throw "C++/CLI compiler/linker smoke failed: $LASTEXITCODE" }
    & $FrameFlowToolchain.Fxc /nologo /T ps_4_0 /E main /Fo probe.cso probe.hlsl
    if ($LASTEXITCODE -ne 0) { throw "FXC shader compiler smoke failed: $LASTEXITCODE" }
    & dotnet run --project net8-probe.csproj --configuration Release --no-launch-profile --verbosity quiet
    if ($LASTEXITCODE -ne 0) { throw "NET8 C++/CLI assembly load smoke failed: $LASTEXITCODE" }
} finally {
    Pop-Location
}
Write-Output "PASS: Microsoft signatures; x64 native compile/link/run; static lib; .NET 4.8 C++/CLI DLL and NET8 host load; FXC. No capture or camera was used."
