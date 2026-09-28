$dir = 'D:\Githup\Unreal_Projects\SightVerseModels\SightVerseWeb\android'
Set-Location $dir
$java = (Get-ChildItem 'C:\Program Files\Microsoft' -Directory -Filter 'jdk-17*' | Select-Object -First 1).FullName + '\bin\java.exe'
$signer = "$env:LOCALAPPDATA\Android\Sdk\build-tools\36.1.0\lib\apksigner.jar"
$pw = (Select-String -Path "$dir\KEYSTORE-PASSWORD.txt" -Pattern '^password:\s*(\S+)').Matches[0].Groups[1].Value
& $java -jar $signer sign --ks "$dir\sightverse-release.keystore" --ks-key-alias sightverse --ks-pass "pass:$pw" --key-pass "pass:$pw" --out "$dir\SightVerse.apk" "$dir\app-release-unsigned-aligned.apk"
& $java -jar $signer verify --print-certs "$dir\SightVerse.apk" | Select-String 'SHA-256'
# the build log echoed the password - scrub it
(Get-Content "$dir\build.log") -replace [regex]::Escape($pw), '********' | Set-Content "$dir\build.log"
