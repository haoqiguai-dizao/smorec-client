param([string]$Helper = "$PSScriptRoot/../publish/FrameFlow.Capture.exe")
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$out = Join-Path $workspace ('native/test-output/exclusion-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $out -Force | Out-Null
$infoPath = Join-Path $out 'windows.json'
$testScript = Join-Path $PSScriptRoot 'exclusion-test-windows.ps1'
$test = Start-Process powershell.exe -WindowStyle Hidden -PassThru -ArgumentList @('-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',('"'+$testScript+'"'),'-InfoPath',('"'+$infoPath+'"'))
$helperProcess = $null
function Request([hashtable]$request) {
    $helperProcess.StandardInput.WriteLine(($request | ConvertTo-Json -Depth 6 -Compress))
    $helperProcess.StandardInput.Flush()
    do {
        $reading = $helperProcess.StandardOutput.ReadLineAsync()
        if (!$reading.Wait(35000)) { throw 'Native response timeout' }
        if ($null -eq $reading.Result) { throw 'Native exited unexpectedly' }
        $response = $reading.Result | ConvertFrom-Json
    } while ($response.id -ne $request.id)
    if (!$response.ok) { throw $response.error }
    return $response.data
}
try {
    for ($attempt=0; $attempt -lt 80 -and !(Test-Path -LiteralPath $infoPath); $attempt++) { Start-Sleep -Milliseconds 100 }
    $windows = Get-Content -LiteralPath $infoPath -Raw | ConvertFrom-Json
    if ($windows.affinity -ne 0) { throw 'Test overlay must remain visible to independent screen viewers' }
    Start-Sleep -Milliseconds 500
    Add-Type -AssemblyName System.Drawing
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ExclusionProbeDpi {
    [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
}
'@
    $previousDpi=[ExclusionProbeDpi]::SetThreadDpiAwarenessContext([IntPtr](-4))
    $bitmap=[Drawing.Bitmap]::new(1000,620)
    $graphics=[Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.CopyFromScreen($windows.x,$windows.y,0,0,$bitmap.Size)
        $color=$bitmap.GetPixel(720,390)
        if ($color.R -lt 180 -or $color.G -gt 70 -or $color.B -lt 180) { throw 'The test overlay is not visible to ordinary desktop capture.' }
        $bitmap.Save((Join-Path $out 'desktop-visible.png'),[Drawing.Imaging.ImageFormat]::Png)
    }
    finally { $graphics.Dispose(); $bitmap.Dispose(); [void][ExclusionProbeDpi]::SetThreadDpiAwarenessContext($previousDpi) }
    $psi = [Diagnostics.ProcessStartInfo]::new((Resolve-Path -LiteralPath $Helper).Path)
    $psi.UseShellExecute=$false; $psi.CreateNoWindow=$true
    $psi.RedirectStandardInput=$true; $psi.RedirectStandardOutput=$true; $psi.RedirectStandardError=$true
    $psi.StandardInputEncoding=[Text.UTF8Encoding]::new($false); $psi.StandardOutputEncoding=[Text.Encoding]::UTF8
    $helperProcess=[Diagnostics.Process]::Start($psi)
    $results=@()
    foreach ($exclude in @($false,$true)) {
        $name = if ($exclude) { 'excluded' } else { 'visible' }
        $directory=Join-Path $out $name
        $options=@{sourceId=$windows.sourceId;fps=30;systemAudio=$false;microphone=$false
            crop=@{x=0;y=0;width=$windows.width;height=$windows.height}}
        if ($exclude) { $options.excludeWindowHandles=@([string]$windows.overlay) }
        $null=Request @{id=1;command='start';directory=$directory;options=$options}
        Start-Sleep -Milliseconds 2200
        $results+=Request @{id=2;command='stop'}
    }
    $ffmpeg=Join-Path $workspace 'node_modules/ffmpeg-static/ffmpeg.exe'
    foreach ($name in @('visible','excluded')) {
        $raw=Join-Path $out "$name.rgb"
        # Sample only the solid center of our own test overlay in every decoded frame.
        & $ffmpeg -hide_banner -loglevel error -i (Join-Path $out "$name/screen.mp4") -vf 'crop=20:20:710:380,scale=1:1:flags=area' -vsync 0 -pix_fmt rgb24 -f rawvideo -y $raw
        if ($LASTEXITCODE) { throw 'Frame verification decode failed' }
        $bytes=[IO.File]::ReadAllBytes($raw)
        if ($bytes.Length -lt 3) { throw 'No decoded video frames' }
        for ($i=0;$i -lt $bytes.Length;$i+=3) {
            $magenta=$bytes[$i] -gt 180 -and $bytes[$i+1] -lt 70 -and $bytes[$i+2] -gt 180
            if (($name -eq 'visible') -ne $magenta) { throw "$name frame $($i/3) failed pixel assertion: $($bytes[$i]),$($bytes[$i+1]),$($bytes[$i+2])" }
            if ($name -eq 'excluded' -and ([Math]::Abs($bytes[$i]-24) -gt 12 -or [Math]::Abs($bytes[$i+1]-28) -gt 12 -or [Math]::Abs($bytes[$i+2]-44) -gt 12)) {
                throw 'Excluded capture did not reveal the controlled background beneath the overlay.'
            }
        }
        & $ffmpeg -hide_banner -loglevel error -i (Join-Path $out "$name/screen.mp4") -frames:v 1 -y (Join-Path $out "$name.png")
    }
    @{result='PASS'; output=$out; globalDisplayAffinity=$windows.affinity; recordings=$results} | ConvertTo-Json -Depth 6
}
finally {
    if ($helperProcess) { $helperProcess.StandardInput.Close(); if (!$helperProcess.WaitForExit(15000)) { $helperProcess.Kill() }; $helperProcess.Dispose() }
    if ($test -and !$test.HasExited) { $test.CloseMainWindow() | Out-Null; if (!$test.WaitForExit(5000)) { $test.Kill() }; $test.Dispose() }
}
