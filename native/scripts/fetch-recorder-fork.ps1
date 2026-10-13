$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$vendor = Join-Path $workspace 'native/vendor/ScreenRecorderLib'
$patches = @('frameflow-exclusion.patch', 'frameflow-encoder-tuning.patch', 'frameflow-sample-diagnostics.patch', 'frameflow-encoded-timing.patch', 'frameflow-live-preview.patch', 'frameflow-recording-exclusions.patch')
$commit = '646383234187efd3854e6b1069612b80c3ab9981'
if (!(Test-Path -LiteralPath $vendor)) {
    git clone --depth 1 --branch v7.0.1 https://github.com/sskodje/ScreenRecorderLib.git $vendor
    if ($LASTEXITCODE) { throw 'Could not fetch the pinned capture source.' }
}
$actual = git -C $vendor rev-parse HEAD
if ($LASTEXITCODE -or $actual -ne $commit) { throw 'Unexpected upstream checkout; refusing to patch it.' }
# Compare complete prefix states in an isolated index. Later patches can legitimately
# change earlier hunk context, so independent reverse checks are not reliable.
$previousIndex = $env:GIT_INDEX_FILE
$indexPath = Join-Path $workspace ('native/vendor/artifacts/patch-check-' + [guid]::NewGuid().ToString('N') + '.index')
$appliedCount = -1
try {
    $env:GIT_INDEX_FILE = $indexPath
    git -C $vendor read-tree HEAD
    if ($LASTEXITCODE) { throw 'Could not initialize a temporary source verification index.' }
    for ($count = 0; $count -le $patches.Count; $count++) {
        git -C $vendor diff --quiet
        $comparison = $LASTEXITCODE
        if ($comparison -eq 0) { $appliedCount = $count; break }
        if ($comparison -ne 1) { throw 'Could not compare the current fork sources.' }
        if ($count -lt $patches.Count) {
            git -C $vendor apply --cached (Join-Path $workspace "native/vendor/$($patches[$count])")
            if ($LASTEXITCODE) { throw "Cannot replay ordered patch $($patches[$count])." }
        }
    }
}
finally {
    $env:GIT_INDEX_FILE = $previousIndex
    if (Test-Path -LiteralPath $indexPath) { Remove-Item -LiteralPath $indexPath -Force }
}
if ($appliedCount -lt 0) { throw 'The vendor source differs from every pinned patch prefix; preserve and inspect local changes first.' }
Write-Output "$appliedCount of $($patches.Count) ordered patches are already applied."
for ($index = $appliedCount; $index -lt $patches.Count; $index++) {
    $name = $patches[$index]
    $patch = Join-Path $workspace "native/vendor/$name"
    git -C $vendor apply --check $patch
    if ($LASTEXITCODE) { throw "The upstream source differs from $name; preserve and inspect it first." }
    git -C $vendor apply $patch
    if ($LASTEXITCODE) { throw "Could not apply $name." }
}
Write-Output 'Pinned FrameFlow capture fork is ready.'
