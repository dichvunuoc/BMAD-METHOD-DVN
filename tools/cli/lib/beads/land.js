const { BeadsStore } = require('./store');
const { acquireLock, releaseLock } = require('./lock');

/**
 * "Land the Plane" protocol:
 * - Acquire lock (to serialize multi-agent writes)
 * - Ensure DB exists and is valid
 * - Compact/normalize DB (atomic write)
 * - Release lock
 *
 * @param {Object} options
 * @param {string} options.dbPath
 * @param {string} options.lockPath
 * @param {string} options.lockName
 * @param {number} options.ttlMs
 */
async function landThePlane({ dbPath, lockPath, lockName, ttlMs }) {
  const store = new BeadsStore(dbPath);
  const lock = await acquireLock({ lockPath, name: lockName, ttlMs });

  try {
    await store.init();
    const db = await store.compact({ maxJournalEntries: 5000 });
    return { lock, db };
  } finally {
    await releaseLock({ lockPath, owner: lock.owner, force: false });
  }
}

module.exports = { landThePlane };
