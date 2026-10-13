!ifndef SMOREC_INSTALLATION_RECEIPT_INCLUDED
!define SMOREC_INSTALLATION_RECEIPT_INCLUDED

; Receipt is best effort and local only. It is not a device identity or an analytics request.
; electron-builder 26.15.3 invokes customInstall after application files/install info/links.
!macro SmoRecWriteInstallationReceipt
  Push $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  Push $R5
  Push $R6
  StrCpy $R5 0
  IfErrors 0 +2
    StrCpy $R5 1
  ${If} $R5 == 0
  ${AndIf} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    ; Pointer allocation avoids relying on GUID-specific parameter marshalling.
    StrCpy $R2 ""
    System::Alloc 16
    Pop $R0
    ${If} $R0 != 0
      System::Call 'ole32::CoCreateGuid(p R0) i .R1'
      ${If} $R1 == 0
        System::Call 'ole32::StringFromGUID2(p R0, w .R2, i 39) i .R1'
        ${If} $R1 != 39
          StrCpy $R2 ""
        ${EndIf}
      ${EndIf}
      System::Free $R0
    ${EndIf}
    StrLen $R1 $R2
    ${If} $R1 == 38
      StrCpy $R2 $R2 36 1
      ClearErrors
      FileOpen $R0 "$INSTDIR\installation-receipt.json.tmp" w
      ${IfNot} ${Errors}
        FileWrite $R0 '{"schema":1,"version":"'
        ; Package versions are ASCII semver; escape JSON syntax defensively.
        StrCpy $R1 "${VERSION}"
        StrCpy $R3 0
        ${Do}
          StrCpy $R4 $R1 1 $R3
          ${If} $R4 == ""
            ${ExitDo}
          ${EndIf}
          ${If} $R4 == '\'
            FileWrite $R0 '\\'
          ${ElseIf} $R4 == '"'
            FileWrite $R0 '\"'
          ${ElseIf} $R4 == '$\r'
            FileWrite $R0 '\r'
          ${ElseIf} $R4 == '$\n'
            FileWrite $R0 '\n'
          ${ElseIf} $R4 == '$\t'
            FileWrite $R0 '\t'
          ${Else}
            FileWrite $R0 $R4
          ${EndIf}
          IntOp $R3 $R3 + 1
        ${Loop}
        FileWrite $R0 '","event_id":"$R2"}$\r$\n'
        StrCpy $R6 0
        IfErrors 0 +2
          StrCpy $R6 1
        FileClose $R0
        IfErrors 0 +2
          StrCpy $R6 1
        ${If} $R6 == 0
          ; Same-directory replace: readers see a complete old or complete new JSON file.
          System::Call 'kernel32::MoveFileExW(w "$INSTDIR\installation-receipt.json.tmp", w "$INSTDIR\installation-receipt.json", i 9) i .R0'
          ${If} $R0 == 0
            Delete "$INSTDIR\installation-receipt.json.tmp"
          ${EndIf}
        ${Else}
          Delete "$INSTDIR\installation-receipt.json.tmp"
        ${EndIf}
      ${EndIf}
    ${EndIf}
  ${EndIf}
  ${If} $R5 == 0
    ClearErrors
  ${Else}
    SetErrors
  ${EndIf}
  Pop $R6
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
!macroend

!macro customInstall
  !insertmacro SmoRecWriteInstallationReceipt
!macroend
!endif
