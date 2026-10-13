using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Windows.Forms;

public static class FrameFlowCaptureTestWindow
{
    [DllImport("user32.dll")]
    private static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr window, int command);

    [DataContract]
    private sealed class WindowInfo
    {
        [DataMember(Name = "hwnd", Order = 0)] public long Handle;
        [DataMember(Name = "pid", Order = 1)] public int ProcessId;
        [DataMember(Name = "title", Order = 2)] public string Title;
    }

    public static void Run(string infoPath, string windowTitle, int physicalWidth,
        int physicalHeight, int windowLeft, int windowTop, int updateIntervalMs, bool borderless)
    {
        if (physicalWidth <= 0 || physicalHeight <= 0)
            throw new ArgumentOutOfRangeException("physicalWidth", "The test window must have positive dimensions.");
        if (updateIntervalMs < 0 || updateIntervalMs > 60000)
            throw new ArgumentOutOfRangeException("updateIntervalMs");

        SetProcessDpiAwarenessContext(new IntPtr(-4));
        var fullInfoPath = Path.GetFullPath(infoPath);
        using (var titleFont = new Font("Segoe UI", 28))
        using (var clockFont = new Font("Consolas", 25))
        using (var buttonFont = new Font("Segoe UI", 20))
        using (var textFont = new Font("Segoe UI", 18))
        using (var form = new Form())
        using (var timer = new Timer())
        {
            form.Text = windowTitle;
            form.StartPosition = FormStartPosition.Manual;
            form.Location = new Point(windowLeft, windowTop);
            form.FormBorderStyle = borderless ? FormBorderStyle.None : FormBorderStyle.FixedSingle;
            form.ClientSize = new Size(physicalWidth, physicalHeight);
            form.BackColor = Color.FromArgb(24, 28, 44);
            form.MaximizeBox = false;
            form.TopMost = true;

            var title = new Label {
                Text = "FrameFlow capture verification", Location = new Point(48, 48),
                Size = new Size(850, 70), Font = titleFont, ForeColor = Color.White
            };
            var clockLabel = new Label {
                Text = "STATIC SCENE", Location = new Point(52, 160), Size = new Size(830, 75),
                Font = clockFont, ForeColor = Color.FromArgb(108, 220, 190)
            };
            var button = new Button {
                Text = "CLICK MARKER", Location = new Point(52, 295), Size = new Size(300, 90),
                Font = buttonFont, BackColor = Color.FromArgb(174, 145, 250), FlatStyle = FlatStyle.Flat
            };
            var textBox = new TextBox {
                Text = "Controlled test content only.", Location = new Point(52, 445),
                Size = new Size(750, 50), Font = textFont
            };
            form.Controls.AddRange(new Control[] { title, clockLabel, button, textBox });
            int clicks = 0, ticks = 0;
            button.Click += delegate { button.Text = "MARKER " + (++clicks); };
            timer.Interval = Math.Max(1, updateIntervalMs);
            timer.Tick += delegate {
                ticks++;
                clockLabel.Text = "FRAME " + ticks + "    " + DateTime.Now.ToString("HH:mm:ss.fff");
                clockLabel.ForeColor = Color.FromArgb(100 + (ticks % 100), 220, 190);
            };
            form.Shown += delegate {
                ShowWindow(form.Handle, 5);
                Directory.CreateDirectory(Path.GetDirectoryName(fullInfoPath));
                using (var process = Process.GetCurrentProcess())
                using (var file = new FileStream(fullInfoPath, FileMode.Create, FileAccess.Write, FileShare.Read))
                {
                    new DataContractJsonSerializer(typeof(WindowInfo)).WriteObject(file, new WindowInfo {
                        Handle = form.Handle.ToInt64(), ProcessId = process.Id, Title = form.Text
                    });
                }
                if (updateIntervalMs > 0) timer.Start();
            };
            Application.Run(form);
        }
    }
}
