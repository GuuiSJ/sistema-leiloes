$ErrorActionPreference = 'Stop'
$postUtcPointer = [IntPtr]::Zero
$postUtcEncoding = $OutputEncoding
try {
    $postUtcSecret = Read-Host 'Senha de postgres (validacao pos-migracao somente leitura)' -AsSecureString
    $postUtcPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($postUtcSecret)
    $postUtcPayload = @{ password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($postUtcPointer) } | ConvertTo-Json -Compress
    $OutputEncoding = [Text.UTF8Encoding]::new($false)
    Push-Location -LiteralPath (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
    try {
        $postUtcPayload | & node --import tsx (Join-Path $PSScriptRoot 'verify-post-utc-admin.ts')
        if ($LASTEXITCODE -ne 0) { throw 'Validacao recusada. Manter leiloes_app bloqueado e servidores parados.' }
    } finally { Pop-Location }
} finally {
    if ($postUtcPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($postUtcPointer) }
    $OutputEncoding = $postUtcEncoding
    Remove-Variable postUtcPayload,postUtcSecret -ErrorAction SilentlyContinue
}
