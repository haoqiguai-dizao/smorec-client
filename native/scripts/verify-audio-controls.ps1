param([string]$Helper = "$PSScriptRoot/../publish/FrameFlow.Capture.exe")
$ErrorActionPreference = 'Stop'
$processInfo = [System.Diagnostics.ProcessStartInfo]::new((Resolve-Path -LiteralPath $Helper).Path)
$processInfo.UseShellExecute = $false
$processInfo.CreateNoWindow = $true
$processInfo.RedirectStandardInput = $true
$processInfo.RedirectStandardOutput = $true
$processInfo.RedirectStandardError = $true
$processInfo.StandardInputEncoding = [System.Text.UTF8Encoding]::new($false)
$processInfo.StandardOutputEncoding = [System.Text.Encoding]::UTF8
$helperProcess = [System.Diagnostics.Process]::Start($processInfo)
function Send-Request([hashtable]$request) {
    $helperProcess.StandardInput.WriteLine(($request | ConvertTo-Json -Depth 5 -Compress))
    $helperProcess.StandardInput.Flush()
    do {
        $reading = $helperProcess.StandardOutput.ReadLineAsync()
        if (-not $reading.Wait(10000)) { throw 'Helper response timeout' }
        if ($null -eq $reading.Result) { throw 'Helper exited unexpectedly' }
        $response = $reading.Result | ConvertFrom-Json
    } while ($response.id -ne $request.id)
    return $response
}
try {
    $devices = Send-Request @{ id=1; command='microphone-devices' }
    if (-not $devices.ok) { throw $devices.error }
    foreach ($device in $devices.data) {
        if (-not $device.id -or -not $device.name -or $device.isDefault -isnot [bool]) { throw 'Invalid endpoint metadata' }
    }
    $mute = Send-Request @{ id=2; command='audio-mute'; options=@{microphoneMuted=$true} }
    if ($mute.ok -or -not $mute.error) { throw 'Mute must reject a missing recording session' }
    $sources = Send-Request @{ id=3; command='sources' }
    $display = @($sources.data | Where-Object kind -eq 'screen')[0]
    if (-not $display) { throw 'No display available for preflight validation' }
    $outputDirectory = [System.IO.Path]::GetFullPath((Join-Path "$PSScriptRoot/../test-output" ('audio-preflight-' + [Guid]::NewGuid().ToString('N'))))
    # The intentionally invalid endpoint is rejected before cursor/audio/video is started.
    $invalid = Send-Request @{
        id=4; command='start'; directory=$outputDirectory
        options=@{sourceId=$display.id;fps=30;systemAudio=$false;microphone=$true;microphoneDeviceId='FrameFlow-test-missing-endpoint'}
    }
    if ($invalid.ok -or $invalid.error -notlike '*capture.log*') { throw 'Missing endpoint did not return a diagnostic failure' }
    $log = Get-Content -LiteralPath (Join-Path $outputDirectory 'capture.log') -Raw
    if ($log -match '"stage":"(audio-started|video-start)"') { throw 'Capture started despite a missing selected endpoint' }
    if (Test-Path -LiteralPath (Join-Path $outputDirectory 'screen.mp4')) { throw 'Unexpected video output' }
    @{ result='PASS'; microphoneDevices=@($devices.data); muteWithoutSessionRejected=$true
        missingEndpointRejectedBeforeCapture=$true; diagnostics=$outputDirectory } | ConvertTo-Json -Depth 5
}
finally {
    $helperProcess.StandardInput.Close()
    if (-not $helperProcess.WaitForExit(10000)) { $helperProcess.Kill() }
    $helperProcess.Dispose()
}
