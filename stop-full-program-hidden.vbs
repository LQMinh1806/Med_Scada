Option Explicit

Dim fso, shell, scriptDir, batPath, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
batPath = fso.BuildPath(scriptDir, "stop-full-program.bat")
cmd = Chr(34) & batPath & Chr(34) & " --no-pause"

' 0 = hidden window, False = do not wait
shell.Run cmd, 0, False
