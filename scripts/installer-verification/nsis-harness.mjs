export const preservedRegisters = [
  ...Array.from({ length: 10 }, (_, index) => `$${index}`),
  ...Array.from({ length: 10 }, (_, index) => `$R${index}`),
];

export function nsisString(value) {
  return `"${value.replaceAll('$', () => '$$').replaceAll('"', '$\\"')}"`;
}

export function makeHarness({ include, executable, cases, driveInclude, driveDeclarations = [], driveChecks = [] }) {
  const lines = [
    'Unicode true',
    'RequestExecutionLevel user',
    'SilentInstall silent',
    'AutoCloseWindow true',
    'Name "SmoRec install-directory verification"',
    `OutFile ${nsisString(executable)}`,
    '!include "LogicLib.nsh"',
    '!include "FileFunc.nsh"',
    `!include ${nsisString(include)}`,
    ...(driveInclude ? [`!include ${nsisString(driveInclude)}`] : []),
    '!if "${SMOREC_INSTALL_DIRECTORY}" != "小录"',
    '!error "Installation directory branding regressed."',
    '!endif',
    'Var SmoRecVerificationPrevious',
    'Var SmoRecVerificationExplicit',
    'Var SmoRecVerificationReport',
    'Var SmoRecVerificationStack',
    'Var SmoRecVerificationOriginal',
    'Var SmoRecVerificationError',
    ...driveDeclarations,
    'Section',
    'FileOpen $SmoRecVerificationReport "$EXEDIR\\actual.tsv" w',
  ];
  for (const item of cases) {
    const tab = '$\\t', newline = '$\\r$\\n';
    const fields = [item.name, '$INSTDIR', '$SmoRecVerificationPrevious', '$SmoRecVerificationExplicit', '$SmoRecVerificationStack', '$SmoRecVerificationError', '$SmoRecVerificationOriginal', '${NSIS_MAX_STRLEN}', ...preservedRegisters];
    lines.push(
      ...(item.appendOverflow ? [
        'StrCpy $R0 "x"',
        'IntOp $R2 ${NSIS_MAX_STRLEN} - 5',
        '${Do}',
        'StrCpy $R0 "a\\$R0"',
        'StrLen $R1 $R0',
        '${LoopUntil} $R1 >= $R2',
        'StrCpy $INSTDIR "D:\\$R0"',
      ] : [`StrCpy $INSTDIR ${nsisString(item.target)}`]),
      'StrCpy $SmoRecVerificationOriginal $INSTDIR',
      `StrCpy $SmoRecVerificationPrevious ${nsisString(item.previous ?? '')}`,
      `StrCpy $SmoRecVerificationExplicit ${nsisString(item.explicit ?? '')}`,
      ...preservedRegisters.map((register, index) => `StrCpy ${register} "preserved-${index}"`),
      ...(item.registerArguments ? [
        'StrCpy $R0 $SmoRecVerificationPrevious',
        'StrCpy $R1 $SmoRecVerificationExplicit',
      ] : []),
      'Push "preserved-stack"',
      item.registerArguments
        ? '!insertmacro SmoRecNormalizeInstallDirectory $INSTDIR $R0 $R1'
        : '!insertmacro SmoRecNormalizeInstallDirectory $INSTDIR $SmoRecVerificationPrevious $SmoRecVerificationExplicit',
      'StrCpy $SmoRecVerificationError "false"',
      '${If} ${Errors}',
      'StrCpy $SmoRecVerificationError "true"',
      '${EndIf}',
      'Pop $SmoRecVerificationStack',
      // Write fields separately so the overflow-case evidence itself cannot truncate.
      ...fields.flatMap((field, index) => [
        `FileWriteUTF16LE $SmoRecVerificationReport "${field}"`,
        `FileWriteUTF16LE $SmoRecVerificationReport "${index === fields.length - 1 ? newline : tab}"`,
      ]),
    );
  }
  lines.push('FileClose $SmoRecVerificationReport', ...driveChecks, 'SetErrorLevel 0', 'SectionEnd');
  return `${lines.join('\r\n')}\r\n`;
}
