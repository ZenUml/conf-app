import fs from 'fs';
import path from 'path';

const LOCK_FILE = path.join(process.cwd(), '.api-lock');
const LOCK_TIMEOUT_MS = 60000; // 60 seconds
const RETRY_INTERVAL_MS = 100; // 100ms initial
const MAX_RETRY_INTERVAL_MS = 2000; // 2 seconds max

interface LockInfo {
  pid: number;
  timestamp: number;
}

/**
 * Check if a process is still running
 */
function isProcessAlive(pid: number): boolean {
  try {
    // Sending signal 0 checks if process exists without actually sending a signal
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    // ESRCH means process doesn't exist
    return error.code !== 'ESRCH';
  }
}

/**
 * Acquire a file-based lock to serialize API calls across Playwright workers.
 * Uses exponential backoff with timeout protection.
 */
export async function acquireLock(): Promise<void> {
  const startTime = Date.now();
  let retryInterval = RETRY_INTERVAL_MS;

  while (true) {
    try {
      // Check if lock file exists
      if (fs.existsSync(LOCK_FILE)) {
        // Read existing lock info
        const lockData = fs.readFileSync(LOCK_FILE, 'utf-8');
        const lockInfo: LockInfo = JSON.parse(lockData);

        // Check if the process that owns the lock is still alive
        if (!isProcessAlive(lockInfo.pid)) {
          console.log(`⚠️ Removing lock from dead process PID ${lockInfo.pid}`);
          fs.unlinkSync(LOCK_FILE);
        } else if (Date.now() - lockInfo.timestamp > LOCK_TIMEOUT_MS) {
          // Check if lock is stale (older than timeout)
          console.log(`⚠️ Removing stale lock from PID ${lockInfo.pid}`);
          fs.unlinkSync(LOCK_FILE);
        } else {
          // Lock is held by active process
          if (Date.now() - startTime > LOCK_TIMEOUT_MS) {
            throw new Error(`Failed to acquire lock after ${LOCK_TIMEOUT_MS}ms`);
          }

          // Wait with exponential backoff
          await new Promise(resolve => setTimeout(resolve, retryInterval));
          retryInterval = Math.min(retryInterval * 1.5, MAX_RETRY_INTERVAL_MS);
          continue;
        }
      }

      // Try to acquire lock
      const lockInfo: LockInfo = {
        pid: process.pid,
        timestamp: Date.now()
      };

      fs.writeFileSync(LOCK_FILE, JSON.stringify(lockInfo, null, 2), { flag: 'wx' });
      console.log(`🔒 Lock acquired by PID ${process.pid}`);
      return;
    } catch (error: any) {
      // EEXIST means another process acquired the lock first
      if (error.code === 'EEXIST') {
        if (Date.now() - startTime > LOCK_TIMEOUT_MS) {
          throw new Error(`Failed to acquire lock after ${LOCK_TIMEOUT_MS}ms`);
        }

        // Wait with exponential backoff
        await new Promise(resolve => setTimeout(resolve, retryInterval));
        retryInterval = Math.min(retryInterval * 1.5, MAX_RETRY_INTERVAL_MS);
        continue;
      }

      // Other errors are unexpected
      throw error;
    }
  }
}

/**
 * Release the file-based lock.
 */
export function releaseLock(): void {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const lockData = fs.readFileSync(LOCK_FILE, 'utf-8');
      const lockInfo: LockInfo = JSON.parse(lockData);

      // Only release if we own the lock
      if (lockInfo.pid === process.pid) {
        fs.unlinkSync(LOCK_FILE);
        console.log(`🔓 Lock released by PID ${process.pid}`);
      } else {
        console.warn(`⚠️ Cannot release lock owned by PID ${lockInfo.pid}`);
      }
    }
  } catch (error) {
    console.error('Error releasing lock:', error);
  }
}

/**
 * Execute a function while holding the lock.
 * Automatically acquires and releases the lock.
 */
export async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  await acquireLock();
  try {
    return await fn();
  } finally {
    releaseLock();
  }
}
