# prints the parameter list of a Kotlin fun (skipping KDoc lines): sig.ps1 <file> <line>
param($file, [int]$line)
$lines = Get-Content $file
$depth = 0; $started = $false
for ($i = $line - 1; $i -lt $lines.Count; $i++) {
  $t = $lines[$i]
  $trim = $t.Trim()
  if ($trim.StartsWith('*') -or $trim.StartsWith('/**') -or $trim.StartsWith('//')) { continue }
  $depth += ([regex]::Matches($t, '\(')).Count - ([regex]::Matches($t, '\)')).Count
  if ($t -match '\(') { $started = $true }
  $trim
  if ($started -and $depth -le 0) { break }
}
