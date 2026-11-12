!macro customInit
  nsExec::ExecToLog 'cmd /C taskkill /F /IM WiseWave.exe /T >NUL 2>&1'
  Sleep 1000
  IfFileExists "$INSTDIR\WiseWave.exe" 0 skip_clean
    RMDir /r "$INSTDIR"
  skip_clean:
!macroend
