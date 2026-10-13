namespace XiaoLu.Updater;

internal static class Transaction
{
    internal static string JournalPath(UpdatePlan plan) => Path.Combine(plan.Session, "journal.json");
    private static string BackupPath(UpdatePlan plan) => Path.Combine(plan.Target, ".smorec-update-" + Path.GetFileName(plan.Session));
    internal static void Apply(UpdatePlan plan)
    {
        var manifest = Package.Verify(plan);
        if (File.Exists(JournalPath(plan))) Recover(plan);
        var backup = BackupPath(plan);
        Paths.NoLinks(backup);
        if (Directory.Exists(backup)) throw new IOException("更新备份目录已存在");
        Directory.CreateDirectory(backup);
        var journal = new Journal(plan.Target, backup, plan.Version, []);
        Documents.Write(JournalPath(plan), journal);
        var incoming = manifest.Files.Select(file => file.Path).Append(Package.ManifestName).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var previous = Path.Combine(plan.Target, Package.ManifestName);
        var removed = File.Exists(previous) ? Package.ReadManifest(plan.Target).Files.Select(file => file.Path).Where(name => !incoming.Contains(name)) : [];
        try
        {
            foreach (var name in incoming.Concat(removed))
            {
                var destination = Paths.Child(plan.Target, name);
                var saved = Paths.Child(backup, name);
                var existed = File.Exists(destination);
                if (Directory.Exists(destination)) throw new IOException("程序文件被目录占用");
                // Write-ahead journal: recovery also covers interruption between the two renames.
                journal.Changes.Add(new Change(name, existed));
                Documents.Write(JournalPath(plan), journal);
                if (existed)
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(saved)!);
                    File.Move(destination, saved);
                }
                if (incoming.Contains(name))
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
                    var temporary = Path.Combine(backup, "replacement.tmp");
                    File.Copy(Paths.Child(plan.Staged, name), temporary, false);
                    using (var copied = new FileStream(temporary, FileMode.Open, FileAccess.Write, FileShare.None)) copied.Flush(true);
                    File.Move(temporary, destination);
                }
            }
            // This commits the complete file transaction, not confirmation that the new app started.
            Documents.Write(JournalPath(plan), journal with { Committed = true });
        }
        catch
        {
            Recover(plan);
            throw;
        }
    }
    internal static bool Recover(UpdatePlan plan)
    {
        Paths.Validate(plan);
        if (!File.Exists(JournalPath(plan))) return false;
        var journal = Documents.Read<Journal>(JournalPath(plan));
        if (!journal.Target.Equals(plan.Target, StringComparison.OrdinalIgnoreCase)
            || !journal.Backup.Equals(BackupPath(plan), StringComparison.OrdinalIgnoreCase)) throw new IOException("更新恢复路径无效");
        Paths.NoLinks(journal.Backup);
        if (!journal.Committed)
        {
            foreach (var change in journal.Changes.AsEnumerable().Reverse())
            {
                var destination = Paths.Child(plan.Target, change.Path);
                var saved = Paths.Child(journal.Backup, change.Path);
                if (File.Exists(saved))
                {
                    if (File.Exists(destination)) File.Delete(destination);
                    File.Move(saved, destination);
                }
                else if (!change.Existed && File.Exists(destination)) File.Delete(destination);
            }
        }
        // Only this transaction's proven child directory is eligible for deletion.
        if (Directory.Exists(journal.Backup))
        {
            foreach (var entry in Directory.EnumerateFileSystemEntries(journal.Backup, "*", SearchOption.AllDirectories)) Paths.NoLinks(entry);
            try { Directory.Delete(journal.Backup, true); }
            // Windows reports a mapped DLL as access denied, not necessarily a sharing IOException.
            // A committed transaction needs only housekeeping; retain its journal for a later retry.
            catch (Exception error) when (journal.Committed && error is IOException or UnauthorizedAccessException) { return false; }
        }
        try { File.Delete(JournalPath(plan)); }
        catch (Exception error) when (journal.Committed && error is IOException or UnauthorizedAccessException) { return false; }
        return !journal.Committed;
    }
    internal static void RollbackLaunch(UpdatePlan plan)
    {
        var journal = Documents.Read<Journal>(JournalPath(plan));
        Documents.Write(JournalPath(plan), journal with { Committed = false });
        Recover(plan);
    }
}
