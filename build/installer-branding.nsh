!include "${BUILD_RESOURCES_DIR}\nsis\installation-receipt.nsh"
!include "${BUILD_RESOURCES_DIR}\nsis\virtual-camera-uninstall.nsh"
!include "${BUILD_RESOURCES_DIR}\nsis\install-directory.nsh"
!include "${BUILD_RESOURCES_DIR}\nsis\preferred-drive.nsh"

; Keep application identity and user data stable; only the install folder is branded.
!if "${PRODUCT_NAME}" != "${SMOREC_INSTALL_DIRECTORY}"
  !error "SmoRec installer product name must be 小录."
!endif
!if "${PRODUCT_FILENAME}" != "${SMOREC_INSTALL_DIRECTORY}"
  !error "SmoRec installer executable name must be 小录."
!endif
!if "${APP_PACKAGE_NAME}" != "frameflow-studio"
  !error "Do not change the existing SmoRec package identity."
!endif
!if "${APP_ID}" != "studio.frameflow.desktop"
  !error "Do not change the existing SmoRec installer identity."
!endif
!ifndef allowToChangeInstallationDirectory
  !error "SmoRec requires the assisted directory page."
!endif
!ifdef ONE_CLICK
  !error "SmoRec requires assisted installation."
!endif

; electron-builder falls back to the package name for non-ASCII product names.
!undef APP_FILENAME
!define APP_FILENAME "${SMOREC_INSTALL_DIRECTORY}"

; This extension runs after upstream mode macros are declared and before use.
; Apply the preference in their fresh-install branch, including silent all-users.
!macro customWelcomePage
  !include "${BUILD_RESOURCES_DIR}\nsis\install-modes.nsh"
!macroend

!macro customInstallMode
  !ifndef BUILD_UNINSTALLER
    ; New installs belong to the current user; preserve existing all-user upgrades.
    ${If} $hasPerUserInstallation != "1"
    ${AndIf} $hasPerMachineInstallation != "1"
      StrCpy $isForceCurrentInstall "1"
    ${EndIf}
  !endif
!macroend

!macro customPageAfterChangeDir
  ; Fail closed if an upstream template upgrade changes this callback contract.
  !if "${MUI_PAGE_CUSTOMFUNCTION_PRE}" != "instFilesPre"
    !error "Review the updated NSIS directory-page callback before packaging."
  !endif
  !undef MUI_PAGE_CUSTOMFUNCTION_PRE
  !define MUI_PAGE_CUSTOMFUNCTION_PRE smorecInstFilesPre

  Function smorecInstFilesPre
    Push $R0
    Push $R1
    ReadRegStr $R0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
    !insertmacro GetDParameter $R1
    !insertmacro SmoRecNormalizeInstallDirectory $INSTDIR $R0 $R1
    ${If} ${Errors}
      Pop $R1
      Pop $R0
      MessageBox MB_OK|MB_ICONEXCLAMATION "无法解析安装路径，请重新选择有效的目录。"
      Abort
    ${EndIf}
    ; Upstream's substring check is safe only after the final leaf is canonical.
    ; Keep this reference so its now-replaced callback isn't an unused function.
    ${GetFileName} "$INSTDIR" $R0
    ${If} $R0 == "${SMOREC_INSTALL_DIRECTORY}"
      Call instFilesPre
    ${EndIf}
    Pop $R1
    Pop $R0
  FunctionEnd
!macroend
