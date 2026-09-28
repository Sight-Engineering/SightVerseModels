$ErrorActionPreference = 'Continue'
$env:JAVA_HOME = (Get-ChildItem 'C:\Program Files\Microsoft' -Directory -Filter 'jdk-17*' | Select-Object -First 1).FullName
$sdk = "$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_HOME = $sdk
$mgr = "$sdk\cmdline-tools\latest\bin\sdkmanager.bat"
$log = "$env:TEMP\sdk-setup.log"
"start $(Get-Date)" | Out-File $log
(1..30 | ForEach-Object { 'y' }) -join "`n" | & $mgr --sdk_root=$sdk --licenses *>> $log
& $mgr --sdk_root=$sdk 'platform-tools' 'platforms;android-35' 'build-tools;35.0.0' *>> $log
"DONE $(Get-Date)" | Out-File $log -Append
