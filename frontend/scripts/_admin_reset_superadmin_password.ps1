# SUPERADMIN password reset v2 — hidden prompts, CR/LF stripped before hash.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

Write-Host "Reset SUPERADMIN v2 (Neon Production)"
Write-Host "Escriba la contrasena EXACTA que usara en el navegador."
Write-Host "Los caracteres no se muestran."
Write-Host ""

$secure1 = Read-Host "Nueva contrasena" -AsSecureString
$secure2 = Read-Host "Confirmar contrasena" -AsSecureString

$bstr1 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure1)
$bstr2 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure2)
try {
  $plain1 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr1)
  $plain2 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr2)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr1) | Out-Null
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr2) | Out-Null
}

if (-not $plain1 -or $plain1.Length -lt 8) {
  Write-Host '{"ok":false,"reason":"password_too_short"}'
  exit 1
}
if ($plain1 -ne $plain2) {
  Write-Host '{"ok":false,"reason":"password_mismatch"}'
  exit 1
}

Write-Host ("longitud_ingresada=" + $plain1.Length + " (sin mostrar contenido)")

# Pipe using UTF8 bytes without relying on WriteLine CR semantics beyond one \n.
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "node"
$psi.Arguments = "scripts/_admin_reset_superadmin_password.mjs"
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
$sw.WriteLine($plain1)
$sw.WriteLine($plain2)
$sw.Flush()
$sw.Close()

$plain1 = $null
$plain2 = $null
[GC]::Collect()

$stdout = $proc.StandardOutput.ReadToEnd()
$stderr = $proc.StandardError.ReadToEnd()
$proc.WaitForExit()
if ($stderr -and $stderr.Trim().Length -gt 0) { Write-Host "node_stderr_present=true" }
Write-Host $stdout.Trim()
exit $proc.ExitCode
