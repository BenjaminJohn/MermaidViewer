# Mermaid Viewer (BenJohn)

PCF controls to render Mermaid diagrams from Dataverse text fields.

## Controls

- `MermaidViewer` (SingleLine.TextArea)
- `MermaidViewerMultiple` (Multiple)


## Local vs. Dataverse Testing

- Local testing uses the PCF harness (`npm start watch`).
- ZIP files are only for importing into Dataverse (Solutions in Power Platform).


## Build and Run (Harness)

MermaidViewer:

```powershell
cd "/Users/ben/Library/Mobile Documents/com~apple~CloudDocs/VSCode Working Folder/BenJohn/MermaidViewer"
npm run clean
npm start watch
```

MermaidViewerMultiple:

```powershell
cd "/Users/ben/Library/Mobile Documents/com~apple~CloudDocs/VSCode Working Folder/BenJohn/MermaidViewer/MermaidViewerMultiple"
npm run clean
npm start watch
```

## Build the Solution

```powershell
cd "/Users/ben/Library/Mobile Documents/com~apple~CloudDocs/VSCode Working Folder/BenJohn/MermaidViewer/Solutions"
dotnet msbuild Solutions.cdsproj /t:build /p:Configuration=Debug /p:SolutionPackageType=Unmanaged
```

If MSBuild reports an error about `out/controls/strings`, remove the root folder once:

```powershell
cd "/Users/ben/Library/Mobile Documents/com~apple~CloudDocs/VSCode Working Folder/BenJohn/MermaidViewer"
Remove-Item -Force -Recurse out/controls/strings -ErrorAction SilentlyContinue
```

## Version + Build (all-in-one)

This sets Solution version + Control versions, then builds Managed and Unmanaged packages.

```powershell
cd "/Users/ben/Library/Mobile Documents/com~apple~CloudDocs/VSCode Working Folder/BenJohn/MermaidViewer"
pwsh ./scripts/version-and-build.ps1
```

Optional (force major/minor):

```powershell
pwsh ./scripts/version-and-build.ps1 -Major 1 -Minor 0
```

Optional (explicit version):

```powershell
pwsh ./scripts/version-and-build.ps1 -Version 1.0.20260104.1800
```
