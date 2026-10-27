; Native preflight for both the small web bootstrapper and the optional full installer.
!include "callme-web-installer-vc.nsh"
!include nsDialogs.nsh

LangString CallMeWebIntro 1033 "Before installing, LazyCall downloads its application package."
LangString CallMeWebDetails 1033 "Download: ${CALLME_PACKAGE_MIB} MB. Installed size: about ${CALLME_INSTALLED_MIB} MB.$\r$\nThe package contains local speech recognition and CPU/CUDA components. Codex is connected separately in LazyCall settings and requires an Internet connection."
LangString CallMeFullIntro 1033 "The complete LazyCall application package is already included."
LangString CallMeFullDetails 1033 "Installed size: about ${CALLME_INSTALLED_MIB} MB.$\r$\nLazyCall includes local speech recognition and CPU/CUDA components. Codex is connected separately in LazyCall settings and requires an Internet connection."
LangString CallMeVcOffer 1033 "Microsoft Visual C++ Redistributable x64 ${CALLME_VC_VERSION} is required for speech recognition (~18 MB). I agree to download it from Microsoft and open its installer."
LangString CallMeVcHint 1033 "Microsoft's installer opens separately. Review and accept its terms there."
LangString CallMeDownloading 1033 "Downloading LazyCall"
LangString CallMeVcDownloading 1033 "Downloading Microsoft Visual C++ Redistributable"
LangString CallMePackageFailed 1033 "LazyCall could not download its package. Status: $CallMeDownloadStatus.$\r$\nCheck your Internet connection and retry."
LangString CallMePackageHashFailed 1033 "The downloaded LazyCall package did not pass its security check. The installed version was not changed. Download it again?"
LangString CallMeVcFailed 1033 "Microsoft Visual C++ could not be downloaded or verified. The installed version was not changed. Retry?"
LangString CallMeVcRequired 1033 "Microsoft Visual C++ Redistributable is required before LazyCall can be installed. No installed LazyCall files were changed."
LangString CallMeVcInstallFailed 1033 "Microsoft Visual C++ is still unavailable. Complete its installer, then retry. No installed LazyCall files were changed."
LangString CallMeReviewDone 1033 "Download verified. Review mode does not install or modify LazyCall."
LangString CallMePreviewRenameFailed 1033 "Could not prepare the isolated preview installation."

LangString CallMeWebIntro 1049 "Перед установкой LazyCall скачает пакет приложения."
LangString CallMeWebDetails 1049 "Загрузка: ${CALLME_PACKAGE_MIB} МБ. После установки: около ${CALLME_INSTALLED_MIB} МБ.$\r$\nВ пакет входят локальное распознавание речи и CPU/CUDA-компоненты. Codex подключается отдельно в настройках LazyCall и требует интернет."
LangString CallMeFullIntro 1049 "Полный пакет приложения LazyCall уже включён в установщик."
LangString CallMeFullDetails 1049 "После установки: около ${CALLME_INSTALLED_MIB} МБ.$\r$\nВ LazyCall входят локальное распознавание речи и CPU/CUDA-компоненты. Codex подключается отдельно в настройках LazyCall и требует интернет."
LangString CallMeVcOffer 1049 "Для распознавания речи нужен Microsoft Visual C++ Redistributable x64 ${CALLME_VC_VERSION} (~18 МБ). Я согласен скачать его с сайта Microsoft и открыть его установщик."
LangString CallMeVcHint 1049 "Установщик Microsoft откроется отдельно: ознакомьтесь с его условиями и примите их там."
LangString CallMeDownloading 1049 "Загрузка LazyCall"
LangString CallMeVcDownloading 1049 "Загрузка Microsoft Visual C++ Redistributable"
LangString CallMePackageFailed 1049 "Не удалось скачать пакет LazyCall. Статус: $CallMeDownloadStatus.$\r$\nПроверьте подключение к интернету и повторите попытку."
LangString CallMePackageHashFailed 1049 "Загруженный пакет LazyCall не прошёл проверку безопасности. Установленная версия не изменена. Скачать ещё раз?"
LangString CallMeVcFailed 1049 "Не удалось скачать или проверить Microsoft Visual C++. Установленная версия не изменена. Повторить?"
LangString CallMeVcRequired 1049 "Перед установкой LazyCall нужен Microsoft Visual C++ Redistributable. Установленные файлы LazyCall не изменены."
LangString CallMeVcInstallFailed 1049 "Microsoft Visual C++ всё ещё недоступен. Завершите его установку и повторите попытку. Установленные файлы LazyCall не изменены."
LangString CallMeReviewDone 1049 "Загрузка проверена. В режиме проверки LazyCall не устанавливается и не изменяется."
LangString CallMePreviewRenameFailed 1049 "Не удалось подготовить изолированную тестовую установку."

