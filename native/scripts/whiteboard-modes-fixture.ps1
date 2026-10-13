Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @"
using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
public sealed class WhiteboardModesFixture : IDisposable {
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    sealed class FixtureForm : Form { protected override bool ShowWithoutActivation { get { return true; } } }
    readonly ManualResetEventSlim ready = new ManualResetEventSlim();
    readonly Thread thread;
    FixtureForm form;
    Exception error;
    public long Handle { get; private set; }
    public Rectangle Bounds { get; private set; }
    public WhiteboardModesFixture() {
        thread = new Thread(Run) { IsBackground=true };
        thread.SetApartmentState(ApartmentState.STA); thread.Start();
        if (!ready.Wait(5000)) throw new TimeoutException("Fixture creation timed out");
        if (error != null) throw error;
    }
    void Run() {
        try {
            SetThreadDpiAwarenessContext(new IntPtr(-4));
            var area = Screen.PrimaryScreen.WorkingArea;
            form = new FixtureForm { Text="OWNED WHITEBOARD MODES FIXTURE", FormBorderStyle=FormBorderStyle.None,
                StartPosition=FormStartPosition.Manual, TopMost=true, ShowInTaskbar=false,
                BackColor=Color.FromArgb(18,58,75), Bounds=new Rectangle(area.X+150,area.Y+150,
                    Math.Min(1800,area.Width-300),Math.Min(1200,area.Height-300)) };
            var timer = new System.Windows.Forms.Timer { Interval=150 };
            int pulse=0;
            form.Paint += (sender,args) => { using(var brush=new SolidBrush(pulse%2==0?Color.White:Color.Gray))
                args.Graphics.FillRectangle(brush,form.ClientSize.Width-20,form.ClientSize.Height-20,10,10); };
            timer.Tick += (sender,args) => { pulse++; form.Invalidate(); };
            form.Shown += (sender,args) => { Handle=form.Handle.ToInt64(); Bounds=form.Bounds; ready.Set(); timer.Start(); };
            Application.Run(form); timer.Dispose();
        } catch(Exception ex) { error=ex; ready.Set(); }
    }
    public void Dispose() {
        if (form != null && !form.IsDisposed) form.BeginInvoke(new Action(()=>form.Close()));
        thread.Join(3000); ready.Dispose();
    }
}
"@ -ReferencedAssemblies System.Windows.Forms,System.Drawing
$boardFixture = [WhiteboardModesFixture]::new()
try {
    @{ handle=$boardFixture.Handle.ToString(); physical=@{ x=$boardFixture.Bounds.X; y=$boardFixture.Bounds.Y;
        width=$boardFixture.Bounds.Width; height=$boardFixture.Bounds.Height }; pid=$PID } | ConvertTo-Json -Compress
    [Console]::Out.Flush()
    while ($null -ne [Console]::In.ReadLine()) {}
} finally { $boardFixture.Dispose() }
