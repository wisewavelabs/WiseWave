Unicode true
ManifestDPIAware true
SetCompressor /SOLID lzma
Name "WiseWave"
OutFile "..\dist\windows-amd64\wisewave-setup-0.1.0-amd64.exe"
InstallDir "$LOCALAPPDATA\Programs\WiseWave"
InstallDirRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.wisewave.app" "InstallLocation"
RequestExecutionLevel user
BrandingText "WiseWave  |  Made by Friston"

!define MUI_ABORTWARNING
!define MUI_ICON "images\setup.ico"
!define MUI_UNICON "images\setup.ico"
!define MUI_WELCOMEFINISHPAGE_BITMAP "images\setup.bmp"
!define MUI_WELCOMEPAGE_TITLE "Welcome to WiseWave"
!define MUI_WELCOMEPAGE_TEXT "Your music, your space.$\r$\n$\r$\nSet up WiseWave on this computer and get back to the music you love."
!define MUI_DIRECTORYPAGE_TEXT_TOP "Choose where WiseWave should live."
!define MUI_FINISHPAGE_TITLE "WiseWave is ready"
!define MUI_FINISHPAGE_TEXT "Everything is set. Open WiseWave and make yourself at home."
!define MUI_FINISHPAGE_RUN "$INSTDIR\WiseWave.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Open WiseWave"
!define MUI_FINISHPAGE_SHOWREADME
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Create a desktop shortcut"
!define MUI_FINISHPAGE_SHOWREADME_FUNCTION CreateDesktopShortcut
!include "MUI2.nsh"
!include "FileFunc.nsh"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section
  nsExec::ExecToLog 'taskkill /IM WiseWave.exe /T /F'
  SetOutPath "$INSTDIR"
  File "..\dist\windows-amd64\WiseWave.exe"
  File /r "..\dist\windows-amd64\licenses"
  Delete "$INSTDIR\accompanist-lyrics-license.txt"
  Delete "$INSTDIR\accompanist-lyrics-notice.txt"
  Delete "$INSTDIR\echo-controls-license.txt"
  Delete "$INSTDIR\go-aac-license.txt"
  Delete "$INSTDIR\go-audio-stream-license.txt"
  Delete "$INSTDIR\go-m4a-license.txt"
  Delete "$INSTDIR\loading-ui-license.txt"
  Delete "$INSTDIR\simd-license.txt"
  Delete "$INSTDIR\icon.png"
  Delete "$INSTDIR\splash.svg"
  Delete "$INSTDIR\installer.nsh"
  Delete "$INSTDIR\setup.nsi"
  Delete "$INSTDIR\setup-icon.ps1"
  Delete "$INSTDIR\assets\windows-platform.svg"
  RMDir "$INSTDIR\assets"
  Delete "$INSTDIR\fonts\figtree-normal-latin.woff2"
  Delete "$INSTDIR\fonts\figtree-normal-latin-ext.woff2"
  Delete "$INSTDIR\fonts\manrope-normal-latin.woff2"
  Delete "$INSTDIR\fonts\manrope-normal-latin-ext.woff2"
  Delete "$INSTDIR\fonts\google-sans-flex.ttf"
  RMDir "$INSTDIR\fonts"
  Delete "$INSTDIR\images\icon.png"
  Delete "$INSTDIR\images\liked-songs.png"
  Delete "$INSTDIR\images\setup.bmp"
  Delete "$INSTDIR\images\setup.ico"
  RMDir "$INSTDIR\images"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortcut "$SMPROGRAMS\WiseWave.lnk" "$INSTDIR\WiseWave.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.wisewave.app" "DisplayName" "WiseWave"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.wisewave.app" "DisplayVersion" "0.1.0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.wisewave.app" "Publisher" "Friston"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.wisewave.app" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.wisewave.app" "DisplayIcon" "$INSTDIR\WiseWave.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.wisewave.app" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.wisewave.app" "EstimatedSize" $0
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.wisewave.app" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.wisewave.app" "NoRepair" 1
SectionEnd

Function CreateDesktopShortcut
  CreateShortcut "$DESKTOP\WiseWave.lnk" "$INSTDIR\WiseWave.exe"
FunctionEnd

Section "Uninstall"
  nsExec::ExecToLog 'taskkill /IM WiseWave.exe /T /F'
  Delete "$SMPROGRAMS\WiseWave.lnk"
  Delete "$DESKTOP\WiseWave.lnk"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.wisewave.app"
  Delete "$INSTDIR\WiseWave.exe"
  Delete "$INSTDIR\licenses\accompanist-lyrics-license.txt"
  Delete "$INSTDIR\licenses\accompanist-lyrics-notice.txt"
  Delete "$INSTDIR\licenses\echo-controls-license.txt"
  Delete "$INSTDIR\licenses\figtree-license.txt"
  Delete "$INSTDIR\licenses\google-sans-flex-license.txt"
  Delete "$INSTDIR\licenses\manrope-license.txt"
  Delete "$INSTDIR\licenses\go-aac-license.txt"
  Delete "$INSTDIR\licenses\go-audio-stream-license.txt"
  Delete "$INSTDIR\licenses\go-m4a-license.txt"
  Delete "$INSTDIR\licenses\loading-ui-license.txt"
  Delete "$INSTDIR\licenses\simd-license.txt"
  RMDir "$INSTDIR\licenses"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
SectionEnd