!macro customInit
  ${If} ${Silent}
    Call CallMePreparePackage
    ${If} $CallMePrerequisitesReady != "true"
      SetErrorLevel 2
      Quit
    ${EndIf}
    !if "${PRODUCT_FILENAME}" == "LazyCallWebPreview"
      !if "${CALLME_REVIEW_DOWNLOAD_ONLY}" == "true"
        Quit
      !endif
    !endif
    Call CallMeEnsureVCRuntime
    ${If} $CallMePrerequisitesReady != "true"
      SetErrorLevel 2
      Quit
    ${EndIf}
  ${EndIf}
!macroend

!macro customPageAfterChangeDir
  Page custom CallMeDownloadPageCreate CallMeDownloadPageLeave
!macroend

!if "${PRODUCT_FILENAME}" == "LazyCallWebPreview"
  !macro customInstall
    Rename "$INSTDIR\LazyCall.exe" "$INSTDIR\LazyCallWebPreview.exe"
    ${If} ${Errors}
      MessageBox MB_OK|MB_ICONSTOP "$(CallMePreviewRenameFailed)"
      Quit
    ${EndIf}
  !macroend
!endif

; $3 is the output register used by all callers. Scratch registers are restored.
!macro CallMeHashFile output algorithm input
  Push $0
  Push $1
  Push $2
  StrCpy $0 ""
  System::Call 'kernel32::SetEnvironmentVariableW(w "CALLME_HASH_FILE", w "${input}") i .r1'
  ${If} $1 <> 0
    !if "${algorithm}" == "SHA2-512"
      nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "$$f=[IO.File]::OpenRead($$env:CALLME_HASH_FILE); try{$$a=New-Object Security.Cryptography.SHA512Managed; try{[Console]::Out.Write(-join ([BitConverter]::ToString($$a.ComputeHash($$f)).Split([char]45)))}finally{$$a.Dispose()}}finally{$$f.Dispose()}"'
    !else if "${algorithm}" == "SHA2-256"
      nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "$$f=[IO.File]::OpenRead($$env:CALLME_HASH_FILE); try{$$a=New-Object Security.Cryptography.SHA256Managed; try{[Console]::Out.Write(-join ([BitConverter]::ToString($$a.ComputeHash($$f)).Split([char]45)))}finally{$$a.Dispose()}}finally{$$f.Dispose()}"'
    !else
      !error "CallMeHashFile supports only SHA2-512 and SHA2-256"
    !endif
    Pop $1
    Pop $0
    ${If} $1 <> 0
      StrCpy $0 ""
    ${EndIf}
  ${EndIf}
  System::Call 'kernel32::SetEnvironmentVariableW(w "CALLME_HASH_FILE", p 0) i .r2'
  StrCpy ${output} "$0"
  Pop $2
  Pop $1
  Pop $0
!macroend

; nsis-web normally trusts --package-file after uninstalling the old version.
; The bootstrapper always uses its freshly downloaded, pinned archive instead.
!macro CallMeGetParameter output name default
  !if "${name}" == "package-file"
    StrCpy ${output} "${default}"
  !else
    !insertmacro _StdU_GetParameter ${output} "${name}" "${default}"
  !endif
!macroend

!macro customHeader
!ifndef BUILD_UNINSTALLER
!undef StdUtils.HashFile
!define StdUtils.HashFile '!insertmacro CallMeHashFile'
!undef StdUtils.GetParameter
!define StdUtils.GetParameter '!insertmacro CallMeGetParameter'

Var /GLOBAL CallMePackagePrepared
Var /GLOBAL CallMePackageFile
Var /GLOBAL CallMeVCRedistFile
Var /GLOBAL CallMeDownloadStatus
Var /GLOBAL CallMePrerequisitesReady
Var /GLOBAL CallMeVCRuntimeAvailable
Var /GLOBAL CallMeVcCheckbox

Function CallMeDownloadPageCreate
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  !ifdef APP_PACKAGE_URL
    ${NSD_CreateLabel} 0 0 100% 18u "$(CallMeWebIntro)"
    Pop $0
    ${NSD_CreateLabel} 0 22u 100% 44u "$(CallMeWebDetails)"
    Pop $0
  !else
    ${NSD_CreateLabel} 0 0 100% 18u "$(CallMeFullIntro)"
    Pop $0
    ${NSD_CreateLabel} 0 22u 100% 44u "$(CallMeFullDetails)"
    Pop $0
  !endif
  Call CallMeHasVCRuntime
  ${If} $CallMeVCRuntimeAvailable != "true"
    ${NSD_CreateCheckbox} 0 72u 100% 26u "$(CallMeVcOffer)"
    Pop $CallMeVcCheckbox
    ${NSD_CreateLabel} 0 104u 100% 28u "$(CallMeVcHint)"
    Pop $0
  ${EndIf}
  nsDialogs::Show
FunctionEnd

