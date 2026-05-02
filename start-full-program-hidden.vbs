Option Explicit

Dim fso, shell, scriptDir, batPath
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
batPath = fso.BuildPath(scriptDir, "start-full-program.bat")

' 0 = hidden window, False = do not wait
shell.Run Chr(34) & batPath & Chr(34), 0, False
