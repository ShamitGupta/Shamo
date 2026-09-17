<#
.SYNOPSIS
    Build the React app and publish it to S3 + CloudFront.

.EXAMPLE
    .\deploy\publish-frontend.ps1 -Bucket shamoclasses-web -DistributionId E1234ABCDEFGH

.NOTES
    VITE_* values are read by Vite AT BUILD TIME and baked into the JavaScript
    bundle. There is no runtime configuration step -- changing the API URL means
    rebuilding and republishing, not editing a file on the server. Set them in
    frontend/.env.production before running this.
#>
param(
    [Parameter(Mandatory = $true)][string]$Bucket,
    [Parameter(Mandatory = $true)][string]$DistributionId,
    [string]$Profile = "default"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location (Join-Path $repoRoot "frontend")

if (-not (Test-Path ".env.production")) {
    Write-Host "frontend/.env.production not found." -ForegroundColor Yellow
    Write-Host "It must set VITE_API_BASE_URL=https://api.shamoclasses.com plus the" -ForegroundColor Yellow
    Write-Host "Supabase and Desmos keys, or the build will bake in localhost." -ForegroundColor Yellow
    exit 1
}

Write-Host "Building..." -ForegroundColor Cyan
npm.cmd run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# Two passes, because the correct cache policy differs by file.
#
# Vite fingerprints everything under assets/ with a content hash, so those files
# are immutable -- a change produces a new filename, never new bytes at an old
# one. They get a one-year cache.
Write-Host "Uploading fingerprinted assets..." -ForegroundColor Cyan
aws s3 sync dist/ "s3://$Bucket/" `
    --profile $Profile `
    --delete `
    --exclude "index.html" `
    --cache-control "public,max-age=31536000,immutable"

# index.html is NOT fingerprinted: its name is fixed and its contents change on
# every deploy. Caching it would pin browsers to the old bundle indefinitely.
Write-Host "Uploading index.html (no-cache)..." -ForegroundColor Cyan
aws s3 cp dist/index.html "s3://$Bucket/index.html" `
    --profile $Profile `
    --cache-control "no-cache,no-store,must-revalidate" `
    --content-type "text/html"

Write-Host "Invalidating CloudFront..." -ForegroundColor Cyan
$invalidation = aws cloudfront create-invalidation `
    --distribution-id $DistributionId `
    --paths "/*" `
    --profile $Profile `
    --query "Invalidation.Id" `
    --output text

Write-Host ""
Write-Host "Published. Invalidation $invalidation is in progress (~1-3 min)." -ForegroundColor Green
Write-Host "https://shamoclasses.com" -ForegroundColor Green
