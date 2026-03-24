param(
    [switch]$DownloadMissing,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptRoot
$manifestPath = Join-Path $scriptRoot "assets.manifest.json"
$reportPath = Join-Path $scriptRoot "CHECKLIST.generated.md"

if (-not (Test-Path $manifestPath)) {
    throw "Manifest not found: $manifestPath"
}

$items = Get-Content $manifestPath -Raw | ConvertFrom-Json
$results = @()

function Resolve-RepoPath([string]$pathValue) {
    if ([System.IO.Path]::IsPathRooted($pathValue)) {
        return $pathValue
    }
    return Join-Path $projectRoot $pathValue
}

foreach ($item in $items) {
    $targetPath = Resolve-RepoPath $item.path
    $exists = $false
    $details = ""

    if ($item.kind -eq "directory_glob") {
        if (Test-Path $targetPath) {
            $count = @(Get-ChildItem -Path $targetPath -Filter $item.glob -File -ErrorAction SilentlyContinue).Count
            $exists = $count -ge [int]$item.minCount
            $details = "$count matching file(s)"
        } else {
            $details = "directory missing"
        }
    } else {
        $exists = Test-Path $targetPath
        $details = if ($exists) { "present" } else { "missing" }
    }

    if (-not $exists -and $DownloadMissing -and $item.downloadUrl) {
        $parent = Split-Path -Parent $targetPath
        if (-not (Test-Path $parent)) {
            New-Item -ItemType Directory -Path $parent -Force | Out-Null
        }

        if ((-not (Test-Path $targetPath)) -or $Force) {
            Write-Host "Downloading $($item.name)..." -ForegroundColor Cyan
            Invoke-WebRequest -Uri $item.downloadUrl -OutFile $targetPath
            $exists = Test-Path $targetPath
            $details = if ($exists) { "downloaded" } else { "download failed" }
        }
    }

    $results += [pscustomobject]@{
        Required   = [bool]$item.required
        Name       = [string]$item.name
        Status     = if ($exists) { "OK" } else { "MISSING" }
        Path       = $item.path
        SourceUrl  = $item.sourceUrl
        Notes      = $item.notes
        Details    = $details
        Download   = $item.downloadUrl
    }
}

$requiredMissing = @($results | Where-Object { $_.Required -and $_.Status -ne "OK" })

$lines = @(
    "# Oddity Asset Checklist",
    "",
    "Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
    ""
)

foreach ($row in $results) {
    $checkbox = if ($row.Status -eq "OK") { "[x]" } else { "[ ]" }
    $requiredText = if ($row.Required) { "required" } else { "optional" }
    $lines += "$checkbox $($row.Name) ($requiredText)"
    $lines += "- Path: $($row.Path)"
    $lines += "- Status: $($row.Status) ($($row.Details))"
    if ($row.SourceUrl) {
        $lines += "- Source: $($row.SourceUrl)"
    }
    if ($row.Download) {
        $lines += "- Direct download: $($row.Download)"
    }
    if ($row.Notes) {
        $lines += "- Notes: $($row.Notes)"
    }
    $lines += ""
}

Set-Content -Path $reportPath -Value $lines -Encoding UTF8

Write-Host ""
Write-Host "Oddity asset checklist" -ForegroundColor Green
Write-Host "Report: $reportPath"
Write-Host ""

$results | Format-Table Required, Name, Status, Details -AutoSize

Write-Host ""
if ($requiredMissing.Count -gt 0) {
    Write-Host "Missing required items detected." -ForegroundColor Yellow
    if (-not $DownloadMissing) {
        Write-Host "Run again with -DownloadMissing to fetch assets that have direct download URLs." -ForegroundColor Yellow
    }
} else {
    Write-Host "All required items are present." -ForegroundColor Green
}
