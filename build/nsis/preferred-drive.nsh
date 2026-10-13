!ifndef SMOREC_PREFERRED_DRIVE_INCLUDED
!define SMOREC_PREFERRED_DRIVE_INCLUDED
!ifndef SMOREC_INSTALL_DIRECTORY
  !error "Include install-directory.nsh before preferred-drive.nsh."
!endif

!include LogicLib.nsh

; Pure filter: fixed, available, writable volume, excluding the Windows drive.
; OUTPUT must be $R0, a numbered register, or a dedicated Var (not $R2/$R3).
!macro SmoRecDriveIsEligible OUTPUT SYSTEM_DRIVE DRIVE DRIVE_TYPE VOLUME_OK VOLUME_FLAGS
  Push $R2
  Push $R3
  StrCpy $R2 "${SYSTEM_DRIVE}" 1
  StrCpy $R3 "${DRIVE}" 1
  StrCpy ${OUTPUT} 0
  ${If} $R2 != $R3
  ${AndIf} "${DRIVE_TYPE}" == 3
  ${AndIf} "${VOLUME_OK}" != 0
    IntOp $R2 "${VOLUME_FLAGS}" & 0x00080000
    ${If} $R2 == 0
      StrCpy ${OUTPUT} 1
    ${EndIf}
  ${EndIf}
  Pop $R3
  Pop $R2
!macroend

; Pure selection: prefer D, then the first eligible letter in alphabetical order.
; SYSTEM_DRIVE accepts a letter or drive root; ELIGIBLE_DRIVES is a letter string.
; OUTPUT must be $R0 or a dedicated Var; empty means retain the upstream default.
!macro SmoRecSelectPreferredInstallDirectory OUTPUT SYSTEM_DRIVE ELIGIBLE_DRIVES
  Push $R2
  Push $R3
  Push $R4
  Push $R5
  Push $R6
  Push $R7
  Push $R8
  StrCpy $R2 "${SYSTEM_DRIVE}" 1
  StrCpy $R3 "${ELIGIBLE_DRIVES}"
  StrCpy $R4 "DABCEFGHIJKLMNOPQRSTUVWXYZ"
  StrCpy $R5 0
  StrCpy ${OUTPUT} ""
  ${Do}
    StrCpy $R6 $R4 1 $R5
    ${If} $R6 == ""
      ${Break}
    ${EndIf}
    ${If} $R6 != $R2
      StrCpy $R7 0
      ${Do}
        StrCpy $R8 $R3 1 $R7
        ${If} $R8 == ""
          ${Break}
        ${EndIf}
        ${If} $R6 == $R8
          StrCpy ${OUTPUT} "$R6:\Program Files\${SMOREC_INSTALL_DIRECTORY}"
          ${Break}
        ${EndIf}
        IntOp $R7 $R7 + 1
      ${Loop}
    ${EndIf}
    ${If} ${OUTPUT} != ""
      ${Break}
    ${EndIf}
    IntOp $R5 $R5 + 1
  ${Loop}
  Pop $R8
  Pop $R7
  Pop $R6
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
!macroend

; Read-only Win32 probe. Never creates a directory or tests writability by writing.
; OUTPUT must be $R0 or a dedicated Var. All other registers and the stack survive.
!macro SmoRecGetPreferredInstallDirectory OUTPUT
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  Push $R5
  Push $R6
  Push $R7
  Push $R8
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $8
  Push $9
  StrCpy $R1 $WINDIR 1
  StrCpy $R2 "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
  StrCpy $R3 ""
  StrCpy $R4 0
  ; Suppress removable/offline-volume dialogs on this thread, then restore its mode.
  StrCpy $8 0
  StrCpy $9 0
  System::Call 'kernel32::SetThreadErrorMode(i 0x8001, *i.r8)i.r9'
  System::Call 'kernel32::GetLogicalDrives()i.r0'
  ${Do}
    StrCpy $R6 $R2 1 $R4
    ${If} $R6 == ""
      ${Break}
    ${EndIf}
    IntOp $R7 $0 & 1
    ${If} $R7 != 0
      StrCpy $4 "$R6:\"
      System::Call 'kernel32::GetDriveTypeW(w r4)i.r1'
      ${If} $1 == 3
        StrCpy $2 0
        StrCpy $3 0
        System::Call 'kernel32::GetVolumeInformationW(w r4, p 0, i 0, p 0, p 0, *i.r2, p 0, i 0)i.r3'
        !insertmacro SmoRecDriveIsEligible $5 $R1 $R6 $1 $3 $2
        ${If} $5 == 1
          StrCpy $R3 "$R3$R6"
        ${EndIf}
      ${EndIf}
    ${EndIf}
    IntOp $0 $0 >> 1
    IntOp $R4 $R4 + 1
  ${Loop}
  ${If} $9 != 0
    System::Call 'kernel32::SetThreadErrorMode(i r8, p 0)'
  ${EndIf}
  !insertmacro SmoRecSelectPreferredInstallDirectory ${OUTPUT} $R1 $R3
  Pop $9
  Pop $8
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
  Pop $R8
  Pop $R7
  Pop $R6
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
!macroend
!endif
