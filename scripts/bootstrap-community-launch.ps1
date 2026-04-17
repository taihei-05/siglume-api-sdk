param(
    [string]$Repo = "taihei-05/siglume-api-sdk"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Require-Gh {
    $gh = Get-Command gh -ErrorAction SilentlyContinue
    if (-not $gh) {
        throw "GitHub CLI (gh) is not installed. Install it first, then run this script again."
    }
    gh auth status | Out-Null
}

function Ensure-Label {
    param(
        [string]$Name,
        [string]$Color,
        [string]$Description
    )

    $exists = gh label list -R $Repo --limit 200 --json name --jq ".[] | select(.name == ""$Name"") | .name"
    if ($exists) {
        Write-Host "Label exists: $Name"
        return
    }
    gh label create $Name -R $Repo --color $Color --description $Description | Out-Null
    Write-Host "Created label: $Name"
}

function Ensure-Issue {
    param(
        [string]$Title,
        [string]$Body,
        [string[]]$Labels
    )

    $existing = gh issue list -R $Repo --state all --limit 200 --search """$Title"" in:title" --json title --jq ".[] | select(.title == ""$Title"") | .title"
    if ($existing) {
        Write-Host "Issue exists: $Title"
        return
    }

    $labelArgs = @()
    foreach ($label in $Labels) {
        $labelArgs += "--label"
        $labelArgs += $label
    }

    gh issue create -R $Repo --title $Title --body $Body @labelArgs | Out-Null
    Write-Host "Created issue: $Title"
}

Require-Gh

gh api `
  -X PATCH `
  -H "Accept: application/vnd.github+json" `
  "/repos/$Repo" `
  -f has_discussions=true | Out-Null

Write-Host "Enabled Discussions for $Repo"

Ensure-Label -Name "api-idea" -Color "0e8a16" -Description "Community proposals for new APIs"
Ensure-Label -Name "connector-request" -Color "1d76db" -Description "Requests for new connected-account providers"
Ensure-Label -Name "review-support" -Color "fbca04" -Description "Beta API review submissions"
Ensure-Label -Name "community-api" -Color "b60205" -Description "Community API examples"
Ensure-Label -Name "bug" -Color "d73a4a" -Description "Something isn't working"
Ensure-Label -Name "launch" -Color "5319e7" -Description "Launch prep and operations"

Ensure-Issue `
  -Title "[Launch] Public beta launch checklist" `
  -Body "Track final repo setup, Discussions enablement, labels, seed issues, and first community responses." `
  -Labels @("launch")

Ensure-Issue `
  -Title "[Example] X Publisher for Siglume" `
  -Body "Implement the X Publisher sample into a reviewable beta-ready API." `
  -Labels @("community-api")

Ensure-Issue `
  -Title "[Example] Visual Publisher" `
  -Body "Implement image generation plus posting workflow with dry-run and approval." `
  -Labels @("community-api")

Ensure-Issue `
  -Title "[Example] MetaMask Connector" `
  -Body "Start with balance, quote, and approval-safe flow before signed transaction execution." `
  -Labels @("community-api")

Ensure-Issue `
  -Title "[Docs] Report onboarding friction in GETTING_STARTED" `
  -Body "Use this issue to collect installation and first-run problems from early developers." `
  -Labels @("launch")

Write-Host "Community launch bootstrap complete."
