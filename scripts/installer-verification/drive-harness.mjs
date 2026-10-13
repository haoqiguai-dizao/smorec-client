import { nsisString, preservedRegisters } from './nsis-harness.mjs';

const tab = '$\\t', newline = '$\\r$\\n';
function writeFields(fields) {
  return fields.flatMap((field, index) => [
    `FileWriteUTF16LE $SmoRecDriveReport "${field}"`,
    `FileWriteUTF16LE $SmoRecDriveReport "${index === fields.length - 1 ? newline : tab}"`,
  ]);
}
const seedRegisters = () => preservedRegisters.map((register, index) => `StrCpy ${register} "preserved-${index}"`);
export const driveDeclarations = [
  'Var SmoRecDriveReport', 'Var SmoRecDriveResult', 'Var SmoRecDriveEligible',
  'Var SmoRecDriveFlag', 'Var SmoRecDriveStack', 'Var SmoRecDriveFallback', 'Var installMode',
];

export function makeDriveChecks(cases) {
  const lines = ['FileOpen $SmoRecDriveReport "$EXEDIR\\drives.tsv" w'];
  for (const item of cases) {
    lines.push('StrCpy $SmoRecDriveEligible ""');
    for (const drive of item.drives) {
      lines.push(
        `!insertmacro SmoRecDriveIsEligible $SmoRecDriveFlag ${nsisString(item.system)} ${nsisString(drive.letter)} ${drive.type} ${drive.available} ${drive.flags}`,
        '${If} $SmoRecDriveFlag == 1',
        `StrCpy $R0 ${nsisString(drive.letter)}`,
        'StrCpy $SmoRecDriveEligible "$SmoRecDriveEligible$R0"',
        '${EndIf}',
      );
    }
    lines.push(
      ...seedRegisters(),
      'Push "preserved-stack"',
      `!insertmacro SmoRecSelectPreferredInstallDirectory $SmoRecDriveResult ${nsisString(item.system)} $SmoRecDriveEligible`,
      'Pop $SmoRecDriveStack',
      ...writeFields([item.name, '$SmoRecDriveResult', '$SmoRecDriveEligible', '$SmoRecDriveStack', ...preservedRegisters]),
    );
  }
  lines.push(
    ...seedRegisters(),
    'Push "preserved-stack"',
    '!insertmacro SmoRecGetPreferredInstallDirectory $SmoRecDriveResult',
    'Pop $SmoRecDriveStack',
    ...writeFields(['live-registers', '$SmoRecDriveResult', '$WINDIR', '$SmoRecDriveStack', ...preservedRegisters]),
    'StrCpy $1 0', 'StrCpy $2 0', 'StrCpy $3 0',
    '${If} $SmoRecDriveResult != ""',
    'StrCpy $4 $SmoRecDriveResult 3',
    'System::Call \'kernel32::GetDriveTypeW(w r4)i.r1\'',
    'System::Call \'kernel32::GetVolumeInformationW(w r4, p 0, i 0, p 0, p 0, *i.r2, p 0, i 0)i.r3\'',
    '${EndIf}',
    'StrCpy $4 "D:\\"', 'StrCpy $6 0', 'StrCpy $7 0',
    'System::Call \'kernel32::GetDriveTypeW(w r4)i.r5\'',
    '${If} $5 == 3',
    'System::Call \'kernel32::GetVolumeInformationW(w r4, p 0, i 0, p 0, p 0, *i.r6, p 0, i 0)i.r7\'',
    '${EndIf}',
    ...writeFields(['live-volume', '$SmoRecDriveResult', '$WINDIR', '$1', '$3', '$2', '$5', '$7', '$6']),
    'StrCpy $INSTDIR "$LOCALAPPDATA\\Programs\\小录"',
    'StrCpy $SmoRecDriveFallback $INSTDIR',
    'StrCpy $installMode "all"',
    ...seedRegisters(),
    'Push "preserved-stack"',
    '!insertmacro SmoRecApplyPreferredDefault',
    'Pop $SmoRecDriveStack',
    ...writeFields(['live-default-integration', '$INSTDIR', '$SmoRecDriveFallback', '$SmoRecDriveStack', ...preservedRegisters]),
    'StrCpy $installMode "CurrentUser"',
    'StrCpy $INSTDIR $SmoRecDriveFallback',
    '!insertmacro SmoRecApplyPreferredDefault',
    ...writeFields(['current-user-default', '$INSTDIR', '$SmoRecDriveFallback']),
    'FileClose $SmoRecDriveReport',
  );
  return lines;
}
