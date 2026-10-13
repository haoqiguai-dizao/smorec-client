$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'live-preview-window.ps1')
$liveFixture = [OwnedLivePreviewWindow]::new()
try {
    [Console]::Out.WriteLine($liveFixture.Handle.ToInt64().ToString())
    [Console]::Out.Flush()
    while ($null -ne [Console]::In.ReadLine()) { }
} finally { $liveFixture.Dispose() }
