$jdk = (Get-ChildItem 'C:\Program Files\Microsoft' -Directory -Filter 'jdk-17*' | Select-Object -First 1).FullName
$sdk = "$env:LOCALAPPDATA\Android\Sdk"
New-Item -ItemType Directory -Force "$env:USERPROFILE\.bubblewrap" | Out-Null
@{ jdkPath = $jdk; androidSdkPath = $sdk } | ConvertTo-Json | Out-File "$env:USERPROFILE\.bubblewrap\config.json" -Encoding ascii

$dir = 'D:\Githup\Unreal_Projects\SightVerseModels\SightVerseWeb\android'
$host_ = 'verse.sightrealestate.net'
$m = [ordered]@{
  packageId = 'net.sightrealestate.verse'
  host = $host_
  name = 'Sight Verse'
  launcherName = 'Sight Verse'
  display = 'fullscreen'
  orientation = 'default'
  themeColor = '#0A1218'
  themeColorDark = '#0A1218'
  navigationColor = '#0A1218'
  navigationColorDark = '#0A1218'
  navigationDividerColor = '#0A1218'
  navigationDividerColorDark = '#0A1218'
  backgroundColor = '#0A1218'
  enableNotifications = $false
  startUrl = '/'
  iconUrl = 'http://localhost:5173/icons/icon-512.png'
  maskableIconUrl = 'http://localhost:5173/icons/maskable-512.png'
  splashScreenFadeOutDuration = 300
  signingKey = @{ path = "$dir\sightverse-release.keystore"; alias = 'sightverse' }
  appVersionName = '1.0.0'
  appVersionCode = 1
  shortcuts = @()
  generatorApp = 'bubblewrap-cli'
  webManifestUrl = "https://$host_/manifest.webmanifest"
  fallbackType = 'customtabs'
  features = @{}
  alphaDependencies = @{ enabled = $false }
  enableSiteSettingsShortcut = $true
  isChromeOSOnly = $false
  isMetaQuest = $false
  fullScopeUrl = "https://$host_/"
  minSdkVersion = 21
  retainedBundles = @()
  appVersion = '1.0.0'
}
$m | ConvertTo-Json -Depth 5 | Out-File "$dir\twa-manifest.json" -Encoding ascii
'ok'
