; Lets Windows list Clip Editor under "Open with" and lets other programs (Encore) find the exe.
; Nothing here changes which program is the default for any file type.
!macro customInstall
  WriteRegStr SHELL_CONTEXT "Software\Microsoft\Windows\CurrentVersion\App Paths\Clip Editor.exe" "" "$INSTDIR\Clip Editor.exe"
  WriteRegStr SHELL_CONTEXT "Software\Microsoft\Windows\CurrentVersion\App Paths\Clip Editor.exe" "Path" "$INSTDIR"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\Clip Editor.exe" "FriendlyAppName" "Clip Editor"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\Clip Editor.exe\shell\open\command" "" '"$INSTDIR\Clip Editor.exe" "%1"'
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\Clip Editor.exe\SupportedTypes" ".mp4" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\Clip Editor.exe\SupportedTypes" ".mkv" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\Clip Editor.exe\SupportedTypes" ".mov" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\Clip Editor.exe\SupportedTypes" ".webm" ""
!macroend

!macro customUnInstall
  DeleteRegKey SHELL_CONTEXT "Software\Microsoft\Windows\CurrentVersion\App Paths\Clip Editor.exe"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\Applications\Clip Editor.exe"
!macroend
