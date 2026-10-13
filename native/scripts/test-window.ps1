param(
    [string]$InfoPath = "$PSScriptRoot/../test-output/window.json",
    [string]$WindowTitle = 'FrameFlow Capture Verification',
    [int]$PhysicalWidth = 1000,
    [int]$PhysicalHeight = 620,
    [int]$WindowLeft = 160,
    [int]$WindowTop = 140,
    [ValidateRange(0, 60000)][int]$UpdateIntervalMs = 33,
    [switch]$Borderless
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class FrameFlowTestDpi {
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
}
'@
[void][FrameFlowTestDpi]::SetProcessDpiAwarenessContext([IntPtr](-4))
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$form = New-Object System.Windows.Forms.Form
$form.Text = $WindowTitle
$form.StartPosition = 'Manual'
$form.Location = New-Object System.Drawing.Point($WindowLeft, $WindowTop)
$form.ClientSize = New-Object System.Drawing.Size($PhysicalWidth, $PhysicalHeight)
$form.BackColor = [System.Drawing.Color]::FromArgb(24, 28, 44)
$form.FormBorderStyle = 'FixedSingle'
if ($Borderless) {
    $form.FormBorderStyle = 'None'
    $left = if ($PSBoundParameters.ContainsKey('WindowLeft')) { $WindowLeft } else { 0 }
    $top = if ($PSBoundParameters.ContainsKey('WindowTop')) { $WindowTop } else { 0 }
    $form.Location = New-Object System.Drawing.Point($left, $top)
    $form.Size = New-Object System.Drawing.Size($PhysicalWidth, $PhysicalHeight)
}
$form.MaximizeBox = $false
$form.TopMost = $true
$title = New-Object System.Windows.Forms.Label
$title.Text = 'FrameFlow capture verification'
$title.Location = New-Object System.Drawing.Point(48, 48)
$title.Size = New-Object System.Drawing.Size(850, 70)
$title.Font = New-Object System.Drawing.Font('Segoe UI', 28)
$title.ForeColor = [System.Drawing.Color]::White
$form.Controls.Add($title)
$clockLabel = New-Object System.Windows.Forms.Label
$clockLabel.Location = New-Object System.Drawing.Point(52, 160)
$clockLabel.Size = New-Object System.Drawing.Size(830, 75)
$clockLabel.Font = New-Object System.Drawing.Font('Consolas', 25)
$clockLabel.ForeColor = [System.Drawing.Color]::FromArgb(108, 220, 190)
$form.Controls.Add($clockLabel)
$button = New-Object System.Windows.Forms.Button
$button.Text = 'CLICK MARKER'
$button.Location = New-Object System.Drawing.Point(52, 295)
$button.Size = New-Object System.Drawing.Size(300, 90)
$button.Font = New-Object System.Drawing.Font('Segoe UI', 20)
$button.BackColor = [System.Drawing.Color]::FromArgb(174, 145, 250)
$button.FlatStyle = 'Flat'
$form.Controls.Add($button)
$script:clicks = 0
$button.Add_Click({ $script:clicks++; $button.Text = "MARKER $script:clicks" })
$textBox = New-Object System.Windows.Forms.TextBox
$textBox.Text = 'Controlled test content only.'
$textBox.Location = New-Object System.Drawing.Point(52, 445)
$textBox.Size = New-Object System.Drawing.Size(750, 50)
$textBox.Font = New-Object System.Drawing.Font('Segoe UI', 18)
$form.Controls.Add($textBox)
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = [Math]::Max(1, $UpdateIntervalMs)
$clockLabel.Text = 'STATIC SCENE'
$script:ticks = 0
$timer.Add_Tick({
    $script:ticks++
    $clockLabel.Text = "FRAME $script:ticks    " + [DateTime]::Now.ToString('HH:mm:ss.fff')
    $clockLabel.ForeColor = [System.Drawing.Color]::FromArgb(100 + ($script:ticks % 100), 220, 190)
})
$form.Add_Shown({
    [void][FrameFlowTestDpi]::ShowWindow($form.Handle, 5)
    New-Item -ItemType Directory -Force (Split-Path -Parent $InfoPath) | Out-Null
    @{ hwnd = $form.Handle.ToInt64(); pid = $PID; title = $form.Text } | ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath $InfoPath
    if ($UpdateIntervalMs -gt 0) { $timer.Start() }
})
try { [System.Windows.Forms.Application]::Run($form) }
finally { $timer.Dispose(); $form.Dispose() }
