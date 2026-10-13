!ifndef SMOREC_VIRTUAL_CAMERA_UNINSTALL_INCLUDED
!define SMOREC_VIRTUAL_CAMERA_UNINSTALL_INCLUDED

; electron-builder 26.15.3 calls customUnInstall before deleting any installed file.
; Its old-version removal passes --updated; preserve camera registration on that path.
!macro customUnInstall
  ${IfNot} ${isUpdated}
    Push $R0
    Push $R1
    ${If} ${FileExists} "$INSTDIR\resources\virtual-camera\XiaoLu.CameraBridge.exe"
      nsExec::ExecToStack /TIMEOUT=180000 '"$INSTDIR\resources\virtual-camera\XiaoLu.CameraBridge.exe" uninstall-if-owned --elevate'
      Pop $R0
      Pop $R1
    ${Else}
      ; Old installations without a camera have nothing to unregister. If setup
      ; is damaged but this DLL is still registered, abort before deleting it.
      ReadRegStr $R1 HKLM "Software\Classes\CLSID\{7D90FA14-1584-4E97-9437-0C9DE4E752CB}\InprocServer32" ""
      StrCpy $R0 0
      ${If} ${FileExists} "$INSTDIR\resources\virtual-camera\XiaoLu.VirtualCamera.dll"
        ; A remaining DLL without its helper is a damaged component, so keep it.
        StrCpy $R0 1
      ${ElseIf} $R1 == "$INSTDIR\resources\virtual-camera\XiaoLu.VirtualCamera.dll"
        StrCpy $R0 1
      ${EndIf}
    ${EndIf}
    ${If} $R0 != 0
      DetailPrint "Virtual camera removal did not finish. Application files were preserved."
      ${IfNot} ${Silent}
        MessageBox MB_OK|MB_ICONSTOP "虚拟摄像头尚未卸载，小录文件已保留。请完成系统授权后重试；若组件缺失，请先修复安装。"
      ${EndIf}
      Pop $R1
      Pop $R0
      SetErrorLevel 1
      Abort
    ${EndIf}
    Pop $R1
    Pop $R0
  ${EndIf}
!macroend
!endif
