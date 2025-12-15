const chalk = require('chalk');
const path = require('node:path');
const fs = require('fs-extra');

const { resolveBeadsPaths } = require('../lib/beads/paths');
const { BeadsStore } = require('../lib/beads/store');
const { acquireLock, releaseLock, readLock } = require('../lib/beads/lock');
const { landThePlane } = require('../lib/beads/land');
const yaml = require('yaml');

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function parseJsonOption(value, label) {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${label} must be valid JSON: ${error.message}`);
  }
}

async function resolveOrDefaultPaths(options) {
  const resolved = await resolveBeadsPaths({
    directory: options.directory,
    dbPathOverride: options.db,
  });

  if (resolved.dbPath) return resolved;

  // Fallback: if BMAD isn't installed yet, assume a conventional folder name.
  const projectDir = path.resolve(options.directory || '.');
  const beadsDir = path.join(projectDir, '_bmad', '_beads');
  return {
    projectDir,
    bmadDir: path.join(projectDir, '_bmad'),
    bmadFolderName: '_bmad',
    beadsDir,
    dbPath: path.join(beadsDir, 'beads.json'),
    lockPath: path.join(beadsDir, '.beads.lock'),
  };
}

module.exports = {
  command: 'beads <op> [args...]',
  description: 'Beads: identity memory store (init/get/set/append/query/lock/unlock/land/import-story/export-story/export-sprint-status)',
  options: [
    ['-d, --directory <path>', 'Project directory', '.'],
    ['--db <path>', 'Override Beads DB path (relative to --directory)'],
    ['--json', 'Output machine-readable JSON'],
    ['--name <lockName>', 'Lock name for lock/land (default: plane)', 'plane'],
    ['--ttl <seconds>', 'Lock TTL seconds for lock/land (default: 600)', '600'],
    ['--meta <json>', 'Optional metadata JSON for set/append (default: {})'],
    ['--out <path>', 'Output file path for export operations (relative to --directory)'],
  ],
  action: async (op, args, options) => {
    try {
      const paths = await resolveOrDefaultPaths(options);
      const ttlMs = Number(options.ttl) * 1000;
      const meta = parseJsonOption(options.meta, '--meta');

      // Ensure directory exists for init, lock, land operations.
      if (paths.beadsDir) {
        await fs.ensureDir(paths.beadsDir);
      }

      const store = new BeadsStore(paths.dbPath);

      switch (op) {
        case 'init': {
          const result = await store.init();
          if (options.json) {
            printJson({ ...result, dbPath: paths.dbPath, beadsDir: paths.beadsDir });
            return;
          }
          console.log(chalk.cyan('\nBeads initialized'));
          console.log(chalk.bold('DB:'), paths.dbPath);
          console.log(chalk.bold('Created:'), result.created ? chalk.green('yes') : chalk.dim('no (already exists)'));
          return;
        }

        case 'get': {
          const [namespace, key] = args;
          if (!namespace || !key) throw new Error('Usage: bmad beads get <namespace> <key>');
          const value = await store.get(namespace, key);
          if (options.json) return printJson({ namespace, key, value });
          console.log(value === null ? chalk.dim('(null)') : typeof value === 'string' ? value : JSON.stringify(value, null, 2));
          return;
        }

        case 'set': {
          const [namespace, key, ...rest] = args;
          if (!namespace || !key || rest.length === 0) throw new Error('Usage: bmad beads set <namespace> <key> <value>');
          const value = rest.join(' ');
          const result = await store.set(namespace, key, value, meta);
          if (options.json) return printJson(result);
          console.log(chalk.green('✓'), `set ${namespace}.${key}`);
          return;
        }

        case 'append': {
          const [namespace, key, ...rest] = args;
          if (!namespace || !key || rest.length === 0) throw new Error('Usage: bmad beads append <namespace> <key> <value>');
          const value = rest.join(' ');
          const result = await store.append(namespace, key, value, meta);
          if (options.json) return printJson(result);
          console.log(chalk.green('✓'), `append ${namespace}.${key}`);
          return;
        }

        case 'query': {
          const [namespace, prefix] = args;
          if (!namespace) throw new Error('Usage: bmad beads query <namespace> [prefix]');
          const keys = await store.list(namespace, { prefix: prefix || null });
          if (options.json) return printJson({ namespace, keys });
          if (keys.length === 0) {
            console.log(chalk.dim('(no keys)'));
            return;
          }
          console.log(keys.join('\n'));
          return;
        }

        case 'lock': {
          const lock = await acquireLock({ lockPath: paths.lockPath, name: options.name, ttlMs });
          if (options.json) return printJson(lock);
          console.log(chalk.cyan('🔒 Beads lock acquired'));
          console.log(chalk.bold('Name:'), lock.name);
          console.log(chalk.bold('Owner:'), lock.owner);
          console.log(chalk.bold('Expires:'), lock.expiresAt);
          console.log(chalk.dim(`Lock file: ${paths.lockPath}`));
          return;
        }

        case 'unlock': {
          const current = await readLock(paths.lockPath);
          const force = args.includes('--force');
          const owner = args.find((a) => a.startsWith('owner='))?.slice('owner='.length) || (current ? current.owner : null);
          const result = await releaseLock({ lockPath: paths.lockPath, owner, force });
          if (options.json) return printJson({ ...result, lockPath: paths.lockPath });
          if (result.released) {
            console.log(chalk.green('🔓 Beads lock released'));
          } else {
            console.log(chalk.yellow('⚠️  Lock not released:'), result.reason);
            if (result.currentOwner) console.log(chalk.dim(`Current owner: ${result.currentOwner}`));
          }
          return;
        }

        case 'land': {
          const result = await landThePlane({
            dbPath: paths.dbPath,
            lockPath: paths.lockPath,
            lockName: options.name,
            ttlMs,
          });
          if (options.json)
            return printJson({ ok: true, lock: result.lock, db: { updatedAt: result.db.updatedAt, version: result.db.version } });
          console.log(chalk.cyan('🛬 Land the Plane complete'));
          console.log(chalk.bold('DB:'), paths.dbPath);
          console.log(chalk.bold('updatedAt:'), result.db.updatedAt);
          return;
        }

        case 'import-story': {
          const [storyKey, inputPath] = args;
          if (!storyKey || !inputPath) {
            throw new Error('Usage: bmad beads import-story <story_key> <path-to-story-md>');
          }

          const absoluteInput = path.resolve(options.directory || '.', inputPath);
          const content = await fs.readFile(absoluteInput, 'utf8');
          const result = await store.set('stories', storyKey, content, { ...meta, importedFrom: inputPath });

          if (options.json) return printJson({ ok: true, storyKey, importedFrom: inputPath, ...result });
          console.log(chalk.green('✓'), `Imported story ${storyKey} from ${inputPath} into Beads namespace stories`);
          return;
        }

        case 'export-story': {
          const [storyKey] = args;
          if (!storyKey) {
            throw new Error('Usage: bmad beads export-story <story_key> --out <path>');
          }
          if (!options.out) {
            throw new Error('export-story requires --out <path>');
          }

          const value = await store.get('stories', storyKey);
          if (value === null) {
            throw new Error(`Story "${storyKey}" not found in Beads (namespace "stories")`);
          }

          const absoluteOut = path.resolve(options.directory || '.', options.out);
          await fs.ensureDir(path.dirname(absoluteOut));
          await fs.writeFile(absoluteOut, typeof value === 'string' ? value : JSON.stringify(value, null, 2), 'utf8');

          if (options.json) return printJson({ ok: true, storyKey, out: options.out });
          console.log(chalk.green('✓'), `Exported story ${storyKey} to ${options.out}`);
          return;
        }

        case 'export-sprint-status': {
          if (!options.out) {
            throw new Error('export-sprint-status requires --out <path>');
          }

          const sprint = await store.get('sprint', 'development_status');
          const developmentStatus = sprint && typeof sprint === 'object' ? sprint : {};

          const data = {
            generated: new Date().toISOString().slice(0, 16).replace('T', ' '),
            tracking_system: 'beads',
            development_status: developmentStatus,
          };

          const absoluteOut = path.resolve(options.directory || '.', options.out);
          await fs.ensureDir(path.dirname(absoluteOut));
          await fs.writeFile(absoluteOut, yaml.stringify(data, { indent: 2, lineWidth: 0 }), 'utf8');

          if (options.json) return printJson({ ok: true, out: options.out, storyCount: Object.keys(developmentStatus).length });
          console.log(chalk.green('✓'), `Exported sprint status to ${options.out}`);
          return;
        }

        default: {
          throw new Error(
            `Unknown beads op "${op}". Supported: init, get, set, append, query, lock, unlock, land, import-story, export-story, export-sprint-status`,
          );
        }
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  },
};
