#Requires -RunAsAdministrator
# Installs (or updates) the Mac Panel agent for this Windows user. Run in an administrator PowerShell
# (the firewall rule needs it), from the folder that holds hidpp\ and pc-agent\:
#   powershell -ExecutionPolicy Bypass -File pc-agent\install.ps1 -Allow <the Mac's IP>
# It asks for the key, so it stays out of the command line and the PowerShell history. Piped in
# (`echo <key> | ... install.ps1 -Allow ...`), it's read from the input instead.
param(
  [Parameter(Mandatory = $true)][string]$Allow,
  [int]$Port = 8766
)
$ErrorActionPreference = 'Stop'
if ([Console]::IsInputRedirected) {
  $Key = [Console]::In.ReadLine()
} else {
  $secure = Read-Host -AsSecureString 'Key (on the Mac: security find-generic-password -s mac-panel.pc-agent -w)'
  $Key = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}
$Key = "$Key".Trim()
if ($Key -notmatch '^[0-9a-fA-F]{32,}$') { throw 'The key should be the hex string from the Mac (openssl rand -hex 32)' }
$root = Split-Path -Parent $PSScriptRoot
$venv = Join-Path $root 'venv'

if (-not (Test-Path (Join-Path $venv 'Scripts\python.exe'))) { python -m venv $venv }
& (Join-Path $venv 'Scripts\python.exe') -m pip install --quiet --upgrade hidapi
if ($LASTEXITCODE -ne 0) { throw 'pip install hidapi failed' }

$folder = Join-Path $env:APPDATA 'mac-panel-agent'
New-Item -ItemType Directory -Force $folder | Out-Null
@{ port = $Port; key = $Key; allow = @($Allow) } | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $folder 'config.json')

$name = 'Mac Panel agent'
$action = New-ScheduledTaskAction -Execute (Join-Path $venv 'Scripts\pythonw.exe') -Argument ('"' + (Join-Path $PSScriptRoot 'agent.py') + '"') -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit 0 -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null

Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $name -Direction Inbound -Protocol TCP -LocalPort $Port -RemoteAddress $Allow -Profile Private -Action Allow | Out-Null

Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName $name
Write-Output "Installed: listening on port $Port for $Allow"
