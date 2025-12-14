const path = require('node:path');
const fs = require('fs-extra');

/**
 * Locate an installed BMAD folder by scanning upwards for a directory that contains:
 *   <bmadDir>/_config/manifest.yaml  (v6+)
 * or legacy:
 *   <bmadDir>/_cfg/manifest.yaml
 *
 * BMAD v6 supports arbitrary folder names, so we scan sibling directories.
 *
 * @param {string} startDir
 * @returns {Promise<{ projectDir: string, bmadDir: string, bmadFolderName: string }|null>}
 */
async function findInstalledBmadDir(startDir) {
  let currentDir = path.resolve(startDir || '.');
  const root = path.parse(currentDir).root;

  while (true) {
    let entries = [];
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      entries = [];
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue;

      const candidateDir = path.join(currentDir, entry.name);
      const manifestV6 = path.join(candidateDir, '_config', 'manifest.yaml');
      const manifestLegacy = path.join(candidateDir, '_cfg', 'manifest.yaml');

      if ((await fs.pathExists(manifestV6)) || (await fs.pathExists(manifestLegacy))) {
        return {
          projectDir: currentDir,
          bmadDir: candidateDir,
          bmadFolderName: entry.name,
        };
      }
    }

    if (currentDir === root) {
      return null;
    }
    currentDir = path.dirname(currentDir);
  }
}

/**
 * Resolve Beads paths for an installed project.
 *
 * @param {Object} options
 * @param {string} options.directory
 * @param {string|null|undefined} options.dbPathOverride
 */
async function resolveBeadsPaths({ directory, dbPathOverride }) {
  if (dbPathOverride && typeof dbPathOverride === 'string' && dbPathOverride.trim().length > 0) {
    const dbPath = path.resolve(directory || '.', dbPathOverride);
    const dbDir = path.dirname(dbPath);
    return {
      projectDir: path.resolve(directory || '.'),
      bmadDir: null,
      bmadFolderName: null,
      beadsDir: dbDir,
      dbPath,
      lockPath: path.join(dbDir, '.beads.lock'),
    };
  }

  const installed = await findInstalledBmadDir(directory || '.');
  if (!installed) {
    return {
      projectDir: path.resolve(directory || '.'),
      bmadDir: null,
      bmadFolderName: null,
      beadsDir: null,
      dbPath: null,
      lockPath: null,
    };
  }

  const beadsDir = path.join(installed.bmadDir, '_beads');
  return {
    ...installed,
    beadsDir,
    dbPath: path.join(beadsDir, 'beads.json'),
    lockPath: path.join(beadsDir, '.beads.lock'),
  };
}

module.exports = {
  findInstalledBmadDir,
  resolveBeadsPaths,
};
