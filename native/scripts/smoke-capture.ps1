param(
    [string]$Helper = "$PSScriptRoot/../publish/FrameFlow.Capture.exe",
    [string]$OutputDirectory = "$PSScriptRoot/../test-output/capture-$(Get-Date -Format yyyyMMdd-HHmmss)",
    [int]$Seconds = 3,
    [string]$SourceTitle = 'FrameFlow Capture Verification',
    [string]$SourceId,
    [double]$MaxTimingDifference = 0.25,
    [switch]$ExerciseCursor,
    [switch]$TestTone,
    [ValidateSet(30, 60)][int]$Fps = 30,
    [switch]$Crop,
    [switch]$CloseInput,
    [switch]$SystemAudio,
    [switch]$Microphone
)
$ErrorActionPreference = 'Stop'
$helperPath = (Resolve-Path -LiteralPath $Helper).Path
$startInfo = [System.Diagnostics.ProcessStartInfo]::new($helperPath)
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
$startInfo.RedirectStandardInput = $true
$startInfo.RedirectStandardOutput = $true
$startInfo.RedirectStandardError = $true
$startInfo.StandardInputEncoding = [System.Text.UTF8Encoding]::new($false)
$startInfo.StandardOutputEncoding = [System.Text.Encoding]::UTF8
$captureProcess = [System.Diagnostics.Process]::new()
$captureProcess.StartInfo = $startInfo

function Invoke-CaptureCommand([hashtable]$Request) {
    $captureProcess.StandardInput.WriteLine(($Request | ConvertTo-Json -Compress -Depth 6))
    $captureProcess.StandardInput.Flush()
    do {
        $lineTask = $captureProcess.StandardOutput.ReadLineAsync()
        if (-not $lineTask.Wait(40000)) { throw 'Native helper response timed out.' }
        $line = $lineTask.Result
        if ($null -eq $line) { throw "Native helper exited: $($captureProcess.StandardError.ReadToEnd())" }
        $message = $line | ConvertFrom-Json
        if ($message.event) { Write-Host $line }
    } while ($message.id -ne $Request.id)
    if (-not $message.ok) { throw $message.error }
    return $message.data
}

