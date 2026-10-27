$ErrorActionPreference = 'Stop'
$auditBstr = [IntPtr]::Zero
$auditOldEncoding = $OutputEncoding
try {
    $auditSecure = Read-Host 'Senha de postgres (entrada oculta, somente leitura)' -AsSecureString
    $auditBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($auditSecure)
    $auditPayload = @{ password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($auditBstr) } | ConvertTo-Json -Compress
    $OutputEncoding = [Text.UTF8Encoding]::new($false)
    Push-Location -LiteralPath (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
    try {
        $auditPayload | & node --import tsx (Join-Path $PSScriptRoot 'verify-legacy-audit-admin.ts')
        if ($LASTEXITCODE -ne 0) { throw 'Validação recusada. Não aplicar a migração.' }
    } finally { Pop-Location }
} finally {
    if ($auditBstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($auditBstr) }
    $OutputEncoding = $auditOldEncoding
    Remove-Variable auditPayload,auditSecure -ErrorAction SilentlyContinue
}
