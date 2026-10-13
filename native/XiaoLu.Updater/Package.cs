using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace XiaoLu.Updater;

internal static class Package
{
    internal const string ManifestName = "smorec-update-files.json";
    internal static void Stage(UpdatePlan plan)
    {
        Paths.Validate(plan);
        using var input = new FileStream(plan.Package, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (input.Length != plan.Size || Convert.ToHexString(SHA256.HashData(input)).ToLowerInvariant() != plan.Sha256)
            throw new IOException("更新包校验失败");
        input.Position = 0;
        if (Convert.ToBase64String(SHA512.HashData(input)) != plan.Sha512) throw new IOException("更新包校验失败");
        if (Directory.Exists(plan.Staged)) { Verify(plan); return; }
        input.Position = 0;
        using var zip = new ZipArchive(input, ZipArchiveMode.Read);
        if (zip.Entries.Count is < 3 or > 20000 || zip.Entries.Sum(entry => entry.Length) > 8L * 1024 * 1024 * 1024)
            throw new IOException("更新包解压大小异常");
        // A new session is used for every failed preparation. Never reuse a partially extracted tree.
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var entry in zip.Entries)
        {
            var name = entry.FullName.TrimEnd('/');
            Paths.Child(plan.Staged, name);
            if (!names.Add(name) || ((entry.ExternalAttributes >> 16) & 0xF000) == 0xA000
                || (entry.ExternalAttributes & (int)FileAttributes.ReparsePoint) != 0)
                throw new IOException("更新包包含重复路径或链接");
        }
        Directory.CreateDirectory(plan.Staged);
        foreach (var entry in zip.Entries)
        {
            var destination = Paths.Child(plan.Staged, entry.FullName.TrimEnd('/'));
            if (entry.FullName.EndsWith('/')) { Directory.CreateDirectory(destination); continue; }
            Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
            entry.ExtractToFile(destination, false);
        }
        Verify(plan);
    }
    internal static PackageManifest Verify(UpdatePlan plan)
    {
        Paths.Validate(plan);
        // Bind the extracted manifest back to the signed ZIP, including on cached/restart paths.
        using (var input = new FileStream(plan.Package, FileMode.Open, FileAccess.Read, FileShare.Read))
        {
            if (input.Length != plan.Size || Convert.ToHexString(SHA256.HashData(input)).ToLowerInvariant() != plan.Sha256)
                throw new IOException("缓存更新包校验失败");
            input.Position = 0;
            if (Convert.ToBase64String(SHA512.HashData(input)) != plan.Sha512) throw new IOException("缓存更新包校验失败");
            input.Position = 0;
            using var archive = new ZipArchive(input, ZipArchiveMode.Read);
            var entry = archive.GetEntry(ManifestName) ?? throw new IOException("更新包缺少文件清单");
            if (entry.Length > 8 * 1024 * 1024) throw new IOException("更新文件清单过大");
            using var manifestStream = entry.Open();
            var original = Convert.ToHexString(SHA256.HashData(manifestStream)).ToLowerInvariant();
            if (original != Paths.Digest(Paths.Child(plan.Staged, ManifestName))) throw new IOException("解压清单与签名更新包不一致");
        }
        var manifest = ReadManifest(plan.Staged, plan.Version);
        var expected = new HashSet<string>(manifest.Files.Select(file => file.Path), StringComparer.OrdinalIgnoreCase) { ManifestName };
        foreach (var file in manifest.Files)
        {
            var source = Paths.Child(plan.Staged, file.Path);
            if (new FileInfo(source).Length != file.Size || Paths.Digest(source) != file.Sha256)
                throw new IOException("更新文件校验失败");
        }
        var folders = new Stack<string>(); folders.Push(plan.Staged);
        while (folders.Count > 0)
            foreach (var file in Directory.EnumerateFileSystemEntries(folders.Pop()))
            {
                Paths.NoLinks(file);
                if (Directory.Exists(file)) folders.Push(file);
                else if (!expected.Contains(Path.GetRelativePath(plan.Staged, file).Replace('\\', '/')))
                    throw new IOException("更新包存在未登记文件");
            }
        return manifest;
    }
    internal static PackageManifest ReadManifest(string root, string? version = null)
    {
        var manifest = Documents.Read<PackageManifest>(Paths.Child(root, ManifestName));
        if (manifest.Schema != 1 || (version != null && manifest.Version != version)
            || manifest.Files.Length is < 2 or > 20000 || manifest.Files.Sum(file => file.Size) > 8L * 1024 * 1024 * 1024)
            throw new IOException("更新文件清单无效");
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var file in manifest.Files)
        {
            Paths.Child(root, file.Path);
            if (!names.Add(file.Path) || file.Path.Equals(ManifestName, StringComparison.OrdinalIgnoreCase)
                || file.Size < 0 || !Regex.IsMatch(file.Sha256, "^[a-f0-9]{64}$")) throw new IOException("更新文件清单无效");
        }
        if (!names.Contains("小录.exe") || !names.Contains("resources/app.asar")) throw new IOException("更新包缺少程序文件");
        return manifest;
    }
}