Function CallMeDownloadPageLeave
  Call CallMePreparePackage
  ${If} $CallMePrerequisitesReady != "true"
    Abort
  ${EndIf}
  !if "${PRODUCT_FILENAME}" == "LazyCallWebPreview"
    !if "${CALLME_REVIEW_DOWNLOAD_ONLY}" == "true"
      MessageBox MB_OK|MB_ICONINFORMATION "$(CallMeReviewDone)"
      Quit
    !endif
  !endif
  Call CallMeEnsureVCRuntime
  ${If} $CallMePrerequisitesReady != "true"
    Abort
  ${EndIf}
FunctionEnd

Function CallMePreparePackage
  StrCpy $CallMePrerequisitesReady "false"
  !ifdef APP_PACKAGE_URL
    ${If} $CallMePackagePrepared == "true"
      StrCpy $CallMePrerequisitesReady "true"
      Return
    ${EndIf}
    InitPluginsDir
    StrCpy $CallMePackageFile "$PLUGINSDIR\${APP_64_NAME}"
    callme_package_retry:
      Delete "$CallMePackageFile"
      ${If} ${Silent}
        inetc::get /SILENT /USERAGENT "LazyCall installer" /RESUME "" "${APP_PACKAGE_URL}" "$CallMePackageFile" /END
      ${Else}
        inetc::get /CAPTION "$(CallMeDownloading)" /USERAGENT "LazyCall installer" /RESUME "" "${APP_PACKAGE_URL}" "$CallMePackageFile" /END
      ${EndIf}
      Pop $CallMeDownloadStatus
      ${If} $CallMeDownloadStatus != "OK"
        ${If} ${Silent}
          Return
        ${EndIf}
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(CallMePackageFailed)" IDRETRY callme_package_retry
        Return
      ${EndIf}
      ${StdUtils.HashFile} $3 "SHA2-512" "$CallMePackageFile"
      ${If} $3 != "${APP_64_HASH}"
        Delete "$CallMePackageFile"
        ${If} ${Silent}
          Return
        ${EndIf}
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(CallMePackageHashFailed)" IDRETRY callme_package_retry
        Return
      ${EndIf}
    StrCpy $EXEDIR "$PLUGINSDIR"
    StrCpy $CallMePackagePrepared "true"
  !endif
  StrCpy $CallMePrerequisitesReady "true"
FunctionEnd

Function CallMeHasVCRuntime
  StrCpy $CallMeVCRuntimeAvailable "false"
  SetRegView 64
  ReadRegDWORD $3 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
  ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Major"
  ReadRegDWORD $1 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Minor"
  ReadRegDWORD $2 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Bld"
  ${If} $3 != 1
    Return
  ${EndIf}
  ${If} $0 == ""
    Return
  ${EndIf}
  ${If} $0 > 14
    StrCpy $CallMeVCRuntimeAvailable "true"
    Return
  ${EndIf}
  ${If} $0 == 14
    ${If} $1 > 51
      StrCpy $CallMeVCRuntimeAvailable "true"
      Return
    ${EndIf}
    ${If} $1 == 51
      ${If} $2 >= 36247
        StrCpy $CallMeVCRuntimeAvailable "true"
      ${EndIf}
    ${EndIf}
  ${EndIf}
FunctionEnd

Function CallMeEnsureVCRuntime
  StrCpy $CallMePrerequisitesReady "false"
  Call CallMeHasVCRuntime
  ${If} $CallMeVCRuntimeAvailable == "true"
    StrCpy $CallMePrerequisitesReady "true"
    Return
  ${EndIf}
  ${If} ${Silent}
    Return
  ${EndIf}
  ${NSD_GetState} $CallMeVcCheckbox $0
  ${If} $0 != ${BST_CHECKED}
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(CallMeVcRequired)"
    Return
  ${EndIf}
  InitPluginsDir
  StrCpy $CallMeVCRedistFile "$PLUGINSDIR\VC_redist.x64.exe"
  callme_vc_retry:
    Delete "$CallMeVCRedistFile"
    inetc::get /CAPTION "$(CallMeVcDownloading)" /USERAGENT "LazyCall installer" /RESUME "" "${CALLME_VC_URL}" "$CallMeVCRedistFile" /END
    Pop $CallMeDownloadStatus
    ${If} $CallMeDownloadStatus != "OK"
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(CallMeVcFailed)" IDRETRY callme_vc_retry
      Return
    ${EndIf}
    ${StdUtils.HashFile} $3 "SHA2-256" "$CallMeVCRedistFile"
    ${If} $3 != "${CALLME_VC_SHA256}"
      Delete "$CallMeVCRedistFile"
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(CallMeVcFailed)" IDRETRY callme_vc_retry
      Return
    ${EndIf}
  ; Microsoft shows its own terms; this never accepts terms or installs silently.
  ExecWait '"$CallMeVCRedistFile" /norestart' $0
  Call CallMeHasVCRuntime
  ${If} $CallMeVCRuntimeAvailable != "true"
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(CallMeVcInstallFailed)" IDRETRY callme_vc_retry
    Return
  ${EndIf}
  StrCpy $CallMePrerequisitesReady "true"
FunctionEnd
!endif
!macroend
