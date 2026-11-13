!macro customInit
  nsExec::ExecToLog 'cmd /C taskkill /F /IM WiseWave.exe /T >NUL 2>&1'
  Sleep 1000
!macroend

!macro customInstall
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.wisewave.app" "EstimatedSize" $0
!macroend

!include "FileFunc.nsh"
