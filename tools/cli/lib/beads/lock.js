const fs = require('fs-extra');
const fsp = require('node:fs/promises');
const path = require('node:path');

function nowMs() {
  return Date.now();
}

function createOwnerId() {
  // Good enough for advisory lock identity; avoids extra deps.
  return `${process.pid}-${nowMs()}-${Math.random().toString(16).slice(2)}`;
}

async function readLock(lockPath) {
  if (!(await fs.pathExists(lockPath))) return null;
  try {
    const raw = await fs.readFile(lockPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { corrupted: true };
  }
}

async function writeLock(lockPath, payload) {
  const json = JSON.stringify(payload, null, 2) + '\n';
  await fs.ensureDir(path.dirname(lockPath));
  await fs.writeFile(lockPath, json, 'utf8');
}

/**
 * Acquire an advisory lock by atomically creating a lock file.
 *
 * @param {Object} options
 * @param {string} options.lockPath
 * @param {string} options.name
 * @param {number} options.ttlMs
 * @returns {Promise<{ owner: string, lockPath: string, name: string, expiresAt: string }>}
 */
async function acquireLock({ lockPath, name, ttlMs }) {
  const owner = createOwnerId();
  const expiresAtMs = nowMs() + ttlMs;
  const payload = {
    name,
    owner,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    ttlMs,
  };

  // First attempt: atomic create via open('wx').
  try {
    const handle = await fsp.open(lockPath, 'wx');
    await handle.writeFile(JSON.stringify(payload, null, 2) + '\n', 'utf8');
    await handle.close();
    return { owner, lockPath, name, expiresAt: payload.expiresAt };
  } catch (error) {
    // If exists, check expiry and try to steal if expired.
    if (error && (error.code === 'EEXIST' || error.code === 'EACCES')) {
      const existing = await readLock(lockPath);
      // If lock is corrupted/empty, treat as stale and steal.
      if (!existing || existing.corrupted) {
        await fs.remove(lockPath);
        const handle2 = await fsp.open(lockPath, 'wx');
        await handle2.writeFile(JSON.stringify(payload, null, 2) + '\n', 'utf8');
        await handle2.close();
        return { owner, lockPath, name, expiresAt: payload.expiresAt };
      }

      if (existing && existing.expiresAt) {
        const existingExpires = Date.parse(existing.expiresAt);
        if (!Number.isNaN(existingExpires) && existingExpires < nowMs()) {
          // Expired lock: remove and retry once.
          await fs.remove(lockPath);
          const handle2 = await fsp.open(lockPath, 'wx');
          await handle2.writeFile(JSON.stringify(payload, null, 2) + '\n', 'utf8');
          await handle2.close();
          return { owner, lockPath, name, expiresAt: payload.expiresAt };
        }
      }
    }
    throw error;
  }
}

/**
 * Release an advisory lock.
 *
 * @param {Object} options
 * @param {string} options.lockPath
 * @param {string} options.owner
 * @param {boolean} [options.force]
 */
async function releaseLock({ lockPath, owner, force = false }) {
  if (!(await fs.pathExists(lockPath))) return { released: false, reason: 'missing' };

  const existing = await readLock(lockPath);
  if (!force && existing && existing.owner && owner && existing.owner !== owner) {
    return { released: false, reason: 'owner-mismatch', currentOwner: existing.owner };
  }

  await fs.remove(lockPath);
  return { released: true };
}

module.exports = {
  acquireLock,
  releaseLock,
  readLock,
  writeLock,
};
