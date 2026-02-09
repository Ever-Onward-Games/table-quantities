/**
 * Build script for Table Quantities
 * Copies module files to dist/table-quantities/ for packaging.
 *
 * Usage: node scripts/build.js
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const PACKAGE_DIR = path.join(DIST_DIR, 'table-quantities');

// Files and directories to include in the distribution
const INCLUDE = [
  'module.json',
  'scripts',
  'lang',
  'LICENSE'
];

/**
 * Recursively copy a directory
 */
function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Main build
 */
function main() {
  console.log('');
  console.log('Building Table Quantities...');
  console.log('');

  // Clean dist
  if (fs.existsSync(PACKAGE_DIR)) {
    fs.rmSync(PACKAGE_DIR, { recursive: true });
  }
  fs.mkdirSync(PACKAGE_DIR, { recursive: true });

  // Copy files
  for (const item of INCLUDE) {
    const src = path.join(ROOT_DIR, item);
    const dest = path.join(PACKAGE_DIR, item);

    if (!fs.existsSync(src)) {
      console.log(`  Skipping ${item} (not found)`);
      continue;
    }

    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
      copyDirSync(src, dest);
      console.log(`  Copied ${item}/`);
    } else {
      fs.copyFileSync(src, dest);
      console.log(`  Copied ${item}`);
    }
  }

  // Sync docs/module.json
  const srcManifest = path.join(ROOT_DIR, 'module.json');
  const docsManifest = path.join(ROOT_DIR, 'docs', 'module.json');
  fs.mkdirSync(path.join(ROOT_DIR, 'docs'), { recursive: true });
  fs.copyFileSync(srcManifest, docsManifest);
  console.log('  Synced docs/module.json');

  console.log('');
  console.log('Build complete: dist/table-quantities/');
  console.log('');
}

main();
