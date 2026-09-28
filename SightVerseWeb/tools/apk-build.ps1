$dir = 'D:\Githup\Unreal_Projects\SightVerseModels\SightVerseWeb\android'
$log = "$dir\build.log"
Set-Location $dir
$env:JAVA_HOME = (Get-ChildItem 'C:\Program Files\Microsoft' -Directory -Filter 'jdk-17*' | Select-Object -First 1).FullName
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$pw = (Select-String -Path "$dir\KEYSTORE-PASSWORD.txt" -Pattern '^password:\s*(\S+)').Matches[0].Groups[1].Value
$env:BUBBLEWRAP_KEYSTORE_PASSWORD = $pw
$env:BUBBLEWRAP_KEY_PASSWORD = $pw
"start $(Get-Date)" | Out-File $log
'n' | bubblewrap update --skipVersionUpgrade *>> $log
'n' | bubblewrap build --skipPwaValidation *>> $log
"EXIT $LASTEXITCODE $(Get-Date)" | Out-File $log -Append
