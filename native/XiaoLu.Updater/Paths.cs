using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace XiaoLu.Updater;

internal static class Paths
{
    internal static string Root(string value)
    {
        var result = Path.GetFullPath(value).TrimEnd(Path.DirectorySeparatorChar);
        if (!Regex.IsMatch(result, @"^[A-Za-z]:\\") || result.Length < 4 || result.StartsWith(@"\\"))
            throw new IOException("更新目录无效");
        NoLinks(result);
        return result;
    }
    internal static bool Inside(string root, string value) => value.StartsWith(root + "\\", StringComparison.OrdinalIgnoreCase);
    internal static string Child(string root, string relative)
    {
        if (string.IsNullOrEmpty(relative) || relative.Length > 800 || relative.Contains('\\') || relative.Contains(':')
            || relative.StartsWith('/') || relative.Split('/').Any(part => part is "" or "." or ".."
                || part.EndsWith('.') || part.EndsWith(' ') || part.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0
                || Regex.IsMatch(part, @"^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)", RegexOptions.IgnoreCase)))
            throw new IOException("更新包包含无效路径");
        if (relative.Split('/').Any(part => part.StartsWith(".smorec-", StringComparison.OrdinalIgnoreCase)))
            throw new IOException("更新包包含保留路径");
        var result = Path.GetFullPath(Path.Combine(root, relative.Replace('/', '\\')));
        if (!Inside(root, result)) throw new IOException("更新路径越界");
        NoLinks(result);
        return result;
    }
    internal static void NoLinks(string file)
    {
        for (var current = Path.GetFullPath(file); !string.IsNullOrEmpty(current); current = Path.GetDirectoryName(current))
        {
            try
            {
                if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                    throw new IOException("更新路径不能包含链接或目录联接");
            }
            catch (FileNotFoundException) { }
            catch (DirectoryNotFoundException) { }
        }
    }
    internal static string Digest(string file)
    {
        NoLinks(file);
        using var stream = File.OpenRead(file);
        return Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
    }
    internal static void Validate(UpdatePlan plan)
    {
        var session = Root(plan.Session);
        var target = Root(plan.Target);
        if (!string.Equals(Root(plan.Staged), Path.Combine(session, "staged"), StringComparison.OrdinalIgnoreCase)
            || !Inside(session, Path.GetFullPath(plan.Package)) || Inside(target, session) || Inside(session, target)
            || target.Equals(session, StringComparison.OrdinalIgnoreCase)
            || !Regex.IsMatch(plan.Version, @"^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$")
            || !Regex.IsMatch(plan.Sha256, "^[a-f0-9]{64}$") || plan.Size <= 0 || plan.Size > 2L * 1024 * 1024 * 1024)
            throw new IOException("更新计划无效");
        NoLinks(plan.Package);
    }
}
