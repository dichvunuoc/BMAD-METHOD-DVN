const path = require('node:path');
const fs = require('fs-extra');

const CURRENT_SCHEMA_VERSION = 1;

function createEmptyDb() {
  const now = new Date().toISOString();
  return {
    version: CURRENT_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    namespaces: {},
    journal: [],
  };
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeDbShape(db) {
  if (!isPlainObject(db)) return createEmptyDb();

  const now = new Date().toISOString();
  const normalized = {
    version: typeof db.version === 'number' ? db.version : CURRENT_SCHEMA_VERSION,
    createdAt: typeof db.createdAt === 'string' ? db.createdAt : now,
    updatedAt: typeof db.updatedAt === 'string' ? db.updatedAt : now,
    namespaces: isPlainObject(db.namespaces) ? db.namespaces : {},
    journal: Array.isArray(db.journal) ? db.journal : [],
  };

  // Ensure each namespace is an object.
  for (const [ns, value] of Object.entries(normalized.namespaces)) {
    if (!isPlainObject(value)) {
      normalized.namespaces[ns] = {};
    }
  }

  return normalized;
}

function tryParseJson(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

async function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  await fs.ensureDir(dir);

  const tempPath = path.join(dir, `.tmp-${path.basename(filePath)}-${process.pid}-${Date.now()}`);
  const json = JSON.stringify(data, null, 2) + '\n';

  await fs.writeFile(tempPath, json, 'utf8');
  await fs.move(tempPath, filePath, { overwrite: true });
}

class BeadsStore {
  /**
   * @param {string} dbPath
   */
  constructor(dbPath) {
    this.dbPath = dbPath;
  }

  async init() {
    if (!this.dbPath) throw new Error('Beads DB path is not set');
    if (await fs.pathExists(this.dbPath)) {
      // Validate it can be parsed; if not, keep a backup and re-init.
      try {
        const raw = await fs.readFile(this.dbPath, 'utf8');
        normalizeDbShape(JSON.parse(raw));
        return { created: false, path: this.dbPath };
      } catch {
        const backup = `${this.dbPath}.bak-${Date.now()}`;
        await fs.copy(this.dbPath, backup);
      }
    }

    const emptyDb = createEmptyDb();
    await writeJsonAtomic(this.dbPath, emptyDb);
    return { created: true, path: this.dbPath };
  }

  async read() {
    if (!this.dbPath) throw new Error('Beads DB path is not set');
    if (!(await fs.pathExists(this.dbPath))) {
      await this.init();
    }
    const raw = await fs.readFile(this.dbPath, 'utf8');
    const parsed = normalizeDbShape(JSON.parse(raw));
    return parsed;
  }

  async write(db) {
    if (!this.dbPath) throw new Error('Beads DB path is not set');
    const normalized = normalizeDbShape(db);
    normalized.updatedAt = new Date().toISOString();
    await writeJsonAtomic(this.dbPath, normalized);
    return normalized;
  }

  async get(namespace, key) {
    const db = await this.read();
    const ns = db.namespaces[namespace] || {};
    return Object.prototype.hasOwnProperty.call(ns, key) ? ns[key] : null;
  }

  async set(namespace, key, value, meta = {}) {
    const db = await this.read();
    if (!db.namespaces[namespace]) db.namespaces[namespace] = {};

    const now = new Date().toISOString();
    const parsed = tryParseJson(value);
    db.namespaces[namespace][key] = parsed;
    db.journal.push({
      ts: now,
      op: 'set',
      namespace,
      key,
      meta: isPlainObject(meta) ? meta : {},
    });

    const written = await this.write(db);
    return { namespace, key, value: written.namespaces[namespace][key] };
  }

  async append(namespace, key, value, meta = {}) {
    const db = await this.read();
    if (!db.namespaces[namespace]) db.namespaces[namespace] = {};

    const now = new Date().toISOString();
    const parsed = tryParseJson(value);

    const existing = db.namespaces[namespace][key];
    if (!Array.isArray(existing)) {
      db.namespaces[namespace][key] = [];
    }
    db.namespaces[namespace][key].push({
      ts: now,
      value: parsed,
      meta: isPlainObject(meta) ? meta : {},
    });
    db.journal.push({
      ts: now,
      op: 'append',
      namespace,
      key,
      meta: isPlainObject(meta) ? meta : {},
    });

    const written = await this.write(db);
    return { namespace, key, value: written.namespaces[namespace][key] };
  }

  async list(namespace, { prefix = null } = {}) {
    const db = await this.read();
    const ns = db.namespaces[namespace] || {};
    const keys = Object.keys(ns).sort();
    return prefix ? keys.filter((k) => k.startsWith(prefix)) : keys;
  }

  async compact({ maxJournalEntries = 5000 } = {}) {
    const db = await this.read();

    // Keep journal bounded so the DB doesn't grow forever.
    if (db.journal.length > maxJournalEntries) {
      db.journal = db.journal.slice(-maxJournalEntries);
    }

    // Normalize namespaces ordering by rewriting through JSON stringify.
    const normalized = normalizeDbShape(db);
    normalized.updatedAt = new Date().toISOString();
    await writeJsonAtomic(this.dbPath, normalized);
    return normalized;
  }
}

module.exports = {
  BeadsStore,
  createEmptyDb,
  normalizeDbShape,
};
