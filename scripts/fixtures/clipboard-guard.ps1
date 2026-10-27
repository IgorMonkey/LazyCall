# Preserve all clipboard formats in memory, never print clipboard contents.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$originalClipboard = [System.Windows.Forms.Clipboard]::GetDataObject()
$clipboardBackup = New-Object System.Windows.Forms.DataObject
$clipboardHadData = $false
if ($null -ne $originalClipboard) {
  foreach ($clipboardFormat in $originalClipboard.GetFormats($false)) {
    $clipboardValue = $originalClipboard.GetData($clipboardFormat, $false)
    if ($null -ne $clipboardValue) {
      if ($clipboardValue -is [System.IO.Stream]) {
        $clipboardCopy = New-Object System.IO.MemoryStream
        $clipboardValue.Position = 0
        $clipboardValue.CopyTo($clipboardCopy)
        $clipboardCopy.Position = 0
        $clipboardValue = $clipboardCopy
      } elseif ($clipboardValue -is [System.ICloneable]) {
        $clipboardValue = $clipboardValue.Clone()
      }
      $clipboardBackup.SetData($clipboardFormat, $false, $clipboardValue)
      $clipboardHadData = $true
    }
  }
}
[Console]::WriteLine('CLIPBOARD_GUARD_READY')
$null = [Console]::ReadLine()
# Do not replace a fresh clipboard item copied by the user while the test ran.
if ([System.Windows.Forms.Clipboard]::ContainsText() -and [System.Windows.Forms.Clipboard]::GetText().StartsWith('FIXTURE_ONLY_CALLME_')) {
  if ($clipboardHadData) { [System.Windows.Forms.Clipboard]::SetDataObject($clipboardBackup, $true) }
  else { [System.Windows.Forms.Clipboard]::Clear() }
}
[Console]::WriteLine('CLIPBOARD_GUARD_RESTORED')
