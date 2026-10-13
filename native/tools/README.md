# Workspace-local Windows C++ toolchain

This bootstrap supports the ScreenRecorderLib 7.0.1 fork with x64 MSVC, ATL,
C++/CLI, Windows SDK headers/libraries and FXC. It extracts Microsoft archives
inside `.native-build-tools`; it does not run Visual Studio Setup, install MSI
packages, change registry entries, or persist machine/user environment variables.

## Reproduce

Run from the repository root with Python 3 and the existing .NET 8 SDK:

```powershell
python native/tools/bootstrap_toolchain.py --plan-only
python native/tools/bootstrap_toolchain.py
. ./native/tools/enter-toolchain.ps1
./native/tools/test-toolchain.ps1
```

The pinned archive plan is approximately 395 MiB. Archives, Microsoft metadata,
licenses, extracted files and smoke results remain under `.native-build-tools`.
The bootstrap accepts an alternate `--root` only inside `.native-build-tools` or
`native/tools`. The tools are for local building and must not be bundled in the
application release.

`enter-toolchain.ps1` sets `PATH`, `INCLUDE`, `LIB` and `LIBPATH` for the current
PowerShell process. Dot-source it before invoking a build. It exposes
`$FrameFlowToolchain`, `$env:FRAMEFLOW_TOOLCHAIN_ROOT` and
`$env:FRAMEFLOW_NET48_REFS`; `-PassThru` returns an object and `-AsJson` prints the
paths as JSON. It validates required files and fails before building if anything
is absent. This is a compiler toolchain, without Visual Studio MSBuild targets;
the fork build uses `cl.exe`, `lib.exe`, `link.exe` and `fxc.exe` directly.

## Pinned components

| Component | Version / directory |
| --- | --- |
| MSVC v143 x64 compiler, CRT, CLI, ATL | 14.44; `msvc/VC/Tools/MSVC/14.44.35207` |
| Windows SDK headers and tools | NuGet `Microsoft.Windows.SDK.CPP` 10.0.26100.9169; `sdk/c` |
| Windows SDK x64 import libraries | NuGet `Microsoft.Windows.SDK.CPP.x64` 10.0.26100.9169; `sdk-x64/c` |
| .NET Framework 4.8 references | NuGet `Microsoft.NETFramework.ReferenceAssemblies.net48` 1.0.3; `net48/build/.NETFramework/v4.8` |
| .NET Framework SDK headers and x64 import libraries | `Microsoft.Net.4.8.SDK` 4.8.3928.2; `netfx-sdk` |

The CRT Store component supplies desktop dynamic import libraries including
`msvcprt.lib`; the Desktop component alone is insufficient. The Framework SDK
CAB supplies `mscoree.lib`. Only SDK headers and x64 libraries are expanded from
that CAB; its MSI is retained as source metadata and is never executed.

## Integrity and licenses

`components.lock.json` records fixed Microsoft download URLs and SHA-256 hashes.
The three NuGet packages use the SHA-512 hashes published in their fixed NuGet
catalog records. A mismatching archive is never extracted. `download-plan.json`
records the requested payloads and `download-receipt.json` records successful
checks plus the SHA-256 of each downloaded archive. `test-toolchain.ps1` verifies
Microsoft Authenticode signatures on the compiler, linker, librarian, compiler
back ends and FXC before executing them; results are in `smoke/signatures.json`.

During initial setup, the mutable Visual Studio channel pointed to a catalog
whose downloaded bytes did not match the channel's catalog hash. The bootstrap
therefore does not trust or execute that mutable catalog: it uses separately
pinned per-component URLs and hashes, verifies every archive, and checks the
executable signatures. The initial rejected catalog remains a `.partial` file in
local metadata for investigation; it is not a bootstrap dependency.

Official license copies and their source URLs/hashes are kept in `licenses/`:

- [Visual Studio 2022 Diagnostic Build Tools license](https://visualstudio.microsoft.com/license-terms/vs2022-ga-diagnosticbuildtools/)
- [Windows SDK license](https://aka.ms/WinSDKLicenseURL)
- [.NET reference assemblies license](https://github.com/microsoft/dotnet/blob/master/LICENSE)

Package archives retain their original package metadata. The Windows SDK also
includes the C++/WinRT license under `sdk/c/Include/10.0.26100.0/cppwinrt`.

## Verification scope

The smoke script verifies native C++ headers (Windows, D3D11, ATL, C++/WinRT),
x64 compile/link/run, static library creation, Framework C++/CLI DLL compilation,
FXC shader compilation, and loading/calling that CLI DLL from a .NET 8 x64 host.
It creates no capture session and accesses no microphone or camera.

The Framework CLI smoke passed on this host. This confirms the small compiled
probe can load in the existing .NET 8 runtime; the complete recorder fork still
needs its own load and recording regression. The bootstrap intentionally
preserves the upstream Framework CLI compilation model.
