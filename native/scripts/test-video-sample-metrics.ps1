$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
. (Join-Path $workspace 'native/tools/enter-toolchain.ps1')
$source = Join-Path $workspace 'native/tests/VideoSampleMetrics.tests.cpp'
$includes = Join-Path $workspace 'native/vendor/ScreenRecorderLib/ScreenRecorderLibNative'
$testOutput = Join-Path $workspace 'output/video-sample-diagnostics/tests'
New-Item -ItemType Directory -Force -Path $testOutput | Out-Null
$executable = Join-Path $testOutput 'VideoSampleMetrics.tests.exe'
& cl.exe /nologo /std:c++17 /EHsc /W4 /WX /MD /O2 /utf-8 "/I$includes" "/Fo$testOutput/" "/Fe$executable" $source
if ($LASTEXITCODE) { throw 'Video sample metrics test compilation failed.' }
& $executable
if ($LASTEXITCODE) { throw 'Video sample metrics tests failed.' }
