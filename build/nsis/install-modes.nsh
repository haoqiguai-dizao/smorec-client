; Adapted from electron-builder's multiUser.nsh (MIT); the build guard compares both
; complete macro bodies against the locked upstream, allowing only the marked call.
; Loaded after multiUser.nsh and before any installer mode macro is expanded.
; Copyright (c) 2015 Loopline Systems
; Permission is hereby granted, free of charge, to any person obtaining a copy
; of this software and associated documentation files (the "Software"), to deal
; in the Software without restriction, including without limitation the rights
; to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
; copies of the Software, and to permit persons to whom the Software is
; furnished to do so, subject to the following conditions:
; The above copyright notice and this permission notice shall be included in all
; copies or substantial portions of the Software.
; THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
; IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
; FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
; AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
; LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
; OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
; SOFTWARE.
!macro SmoRecApplyPreferredDefault
  Push $R0
  ; Fresh current-user installs keep Windows' writable UserProgramFiles directory.
  ; Existing paths and explicit /D remain in the upstream branches below.
  ${If} $installMode != "CurrentUser"
    !insertmacro SmoRecGetPreferredInstallDirectory $R0
    ${If} $R0 != ""
      StrCpy $INSTDIR $R0
    ${EndIf}
  ${EndIf}
  Pop $R0
!macroend

!ifndef INSTALL_MODE_PER_ALL_USERS
  !macroundef setInstallModePerUser
  !macro setInstallModePerUser
    StrCpy $installMode CurrentUser
    SetShellVarContext current

    # сhecks registry for previous installation path
    ReadRegStr $perUserInstallationFolder HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${if} $perUserInstallationFolder != ""
      StrCpy $INSTDIR $perUserInstallationFolder
    ${else}
      StrCpy $0 "$LocalAppData\Programs"

      Push $1
      Push $2
      # UserProgramFiles is the per-user install root and can be a non-default location
      StrCpy $2 0
      System::Call 'SHELL32::SHGetKnownFolderPath(g "${FOLDERID_UserProgramFiles}", i ${KF_FLAG_CREATE}, p 0, *p .r2)i.r1'
      ${If} $1 == 0
        System::Call 'KERNEL32::lstrcpynW(w .r0, p r2, i ${NSIS_MAX_STRLEN})p'
      ${endif}
      # SHGetKnownFolderPath may return allocated memory even on failure
      ${If} $2 != 0
        System::Call 'OLE32::CoTaskMemFree(p r2)'
      ${endif}
      Pop $2
      Pop $1

      StrCpy $INSTDIR "$0\${APP_FILENAME}"
      !insertmacro SmoRecApplyPreferredDefault
    ${endif}

    # allow /D switch to override installation path https://github.com/electron-userland/electron-builder/issues/1551
    !insertmacro GetDParameter $R0
    ${If} $R0 != ""
      StrCpy $INSTDIR $R0
    ${endif}

  !macroend
!endif

!ifdef INSTALL_MODE_PER_ALL_USERS_REQUIRED
  !macroundef setInstallModePerAllUsers
  !macro setInstallModePerAllUsers
    StrCpy $installMode all
    SetShellVarContext all

    !ifdef BUILD_UNINSTALLER
      ${IfNot} ${UAC_IsAdmin}
        ShowWindow $HWNDPARENT ${SW_HIDE}
        !insertmacro UAC_RunElevated
        Quit
      ${endif}
    !endif

    # сheck registry for previous installation path
    ReadRegStr $perMachineInstallationFolder HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${if} $perMachineInstallationFolder != ""
      StrCpy $INSTDIR $perMachineInstallationFolder
    ${else}
      StrCpy $0 "$PROGRAMFILES"
      !ifdef APP_64
        ${if} ${RunningX64}
          StrCpy $0 "$PROGRAMFILES64"
        ${endif}
      !endif

      !ifdef MENU_FILENAME
        StrCpy $0 "$0\${MENU_FILENAME}"
      !endif

      StrCpy $INSTDIR "$0\${APP_FILENAME}"
      !insertmacro SmoRecApplyPreferredDefault
    ${endif}

    # allow /D switch to override installation path https://github.com/electron-userland/electron-builder/issues/1551
    !insertmacro GetDParameter $R0
    ${If} $R0 != ""
      StrCpy $INSTDIR $R0
    ${endif}

  !macroend
!endif
