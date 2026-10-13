import { execFile } from 'node:child_process';
import path from 'node:path';

export type WindowsDirectoryPermission = 'writable' | 'elevation-required' | 'unknown';
export type WindowsEnvironment = {
  status: 'checked'; permission: WindowsDirectoryPermission; processIds: number[];
} | { status: 'unknown' };

// Restart Manager is used only to enumerate resource owners. Never request shutdown/restart.
const probeSource = `
using System;
using System.Text;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class XiaoLuUpdateProbe {
  [StructLayout(LayoutKind.Sequential)] struct UniqueProcess {
    public uint ProcessId;
    public System.Runtime.InteropServices.ComTypes.FILETIME Started;
  }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct ProcessInfo {
    public UniqueProcess Process;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string AppName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string Service;
    public int Type;
    public uint Status;
    public uint SessionId;
    [MarshalAs(UnmanagedType.Bool)] public bool Restartable;
  }
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern SafeFileHandle CreateFile(string name, uint access, uint share,
    IntPtr security, uint disposition, uint flags, IntPtr template);
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
  static extern int RmStartSession(out uint session, int flags, StringBuilder key);
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
  static extern int RmRegisterResources(uint session, uint count, string[] files,
    uint appCount, IntPtr apps, uint serviceCount, IntPtr services);
  [DllImport("rstrtmgr.dll")]
  static extern int RmGetList(uint session, out uint needed, ref uint count,
    [In, Out] ProcessInfo[] processes, ref uint rebootReasons);
  [DllImport("rstrtmgr.dll")] static extern int RmEndSession(uint session);

  public static string Permission(string directory) {
    // OPEN_EXISTING + BACKUP_SEMANTICS only opens a directory handle; no files are changed.
    using (var handle = CreateFile(directory, 0x10146, 7, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero)) {
      if (!handle.IsInvalid) return "writable";
      return Marshal.GetLastWin32Error() == 5 ? "elevation-required" : "unknown";
    }
  }
  public static uint[] Owners(string[] files) {
    if (files.Length == 0) return new uint[0];
    uint session;
    int result = RmStartSession(out session, 0, new StringBuilder(33));
    if (result != 0) throw new InvalidOperationException("Session unavailable");
    try {
      result = RmRegisterResources(session, (uint)files.Length, files, 0, IntPtr.Zero, 0, IntPtr.Zero);
      if (result != 0) throw new InvalidOperationException("Resources unavailable");
      uint needed = 0, count = 0, reasons = 0;
      result = RmGetList(session, out needed, ref count, null, ref reasons);
      for (int attempt = 0; result == 234 && attempt < 3; attempt++) {
        if (needed == 0 || needed > 512) throw new InvalidOperationException("Owner limit");
        var owners = new ProcessInfo[needed];
        count = needed;
        result = RmGetList(session, out needed, ref count, owners, ref reasons);
        if (result == 0) {
          var ids = new uint[count];
          for (int i = 0; i < count; i++) ids[i] = owners[i].Process.ProcessId;
          return ids;
        }
      }
      if (result != 0) throw new InvalidOperationException("Owners unavailable");
      return new uint[0];
    } finally {
      if (RmEndSession(session) != 0) throw new InvalidOperationException("Session cleanup failed");
    }
  }
}
`;

/** Data is encoded separately from PowerShell syntax, including paths containing quotes/$/backticks. */
export function windowsProbeScript(installDirectory: string, files: readonly string[]): string {
  const payload = Buffer.from(JSON.stringify({ installDirectory, files }), 'utf8').toString('base64');
  return `$ErrorActionPreference = 'Stop'
try {
  Add-Type -TypeDefinition @'
${probeSource}
'@
  $config = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
  $permission = [XiaoLuUpdateProbe]::Permission([string]$config.installDirectory)
  $ids = @([XiaoLuUpdateProbe]::Owners([string[]]$config.files))
  @{ status = 'checked'; permission = $permission; processIds = @($ids) } | ConvertTo-Json -Compress
} catch { '{"status":"unknown"}' }
`;
}

export function parseWindowsEnvironment(stdout: string): WindowsEnvironment {
  try {
    const value = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
    if (value?.status !== 'checked'
      || !['writable', 'elevation-required', 'unknown'].includes(value.permission)
      || !Array.isArray(value.processIds) || value.processIds.length > 512
      || value.processIds.some((id: unknown) => !Number.isSafeInteger(id)
        || (id as number) <= 0 || (id as number) > 0xffffffff)) return { status: 'unknown' };
    return { status: 'checked', permission: value.permission,
      processIds: [...new Set<number>(value.processIds)] };
  } catch { return { status: 'unknown' }; }
}

export async function inspectWindowsEnvironment(
  installDirectory: string, files: readonly string[],
): Promise<WindowsEnvironment> {
  const systemRoot = process.env.SystemRoot;
  if (process.platform !== 'win32' || !systemRoot || !/^[a-z]:\\/i.test(systemRoot)) {
    return { status: 'unknown' };
  }
  const executable = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = Buffer.from(windowsProbeScript(installDirectory, files), 'utf16le').toString('base64');
  return new Promise(resolve => {
    execFile(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', script],
      { windowsHide: true, timeout: 12_000, maxBuffer: 64 * 1024, encoding: 'utf8', cwd: systemRoot },
      (error, stdout) => resolve(error ? { status: 'unknown' } : parseWindowsEnvironment(stdout)));
  });
}
