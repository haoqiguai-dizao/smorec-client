param([string]$NativeExecutable)
$ErrorActionPreference = 'Stop'
$liveSmokeRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (!$NativeExecutable) { $NativeExecutable = Join-Path $liveSmokeRoot 'native/FrameFlow.Capture/bin/x64/Release/net8.0-windows/win-x64/FrameFlow.Capture.exe' }
if (!(Test-Path -LiteralPath $NativeExecutable)) { throw 'Build FrameFlow.Capture in Release before running this smoke test.' }
. (Join-Path $PSScriptRoot "live-preview-window.ps1")

function Read-LiveReply([System.Diagnostics.Process]$Process, [int]$Id) {
    while ($true) {
        $line = $Process.StandardOutput.ReadLineAsync()
        if (!$line.Wait(20000)) { throw 'Native live command timed out.' }
        if ($null -eq $line.Result) { throw 'Native process ended before replying.' }
        $message = $line.Result | ConvertFrom-Json
        if ($message.event -eq 'live-error') { throw "Native live preview failed: $($message.error)" }
        if ($message.id -eq $Id) {
            if (!$message.ok) { throw "Native live command failed: $($message.error)" }
            return $message.data
        }
    }
}
function Read-LiveBytes([System.IO.Stream]$Stream, [byte[]]$Buffer) {
    $offset = 0
    while ($offset -lt $Buffer.Length) {
        $reading = $Stream.ReadAsync($Buffer, $offset, $Buffer.Length - $offset)
        if (!$reading.Wait(5000)) { throw 'Live frame pipe timed out.' }
        if ($reading.Result -le 0) { throw 'Live frame pipe ended early.' }
        $offset += $reading.Result
    }
}
$liveSmokeDirectory = Join-Path $liveSmokeRoot ('output/live-preview-smoke-' + [guid]::NewGuid().ToString('N'))
[System.IO.Directory]::CreateDirectory($liveSmokeDirectory) | Out-Null
$fixture = $null
$process = $null
$pipe = $null
try {
    $fixture = [OwnedLivePreviewWindow]::new()
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo.FileName = $NativeExecutable
    $process.StartInfo.WorkingDirectory = $liveSmokeDirectory
    $process.StartInfo.UseShellExecute = $false
    $process.StartInfo.CreateNoWindow = $true
    $process.StartInfo.RedirectStandardInput = $true
    $process.StartInfo.RedirectStandardOutput = $true
    $process.StartInfo.RedirectStandardError = $true
    $process.StartInfo.Environment.Remove('FRAMEFLOW_PARENT_PID') | Out-Null
    if (!$process.Start()) { throw 'Native process could not start.' }
    $pipeName = 'xiaolu-live-' + [guid]::NewGuid().ToString('D')
    $command = @{ id=1; command='live-start'; pipeName=$pipeName; options=@{
        sourceId=('window:' + $fixture.Handle.ToInt64()); fps=30; microphone=$false; systemAudio=$false } }
    $process.StandardInput.WriteLine(($command | ConvertTo-Json -Depth 5 -Compress))
    $ready = Read-LiveReply $process 1
    $pipe = [System.IO.Pipes.NamedPipeClientStream]::new('.', $pipeName, [System.IO.Pipes.PipeDirection]::InOut, [System.IO.Pipes.PipeOptions]::Asynchronous)
    $pipe.Connect(5000)
    $times = [System.Collections.Generic.List[double]]::new()
    $total = 0L
    for ($index=0; $index -lt 5; $index++) {
        $pipe.WriteByte(1)
        $header = [byte[]]::new(24)
        Read-LiveBytes $pipe $header
        $width = [BitConverter]::ToInt32($header,4)
        $height = [BitConverter]::ToInt32($header,8)
        $length = [BitConverter]::ToInt32($header,12)
        $time = [BitConverter]::ToDouble($header,16)
        if ([BitConverter]::ToUInt32($header,0) -ne 0x584c4652 -or $width -ne $ready.width -or $height -ne $ready.height -or $length -ne $width*$height*4) { throw 'Live frame header does not match the announced BGRA size.' }
        if ($width -lt 64 -or $height -lt 64 -or $width -gt 800 -or $height -gt 600 -or ![double]::IsFinite($time)) { throw 'Controlled live preview metadata is out of bounds.' }
        if ($times.Count -gt 0 -and $time -le $times[$times.Count-1]) { throw 'Static preview timestamps did not advance.' }
        $pixels = [byte[]]::new($length)
        Read-LiveBytes $pipe $pixels
        [Array]::Clear($pixels,0,$pixels.Length)
        $total += $length
        $times.Add($time)
        Start-Sleep -Milliseconds 120
    }
    $process.StandardInput.WriteLine('{"id":2,"command":"live-stop"}')
    $stop = Read-LiveReply $process 2
    if (!$stop.stopped) { throw 'Live capture did not stop cleanly.' }
    $files = [System.IO.Directory]::GetFiles($liveSmokeDirectory, '*', [System.IO.SearchOption]::AllDirectories)
    if ($files.Length -ne 0) { throw 'Preview unexpectedly wrote files in its working directory.' }
    @{ width=$width; height=$height; frames=$times.Count; frameBytes=$length; totalPixelBytes=$total;
        firstTimestamp=$times[0]; lastTimestamp=$times[$times.Count-1]; createdFiles=$files.Length; stopped=$stop.stopped } | ConvertTo-Json -Compress
} finally {
    if ($pipe) { $pipe.Dispose() }
    if ($process) {
        if (!$process.HasExited) {
            $process.StandardInput.Close()
            if (!$process.WaitForExit(5000)) { $process.Kill(); $process.WaitForExit() }
        }
        $process.Dispose()
    }
    if ($fixture) { $fixture.Dispose() }
    if ([System.IO.Directory]::Exists($liveSmokeDirectory) -and [System.IO.Directory]::GetFileSystemEntries($liveSmokeDirectory).Length -eq 0) { [System.IO.Directory]::Delete($liveSmokeDirectory) }
}
