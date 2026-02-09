/**
 * Sync Versions
 * Updates module.json version to match root package.json
 *
 * Usage: node scripts/sync-versions.js [version]
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');

function syncVersions(targetVersion) {
  console.log('Syncing versions...');

  const rootPkgPath = path.join(ROOT_DIR, 'package.json');
  const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));
  const version = targetVersion || rootPkg.version;

  console.log(`  Target version: ${version}`);

  // Update root package.json if a target was specified
  if (targetVersion && rootPkg.version !== version) {
    rootPkg.version = version;
    fs.writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 2) + '\n');
    console.log(`  Updated package.json to ${version}`);
  }

  // Update module.json
  const moduleJsonPath = path.join(ROOT_DIR, 'module.json');
  const moduleJson = JSON.parse(fs.readFileSync(moduleJsonPath, 'utf8'));
  if (moduleJson.version !== version) {
    moduleJson.version = version;
    fs.writeFileSync(moduleJsonPath, JSON.stringify(moduleJson, null, 2) + '\n');
    console.log(`  Updated module.json to ${version}`);
  } else {
    console.log(`  module.json already at ${version}`);
  }

  // Update docs/module.json
  const docsJsonPath = path.join(ROOT_DIR, 'docs', 'module.json');
  if (fs.existsSync(docsJsonPath)) {
    const docsJson = JSON.parse(fs.readFileSync(docsJsonPath, 'utf8'));
    if (docsJson.version !== version) {
      docsJson.version = version;
      fs.writeFileSync(docsJsonPath, JSON.stringify(docsJson, null, 2) + '\n');
      console.log(`  Updated docs/module.json to ${version}`);
    } else {
      console.log(`  docs/module.json already at ${version}`);
    }
  }

  console.log('');
  console.log(`All versions synced to ${version}`);
}

const targetVersion = process.argv[2];
syncVersions(targetVersion);
