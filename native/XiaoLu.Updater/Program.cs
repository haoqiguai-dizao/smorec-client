using System.Diagnostics;

namespace XiaoLu.Updater;

internal static class Program
{
    [STAThread]
    private static async Task<int> Main(string[] args)
    {
        try
        {
            if (args.Length != 2 || args[0] is not ("stage" or "verify" or "apply" or "recover" or "parent" or "permission")) throw new IOException("更新操作无效");
            var plan = Documents.Read<UpdatePlan>(args[1], 16000);
            Paths.Validate(plan);
            if (args[0] == "permission") { Console.WriteLine(Permission(plan.Target)); return 0; }
            if (args[0] == "parent")
            {
                using var parent = Process.GetProcessById(plan.ParentId);
                Console.WriteLine(parent.StartTime.ToUniversalTime().Ticks.ToString());
                return 0;
            }
            if (args[0] == "stage") Package.Stage(plan);
            if (args[0] == "verify") Package.Verify(plan);
            if (args[0] == "recover")
            {
                FileStream ownership;
                try { ownership = new FileStream(Path.Combine(plan.Session, "applying.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None); }
                catch (IOException) { Console.WriteLine("active"); return 0; }
                using var held = ownership;
                if (Transaction.Recover(plan)) { Console.WriteLine("recovered"); return 0; }
            }
            if (args[0] == "apply") await Apply(plan);
            Console.WriteLine("ok");
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message);
            return 1;
        }
    }
    private static string Permission(string target)
    {
        if (!Directory.Exists(target)) return "unknown";
        var first = Path.Combine(target, ".smorec-probe-" + Guid.NewGuid().ToString("N"));
        var second = first + "-renamed";
        var created = false;
        try
        {
            using (var file = new FileStream(first, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                created = true; file.WriteByte(0); file.Flush(true);
            }
            File.Move(first, second);
            File.Delete(second);
            return "writable";
        }
        catch (UnauthorizedAccessException) { return "blocked"; }
        catch (IOException) { return "unknown"; }
        finally
        {
            if (created) foreach (var file in new[] { first, second })
                try { if (File.Exists(file)) File.Delete(file); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        }
    }
    private static async Task Apply(UpdatePlan plan)
    {
        Package.Verify(plan);
        if (!File.Exists(Path.Combine(plan.Target, "小录.exe"))) throw new IOException("安装目录无效");
        // Open the exact parent process before acknowledging readiness; never kill an unrelated PID.
        using var parent = Process.GetProcessById(plan.ParentId);
        if (parent.StartTime.ToUniversalTime().Ticks.ToString() != plan.ParentStarted) throw new IOException("更新会话已变化");
        using var ownership = new FileStream(Path.Combine(plan.Session, "applying.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
        Documents.Write(Path.Combine(plan.Session, "ready.json"), new { parentId = plan.ParentId });
        var committed = Path.Combine(plan.Session, "commit");
        for (var count = 0; count < 300 && !File.Exists(committed); count++)
        {
            if (parent.HasExited) return;
            await Task.Delay(100);
        }
        if (!File.Exists(committed)) return;
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(60));
        try { await parent.WaitForExitAsync(timeout.Token); }
        catch (OperationCanceledException) { return; } // a cancelled quit leaves the running app intact
        try
        {
            Transaction.Apply(plan);
            var launched = StartApp(plan.Target);
            if (launched == null) throw new IOException("新版未能启动");
            using (launched)
            {
                // An immediate startup failure restores the complete prior file set.
                var closed = launched.WaitForExit(5000);
                if (closed && launched.ExitCode != 0) throw new IOException("新版启动失败");
            }
            Documents.Write(Path.Combine(plan.Session, "result.json"), new { status = "applied", version = plan.Version });
            // Keep backups until a later successful launch; external camera consumers may still map them.
        }
        catch (Exception error)
        {
            var recovered = false;
            try
            {
                if (File.Exists(Transaction.JournalPath(plan))) Transaction.RollbackLaunch(plan);
                recovered = true;
            }
            catch { /* Preserve the journal and backups for the next startup recovery. */ }
            Documents.Write(Path.Combine(plan.Session, "result.json"), new { status = "failed", recovered, error = error.Message });
            if (recovered) StartApp(plan.Target);
        }
    }
    private static Process? StartApp(string target)
    {
        var start = new ProcessStartInfo(Path.Combine(target, "小录.exe")) { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = target };
        start.ArgumentList.Add("--updated");
        return Process.Start(start);
    }
}
