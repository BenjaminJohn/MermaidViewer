param(
  [string]$Version,
  [int]$Major,
  [int]$Minor,
  [string]$ControlVersion,
  [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$solutionXmlPath = Join-Path $projectRoot "Solutions/src/Other/Solution.xml"
$controlManifestPaths = @(
  (Join-Path $projectRoot "MermaidViewer/ControlManifest.Input.xml"),
  (Join-Path $projectRoot "MermaidViewerMultiple/MermaidViewerMultiple/ControlManifest.Input.xml")
)
$indexPaths = @(
  (Join-Path $projectRoot "MermaidViewer/index.ts"),
  (Join-Path $projectRoot "MermaidViewerMultiple/MermaidViewerMultiple/index.ts")
)

if (-not (Test-Path $solutionXmlPath)) {
  throw "Solution.xml not found: $solutionXmlPath"
}

$solutionXml = [xml](Get-Content $solutionXmlPath)
$currentVersion = $solutionXml.ImportExportXml.SolutionManifest.Version
if (-not $currentVersion) {
  throw "Unable to read current Solution version."
}

if (-not $Version) {
  $parts = $currentVersion.Split(".")
  if (-not $Major) {
    $Major = [int]$parts[0]
  }
  if (-not $Minor) {
    $Minor = [int]$parts[1]
  }
  $now = Get-Date
  $datePart = $now.ToString("yyyyMMdd")
  $timePart = $now.ToString("HHmm")
  $Version = "$Major.$Minor.$datePart.$timePart"
}

$solutionXml.ImportExportXml.SolutionManifest.Version = $Version
$solutionXml.Save($solutionXmlPath)

$resolvedControlVersion = $null
if ($ControlVersion) {
  $resolvedControlVersion = $ControlVersion
} else {
  $cMajor = $null
  $cMinor = $null

  if ($Major -and $Minor) {
    $cMajor = $Major
    $cMinor = $Minor
  } elseif ($Version -match '^(\d+)\.(\d+)\.') {
    $cMajor = [int]$Matches[1]
    $cMinor = [int]$Matches[2]
  } else {
    $firstManifestPath = $controlManifestPaths[0]
    if (-not (Test-Path $firstManifestPath)) {
      throw "ControlManifest.Input.xml not found: $firstManifestPath"
    }
    $firstManifestXml = [xml](Get-Content $firstManifestPath)
    $currentControlVersion = $firstManifestXml.manifest.control.version
    if (-not $currentControlVersion) {
      $currentControlVersion = "1.0.1"
    }
    $cParts = $currentControlVersion.Split(".")
    if ($cParts.Length -ge 2) {
      $cMajor = [int]$cParts[0]
      $cMinor = [int]$cParts[1]
    } else {
      $cMajor = 1
      $cMinor = 0
    }
  }

  $resolvedControlVersion = "$cMajor.$cMinor.0"
}

foreach ($indexPath in $indexPaths) {
  if (-not (Test-Path $indexPath)) {
    throw "index.ts not found: $indexPath"
  }
  $indexContent = Get-Content $indexPath -Raw
  $indexUpdated = [regex]::Replace(
    $indexContent,
    '(const\s+CONTROL_VERSION\s*=\s+")[^"]+(";)',
    { param($m) "$($m.Groups[1].Value)$resolvedControlVersion$($m.Groups[2].Value)" }
  )
  Set-Content -Path $indexPath -Value $indexUpdated -Encoding UTF8
}

foreach ($manifestPath in $controlManifestPaths) {
  if (-not (Test-Path $manifestPath)) {
    throw "ControlManifest.Input.xml not found: $manifestPath"
  }

  $manifestXml = [xml](Get-Content $manifestPath)
  $controlNode = $manifestXml.manifest.control
  if (-not $controlNode) {
    throw "<control> node not found in $manifestPath"
  }

  $controlNode.SetAttribute("version", $resolvedControlVersion)
  $descriptionKey = $controlNode.GetAttribute("description-key")
  $manifestDir = Split-Path -Parent $manifestPath

  if ($descriptionKey) {
    foreach ($resxNode in $manifestXml.manifest.control.resources.resx) {
      $resxRelPath = $resxNode.path
      if (-not $resxRelPath) {
        continue
      }
      $resxAbsPath = Join-Path $manifestDir $resxRelPath
      if (-not (Test-Path $resxAbsPath)) {
        continue
      }

      $resxXml = [xml](Get-Content $resxAbsPath)
      $dataNode = $resxXml.root.data | Where-Object { $_.name -eq $descriptionKey } | Select-Object -First 1
      if (-not $dataNode) {
        continue
      }

      $valueNode = $dataNode.SelectSingleNode("value")
      if (-not $valueNode) {
        continue
      }

      $currentText = $valueNode.InnerText
      $baseText = [regex]::Replace($currentText, '\s*\(v\d+\.\d+\.\d+\)$', '')
      if (-not $baseText) {
        continue
      }
      $valueNode.InnerText = "$baseText (v$resolvedControlVersion)"
      $resxXml.Save($resxAbsPath)
    }
  }

  $manifestXml.Save($manifestPath)
}

Write-Host "Solution version set to $Version"
Write-Host "Control version set to $resolvedControlVersion"

$solutionsDir = Join-Path $projectRoot "Solutions"
$managedOut = Join-Path $solutionsDir "bin" | Join-Path -ChildPath $Configuration | Join-Path -ChildPath "MermaidViewer_managed.zip"
$unmanagedOut = Join-Path $solutionsDir "bin" | Join-Path -ChildPath $Configuration | Join-Path -ChildPath "MermaidViewer_unmanaged.zip"

Push-Location $solutionsDir
try {
  dotnet msbuild Solutions.cdsproj /t:build /p:Configuration=$Configuration /p:SolutionPackageType=Managed /p:SolutionPackageZipFilePath="$managedOut"
  dotnet msbuild Solutions.cdsproj /t:build /p:Configuration=$Configuration /p:SolutionPackageType=Unmanaged /p:SolutionPackageZipFilePath="$unmanagedOut"
} finally {
  Pop-Location
}
