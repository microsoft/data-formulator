function Assert-MicrosoftSignature([string]$File) {
    $signature = Get-AuthenticodeSignature -LiteralPath $File
    if ($signature.Status -ne 'Valid' -or
        $signature.SignerCertificate.Subject -notmatch '(^|,\s*)O=Microsoft Corporation(,|$)' -or
        -not $signature.TimeStamperCertificate) {
        throw "A valid timestamped Microsoft signature is required: $File"
    }
}
