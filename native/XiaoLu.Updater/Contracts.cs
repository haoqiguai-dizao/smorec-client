using System.Text.Json;

namespace XiaoLu.Updater;

internal sealed record UpdateFile(string Path, long Size, string Sha256);
internal sealed record PackageManifest(int Schema, string Version, UpdateFile[] Files);
internal sealed record UpdatePlan(string Session, string Package, string Staged, string Target,
    string Version, long Size, string Sha256, string Sha512, int ParentId = 0, string ParentStarted = "");
internal sealed record Change(string Path, bool Existed);
internal sealed record Journal(string Target, string Backup, string Version, List<Change> Changes, bool Committed = false);

internal static class Documents
{
    internal static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    internal static T Read<T>(string file, long limit = 8 * 1024 * 1024)
    {
        Paths.NoLinks(file);
        if (new FileInfo(file).Length > limit) throw new IOException("更新配置过大");
        return JsonSerializer.Deserialize<T>(File.ReadAllText(file), Json) ?? throw new IOException("更新配置无效");
    }
    internal static void Write<T>(string file, T value)
    {
        Paths.NoLinks(file);
        var temporary = file + ".tmp";
        Paths.NoLinks(temporary);
        using (var stream = new FileStream(temporary, FileMode.Create, FileAccess.Write, FileShare.None))
        {
            JsonSerializer.Serialize(stream, value, Json);
            stream.Flush(true);
        }
        File.Move(temporary, file, true);
    }
}
