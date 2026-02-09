/**
 * Create ZIP file for Table Quantities distribution
 *
 * Usage:
 *   node scripts/build-zip.js              - Create unversioned ZIP
 *   node scripts/build-zip.js --version    - Create versioned ZIP
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const args = process.argv.slice(2);
const USE_VERSION = args.includes('--version');

const ROOT_DIR = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const PACKAGE_NAME = 'table-quantities';

function getVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
  return pkg.version;
}

function createZip(sourceDir, outputPath) {
  const originalDir = process.cwd();
  process.chdir(DIST_DIR);

  try {
    if (process.platform === 'win32') {
      execSync(`powershell Compress-Archive -Path "${PACKAGE_NAME}" -DestinationPath "${path.basename(outputPath)}" -Force`, {
        stdio: 'pipe'
      });
    } else {
      execSync(`zip -r "${path.basename(outputPath)}" "${PACKAGE_NAME}"`, {
        stdio: 'pipe'
      });
    }
  } finally {
    process.chdir(originalDir);
  }

  const stats = fs.statSync(outputPath);
  const sizeKB = (stats.size / 1024).toFixed(1);
  console.log(`  Created ${path.basename(outputPath)} (${sizeKB} KB)`);
}

function main() {
  console.log('');
  console.log('Creating ZIP...');
  console.log('');

  if (!fs.existsSync(path.join(DIST_DIR, PACKAGE_NAME))) {
    console.error('dist/table-quantities/ not found. Run "npm run build" first.');
    process.exit(1);
  }

  const version = getVersion();
  const zipName = USE_VERSION
    ? `${PACKAGE_NAME}-v${version}.zip`
    : `${PACKAGE_NAME}.zip`;
  const outputPath = path.join(DIST_DIR, zipName);

  createZip(path.join(DIST_DIR, PACKAGE_NAME), outputPath);

  console.log('');
  console.log('ZIP created successfully.');
  console.log('');
}

main();
