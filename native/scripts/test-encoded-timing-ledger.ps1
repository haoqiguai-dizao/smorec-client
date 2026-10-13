$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
. (Join-Path $workspace 'native/tools/enter-toolchain.ps1')
$source = Join-Path $workspace 'native/tests/EncodedTimingLedger.tests.cpp'
$includes = Join-Path $workspace 'native/vendor/ScreenRecorderLib/ScreenRecorderLibNative'
$testOutput = Join-Path $workspace 'output/encoded-sample-timing/tests'
New-Item -ItemType Directory -Force -Path $testOutput | Out-Null
$executable = Join-Path $testOutput 'EncodedTimingLedger.tests.exe'
& cl.exe /nologo /std:c++17 /EHsc /W4 /WX /MD /O2 /utf-8 "/I$includes" "/Fo$testOutput/" "/Fe$executable" $source
if ($LASTEXITCODE) { throw 'Encoded timing ledger test compilation failed.' }
& $executable
if ($LASTEXITCODE) { throw 'Encoded timing ledger tests failed.' }
$failureSource = Join-Path $workspace 'native/tests/EncodedTimingFailures.tests.cpp'
$failureExecutable = Join-Path $testOutput 'EncodedTimingFailures.tests.exe'
& cl.exe /nologo /std:c++17 /EHsc /W3 /WX /MD /O2 /utf-8 /DNOMINMAX /D_DISABLE_CONSTEXPR_MUTEX_CONSTRUCTOR "/I$includes" "/Fo$testOutput/" "/Fe$failureExecutable" $failureSource (Join-Path $includes 'EncodedSampleTiming.cpp') (Join-Path $includes 'StaleWriterMaintenance.cpp') /link Mfuuid.lib Shlwapi.lib
if ($LASTEXITCODE) { throw 'Encoded timing failure test compilation failed.' }
& $failureExecutable
if ($LASTEXITCODE) { throw 'Encoded timing failure tests failed.' }
$clockSource = Join-Path $workspace 'native/tests/MediaClockOrigin.tests.cpp'
$clockExecutable = Join-Path $testOutput 'MediaClockOrigin.tests.exe'
& cl.exe /nologo /std:c++17 /EHsc /W4 /WX /MD /O2 /utf-8 "/I$includes" "/Fo$testOutput/" "/Fe$clockExecutable" $clockSource /link Mfplat.lib Mfuuid.lib Mf.lib Ole32.lib
if ($LASTEXITCODE) { throw 'Media clock origin test compilation failed.' }
& $clockExecutable
if ($LASTEXITCODE) { throw 'Media clock origin tests failed.' }
