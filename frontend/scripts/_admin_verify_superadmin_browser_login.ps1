# Browser-form login verify — prompts password once (hidden), posts same JSON as the UI.
# Never prints password. Writes only sanitized status JSON.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

Write-Host "Verificacion HTTP+navegador (misma API que el formulario)."
Write-Host "Ingrese la contrasena recien fijada (no se muestra)."
$secure = Read-Host "Contrasena" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) | Out-Null
}

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "node"
$psi.Arguments = "scripts/_admin_verify_superadmin_browser_login.mjs"
$psi.WorkingDirectory = (Get-Location).Path
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
$psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8
$psi.CreateNoWindow = $true

$proc = New-Object System.Diagnostics.Process
$proc.StartInfo = $psi
[void]$proc.Start()
$utf8 = New-Object System.Text.UTF8Encoding $false
$sw = New-Object System.IO.StreamWriter($proc.StandardInput.BaseStream, $utf8)
$sw.NewLine = "`n"
$sw.WriteLine($plain)
$sw.Flush()
$sw.Close()
$plain = $null
[GC]::Collect()

$stdout = $proc.StandardOutput.ReadToEnd()
$stderr = $proc.StandardError.ReadToEnd()
$proc.WaitForExit()
if ($stderr -and $stderr.Trim().Length -gt 0) { Write-Host "node_stderr_present=true" }
Write-Host $stdout.Trim()
exit $proc.ExitCode
