param([Parameter(Mandatory=$true)][string]$InfoPath)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ExclusionTestInterop {
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] public static extern bool GetWindowDisplayAffinity(IntPtr window, out uint affinity);
}
'@
[void][ExclusionTestInterop]::SetProcessDpiAwarenessContext([IntPtr](-4))
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$display = [Windows.Forms.Screen]::PrimaryScreen
$background = [Windows.Forms.Form]::new()
$background.Text = 'FrameFlow Controlled Exclusion Background'
$background.FormBorderStyle = 'None'
$background.StartPosition = 'Manual'
$background.Bounds = [Drawing.Rectangle]::new($display.Bounds.X,$display.Bounds.Y,1000,620)
$background.BackColor = [Drawing.Color]::FromArgb(24,28,44)
$background.TopMost = $true
$label = [Windows.Forms.Label]::new()
$label.Location = [Drawing.Point]::new(45,45)
$label.Size = [Drawing.Size]::new(900,120)
$label.Font = [Drawing.Font]::new('Consolas',25)
$label.ForeColor = [Drawing.Color]::White
$background.Controls.Add($label)
$overlay = [Windows.Forms.Form]::new()
$overlay.Text = 'FrameFlow Controlled Exclusion Overlay'
$overlay.FormBorderStyle = 'None'
$overlay.StartPosition = 'Manual'
$overlay.Bounds = [Drawing.Rectangle]::new($display.Bounds.X+600,$display.Bounds.Y+300,240,180)
$overlay.BackColor = [Drawing.Color]::Magenta
$overlay.TopMost = $true
$overlay.ShowInTaskbar = $false
$timer = [Windows.Forms.Timer]::new()
$timer.Interval = 33
$timer.Add_Tick({ $label.Text = 'CONTROLLED EXCLUSION TEST' + "`r`n" + [DateTime]::Now.ToString('HH:mm:ss.fff') })
$background.Add_Shown({
    [void][ExclusionTestInterop]::ShowWindow($background.Handle,5)
    $overlay.Show()
    [void][ExclusionTestInterop]::ShowWindow($overlay.Handle,5)
    $overlay.BringToFront()
    $affinity = [uint32]0
    if (![ExclusionTestInterop]::GetWindowDisplayAffinity($overlay.Handle,[ref]$affinity)) { throw 'GetWindowDisplayAffinity failed' }
    @{ background=$background.Handle.ToInt64(); overlay=$overlay.Handle.ToInt64(); affinity=$affinity
       sourceId=('screen:'+$display.DeviceName); x=$display.Bounds.X; y=$display.Bounds.Y; width=1000; height=620
    } | ConvertTo-Json | Set-Content -LiteralPath $InfoPath -Encoding UTF8
    $timer.Start()
})
try { [Windows.Forms.Application]::Run($background) }
finally { $timer.Dispose(); $overlay.Dispose(); $background.Dispose() }
