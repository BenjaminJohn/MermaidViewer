const fs = require("fs");
const path = require("path");

const projectRoot = process.cwd();
const outRoot = path.join(projectRoot, "out", "controls");
const controlName = process.env.PCF_HARNESS_CONTROL || "MermaidViewer";
const sourceDir = path.join(outRoot, controlName);

if (!fs.existsSync(sourceDir)) {
  console.error(`[ensure-harness-assets] Source control folder not found: ${sourceDir}`);
  process.exit(1);
}

const filesToCopy = [
  "ControlManifest.xml",
  "bundle.js",
  "bundle.js.LICENSE.txt",
];

const copyFiles = (targetDir) => {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const file of filesToCopy) {
    const from = path.join(sourceDir, file);
    const to = path.join(targetDir, file);
    if (fs.existsSync(from)) {
      fs.copyFileSync(from, to);
    }
  }
  const stringsSrc = path.join(sourceDir, "strings");
  const stringsDst = path.join(targetDir, "strings");
  if (fs.existsSync(stringsSrc)) {
    fs.rmSync(stringsDst, { recursive: true, force: true });
    fs.mkdirSync(stringsDst, { recursive: true });
    for (const entry of fs.readdirSync(stringsSrc)) {
      fs.copyFileSync(path.join(stringsSrc, entry), path.join(stringsDst, entry));
    }
  }
};

// Copy to out/controls (expected default)
copyFiles(outRoot);

// Also copy to out/controls/ControlManifest.xml directory in case the harness
// incorrectly uses a file path as baseDir.
const harnessDir = path.join(outRoot, "ControlManifest.xml");
try {
  if (fs.existsSync(harnessDir) && !fs.statSync(harnessDir).isDirectory()) {
    fs.unlinkSync(harnessDir);
  }
} catch {
  // ignore
}
copyFiles(harnessDir);

console.log(`[ensure-harness-assets] Copied harness assets for ${controlName}`);
