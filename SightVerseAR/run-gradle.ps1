# Runs a Gradle task in the background-friendly way and logs to gradle.log
#   powershell -File run-gradle.ps1 assembleRelease
param([Parameter(ValueFromRemainingArguments = $true)] $tasks)
Set-Location $PSScriptRoot
$env:JAVA_HOME = (Get-ChildItem 'C:\Program Files\Microsoft' -Directory -Filter 'jdk-17*' | Select-Object -First 1).FullName
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
"start $(Get-Date) $tasks" | Out-File gradle.log
& .\gradlew.bat --no-daemon --console=plain @tasks *>> gradle.log
"EXIT $LASTEXITCODE $(Get-Date)" | Out-File gradle.log -Append