try {
    [void]$captureProcess.Start()
    $sources = Invoke-CaptureCommand @{ id = 1; command = 'sources' }
    $display = @($sources | Where-Object { $_.kind -eq 'window' -and $_.name -eq $SourceTitle -and (-not $SourceId -or $_.id -eq $SourceId) })[0]
    if ($null -eq $display) { throw "Controlled test window '$SourceTitle' not found. Start test-window.ps1 first." }
    $recordOptions = @{
        sourceId = $display.id; fps = $Fps; systemAudio = [bool]$SystemAudio; microphone = [bool]$Microphone
    }
    if ($Crop) { $recordOptions.crop = @{x=40; y=40; width=640; height=360} }
    $absoluteOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
    $started = Invoke-CaptureCommand @{ id = 2; command = 'start'; options = $recordOptions; directory = $absoluteOutput }
    if ($TestTone) {
        Add-Type -AssemblyName System.Windows.Extensions
        $tonePath = Join-Path $absoluteOutput 'test-tone.wav'
        $toneFile = [System.IO.BinaryWriter]::new([System.IO.File]::Create($tonePath))
        try {
            $toneFile.Write([System.Text.Encoding]::ASCII.GetBytes('RIFF')); $toneFile.Write([int](36 + 48000))
            $toneFile.Write([System.Text.Encoding]::ASCII.GetBytes('WAVEfmt ')); $toneFile.Write([int]16)
            $toneFile.Write([int16]1); $toneFile.Write([int16]1); $toneFile.Write([int]48000)
            $toneFile.Write([int]96000); $toneFile.Write([int16]2); $toneFile.Write([int16]16)
            $toneFile.Write([System.Text.Encoding]::ASCII.GetBytes('data')); $toneFile.Write([int]48000)
            for ($toneIndex = 0; $toneIndex -lt 24000; $toneIndex++) {
                $toneFile.Write([int16](1800 * [Math]::Sin(2 * [Math]::PI * 440 * $toneIndex / 48000)))
            }
        } finally { $toneFile.Dispose() }
        $sound = [System.Media.SoundPlayer]::new($tonePath)
        $sound.Play()
    }
    if ($ExerciseCursor) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class FrameFlowTestInput {
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int X; public int Y; }
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left; public int Top; public int Right; public int Bottom; }
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rectangle);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
'@
        [void][FrameFlowTestInput]::SetProcessDpiAwarenessContext([IntPtr](-4))
        $oldPoint = [FrameFlowTestInput+Point]::new()
        $testBounds = [FrameFlowTestInput+Rect]::new()
        [void][FrameFlowTestInput]::GetCursorPos([ref]$oldPoint)
        [void][FrameFlowTestInput]::GetWindowRect([IntPtr]::new([long]($display.id -replace '^window:', '')), [ref]$testBounds)
        try {
            foreach ($fraction in @(0.20, 0.25)) {
                [void][FrameFlowTestInput]::SetCursorPos([int]($testBounds.Left + ($testBounds.Right - $testBounds.Left) * $fraction), [int]($testBounds.Top + ($testBounds.Bottom - $testBounds.Top) * .55))
                Start-Sleep -Milliseconds 150
                [FrameFlowTestInput]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
                [FrameFlowTestInput]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
                Start-Sleep -Milliseconds 150
            }
        } finally { [void][FrameFlowTestInput]::SetCursorPos($oldPoint.X, $oldPoint.Y) }
    }
    Start-Sleep -Seconds $Seconds
    $stoppedAtUnixMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    if ($CloseInput) {
        $captureProcess.StandardInput.Close()
        if (-not $captureProcess.WaitForExit(40000)) { throw 'Native helper did not finalize on stdin EOF.' }
        $result = Get-Content -LiteralPath (Join-Path $absoluteOutput 'recording.json') -Raw | ConvertFrom-Json
    } else { $result = Invoke-CaptureCommand @{ id = 3; command = 'stop' } }
    $result | ConvertTo-Json -Depth 6
    $samples = Get-Content -LiteralPath (Join-Path $absoluteOutput 'cursor.json') -Raw | ConvertFrom-Json
    if ($result.duration -le 0 -or $samples.Count -lt 2) { throw 'No video duration or cursor data.' }
    $elapsed = ($stoppedAtUnixMs - $started.startedAtUnixMs) / 1000
    $timing = @{
        elapsedSeconds = $elapsed; duration = $result.duration; differenceSeconds = $elapsed - $result.duration
        width = $result.width; height = $result.height; targetFps = $Fps; warnings = $result.warnings
    }
    $timing | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $absoluteOutput 'verification-timing.json')
    $timing | ConvertTo-Json -Compress -Depth 4 | Write-Host
    if ([Math]::Abs($timing.differenceSeconds) -gt $MaxTimingDifference) {
        throw "Video differs from recording wall time by $($timing.differenceSeconds)s, above the $($MaxTimingDifference)s limit."
    }
    if (@($samples | Where-Object { $_.t -lt 0 -or $_.t -gt $result.duration -or $_.x -lt 0 -or $_.x -gt 1 -or $_.y -lt 0 -or $_.y -gt 1 }).Count -ne 0) {
        throw 'Cursor samples violate normalized coordinates or video timeline.'
    }
    Write-Host "PASS: $($samples.Count) cursor samples; $($result.duration) seconds."
    if ($ExerciseCursor -and @($samples | Where-Object click -eq $true).Count -lt 2) { throw 'Missing controlled mouse click samples.' }
    if ($sound) { $sound.Dispose() }
}
finally {
    if ($captureProcess.Id) {
        $captureProcess.StandardInput.Close()
        if (-not $captureProcess.WaitForExit(40000)) { $captureProcess.Kill() }
        $captureProcess.Dispose()
    }
}
