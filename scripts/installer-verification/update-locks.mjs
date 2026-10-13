import { promises as fs } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

export async function verifyUpdateLocks({out,atomic,compiler,runner}) {
  const directory=path.join(out,'locked-install');await fs.mkdir(directory);
  const marker=path.join(directory,'a-marker.txt'),locked=path.join(directory,'z-locked.txt');
  await fs.writeFile(marker,'preserved-before-lock');await fs.writeFile(locked,'exclusive-sharing-lock');
  const holderFile=path.join(out,'hold-file.ps1');
  await fs.writeFile(holderFile,`param([string]$File)
$stream=[IO.File]::Open($File,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None)
[Console]::WriteLine('ready')
try{[Console]::ReadLine()|Out-Null}finally{$stream.Dispose()}
`);
  const holder=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',holderFile,locked],
    {windowsHide:true,stdio:['pipe','pipe','pipe']});
  try {
    await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(new Error('Lock holder timeout')),10000);
      holder.stdout.on('data',data=>{text+=data;if(text.includes('ready')){clearTimeout(timer);resolve();}});holder.once('error',reject);});
    const executable=path.join(out,'rollback-test.exe'),source=path.join(out,'rollback-test.nsi');
    const q=value=>'"'+value.replaceAll('$','$$')+'"';
    await fs.writeFile(source,`\uFEFFUnicode true
RequestExecutionLevel user
SilentInstall silent
OutFile ${q(executable)}
!include LogicLib.nsh
!define UNINSTALL_FILENAME "fixture-uninstaller.exe"
${atomic}
Section
InitPluginsDir
StrCpy $INSTDIR ${q(directory)}
CreateDirectory "$PLUGINSDIR\\old-install"
Push ""
Call atomicRMDir
Pop $R0
\${If} $R0 == 0
  SetErrorLevel 99
  Quit
\${EndIf}
Push ""
Call restoreFiles
Pop $R0
SetErrorLevel 21
SectionEnd
`,'utf8');
    const compiled=await runner.runCompiler(compiler.path,['/V2','/INPUTCHARSET','UTF8',source],compiler.env);
    assert.equal(compiled.code,0,compiled.stdout+compiled.stderr);
    const result=await runner.runExecutable(executable,['/S']);assert.equal(result.code,21);
    assert.equal(await fs.readFile(marker,'utf8'),'preserved-before-lock');
    assert.equal(holder.exitCode,null,'Installer must not kill the locking application');
  }finally{holder.stdin.end('done\n');await new Promise(resolve=>holder.once('close',resolve));}
  assert.equal(await fs.readFile(locked,'utf8'),'exclusive-sharing-lock');
  return {exclusiveLockRolledBack:true,originalFilesPreserved:true,consumerNotTerminated:true};
}
