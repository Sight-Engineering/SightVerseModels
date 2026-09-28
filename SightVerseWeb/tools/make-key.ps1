$jdk = (Get-ChildItem 'C:\Program Files\Microsoft' -Directory -Filter 'jdk-17*' | Select-Object -First 1).FullName
$dir = 'D:\Githup\Unreal_Projects\SightVerseModels\SightVerseWeb\android'
New-Item -ItemType Directory -Force $dir | Out-Null
$ks = "$dir\sightverse-release.keystore"
if (Test-Path $ks) { 'keystore already exists'; exit }
$chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
$pw = -join (1..24 | ForEach-Object { $chars[(Get-Random -Maximum $chars.Length)] })
& "$jdk\bin\keytool.exe" -genkeypair -v -keystore $ks -alias sightverse -keyalg RSA -keysize 2048 -validity 10000 `
  -storepass $pw -keypass $pw -dname "CN=Sight Real Estate, O=Sight Real Estate, C=IQ" 2>&1 | Select-Object -Last 1
@"
Sight Verse Android signing key - KEEP THIS FILE AND THE KEYSTORE SAFE AND PRIVATE.
You need both to publish any future update of the app (lost key = users must uninstall/reinstall).
keystore: sightverse-release.keystore
alias:    sightverse
password: $pw   (same for keystore and key)
"@ | Out-File "$dir\KEYSTORE-PASSWORD.txt" -Encoding utf8
'key created'
