!ifndef SMOREC_INSTALL_DIRECTORY_INCLUDED
!define SMOREC_INSTALL_DIRECTORY_INCLUDED
!define SMOREC_INSTALL_DIRECTORY "小录"

!include LogicLib.nsh
!include FileFunc.nsh

; Compare normalized Windows paths without changing an existing or explicit destination.
!macro SmoRecCanonicalDirectory INPUT OUTPUT
  StrCpy ${OUTPUT} "${INPUT}"
  ; NSIS strips the slash from a drive-root $INSTDIR; restore absolute semantics.
  StrLen $R6 ${OUTPUT}
  StrCpy $R5 ${OUTPUT} 1 -1
  ${If} $R6 == 2
  ${AndIf} $R5 == ":"
    StrCpy ${OUTPUT} "${OUTPUT}\"
  ${EndIf}
  ; NSIS GetFullPathName requires existing directories. Win32 also handles new ones.
  ; Pass a register, so a long path cannot truncate the System::Call descriptor.
  StrCpy $8 ${OUTPUT}
  StrCpy $6 0
  StrCpy $7 ""
  System::Call 'kernel32::GetFullPathNameW(w r8, i ${NSIS_MAX_STRLEN}, w .r7, p 0)i.r6'
  ${If} $6 == 0
  ${OrIf} $6 >= ${NSIS_MAX_STRLEN}
    SetErrors
  ${Else}
    StrCpy ${OUTPUT} $7
  ${EndIf}
  ${Do}
    StrLen $R6 ${OUTPUT}
    StrCpy $R5 ${OUTPUT} 1 -1
    ${If} $R6 <= 3
    ${OrIf} $R5 != "\"
      ${Break}
    ${EndIf}
    StrCpy ${OUTPUT} ${OUTPUT} -1
  ${Loop}
!macroend

; TARGET is $INSTDIR; PREVIOUS and EXPLICIT may be empty or use $R0/$R1.
; Existing InstallLocation and an unchanged /D= destination remain exact.
!macro SmoRecNormalizeInstallDirectory TARGET PREVIOUS EXPLICIT
  Push $R2
  Push $R3
  Push $R4
  Push $R5
  Push $R6
  Push $6
  Push $7
  Push $8
  ClearErrors
  !insertmacro SmoRecCanonicalDirectory "${TARGET}" $R2
  StrCpy $R3 ""
  StrCpy $R4 ""
  ${If} "${PREVIOUS}" != ""
    !insertmacro SmoRecCanonicalDirectory "${PREVIOUS}" $R3
  ${EndIf}
  ${If} "${EXPLICIT}" != ""
    !insertmacro SmoRecCanonicalDirectory "${EXPLICIT}" $R4
  ${EndIf}
  ${IfNot} ${Errors}
    ${If} $R2 != $R3
    ${AndIf} $R2 != $R4
      ${GetFileName} "$R2" $R5
      ${If} $R5 != "${SMOREC_INSTALL_DIRECTORY}"
        ; Strip the root slash only while joining; the destination remains absolute.
        StrCpy $R5 $R2 1 -1
        ${If} $R5 == "\"
          StrCpy $R2 $R2 -1
        ${EndIf}
        StrLen $R6 $R2
        StrLen $R5 "${SMOREC_INSTALL_DIRECTORY}"
        IntOp $R6 $R6 + $R5
        IntOp $R6 $R6 + 1
        ${If} $R6 >= ${NSIS_MAX_STRLEN}
          SetErrors
        ${Else}
          StrCpy ${TARGET} "$R2\${SMOREC_INSTALL_DIRECTORY}"
        ${EndIf}
      ${EndIf}
    ${EndIf}
  ${EndIf}
  Pop $8
  Pop $7
  Pop $6
  Pop $R6
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
!macroend
!endif
