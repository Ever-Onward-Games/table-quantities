/**
 * Bump to the next beta version
 *
 * Usage: npm run version:bump-beta
 *
 * This script:
 * 1. Reads the current version from root package.json
 * 2. Increments the beta number (e.g., 1.0.0-beta.1 -> 1.0.0-beta.2)
 * 3. Syncs the new version across all files
 * 4. Updates CHANGELOG.md with new version header
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..');
const ROOT_PKG_PATH = path.join(ROOT_DIR, 'package.json');
const CHANGELOG_PATH = path.join(ROOT_DIR, 'CHANGELOG.md');

function incrementBetaVersion(version) {
  const betaMatch = version.match(/^(\d+\.\d+\.\d+)-beta\.(\d+)$/);

  if (!betaMatch) {
    console.error(`Current version "${version}" is not a beta version`);
    console.error('Beta versions should follow format: X.Y.Z-beta.N');
    process.exit(1);
  }

  const baseVersion = betaMatch[1];
  const betaNumber = parseInt(betaMatch[2], 10);
  return `${baseVersion}-beta.${betaNumber + 1}`;
}

function updateChangelog(newVersion) {
  if (!fs.existsSync(CHANGELOG_PATH)) {
    console.log('  No CHANGELOG.md found, skipping.');
    return;
  }

  let changelog = fs.readFileSync(CHANGELOG_PATH, 'utf8');
  const versionHeaderPattern = /^## Version /m;
  const match = changelog.match(versionHeaderPattern);

  if (!match) {
    console.log('  Could not find version header in CHANGELOG.md, skipping.');
    return;
  }

  const insertPosition = match.index;
  const newHeader = `## Version ${newVersion}\n\n### Changes\n- TBD\n\n`;
  changelog = changelog.slice(0, insertPosition) + newHeader + changelog.slice(insertPosition);

  fs.writeFileSync(CHANGELOG_PATH, changelog, 'utf8');
  console.log(`  Added ${newVersion} to CHANGELOG.md`);
}

function main() {
  console.log('');
  console.log('Bumping beta version...');
  console.log('');

  const rootPkg = JSON.parse(fs.readFileSync(ROOT_PKG_PATH, 'utf8'));
  const currentVersion = rootPkg.version;
  const newVersion = incrementBetaVersion(currentVersion);

  console.log(`  Current version: ${currentVersion}`);
  console.log(`  New version:     ${newVersion}`);
  console.log('');

  // Update root package.json
  rootPkg.version = newVersion;
  fs.writeFileSync(ROOT_PKG_PATH, JSON.stringify(rootPkg, null, 2) + '\n');
  console.log('  Updated package.json');

  // Sync all version files
  execSync('node scripts/sync-versions.js', { cwd: ROOT_DIR, stdio: 'inherit' });

  // Update changelog
  updateChangelog(newVersion);

  console.log('');
  console.log(`Bumped to ${newVersion}`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Update CHANGELOG.md with your changes');
  console.log(`  2. Commit: git add . && git commit -m "Bump version to ${newVersion}"`);
  console.log(`  3. Tag and push: git tag v${newVersion} && git push && git push --tags`);
  console.log('');
}

main();
