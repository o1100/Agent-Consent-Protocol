import fs from 'node:fs';
import path from 'node:path';

export interface StartLock {
  release(): void;
}

interface StartLockOptions {
  currentPid?: number;
  lockDir?: string;
  isProcessAlive?: (pid: number) => boolean;
  readProcessCmdline?: (pid: number) => string;
}

const DEFAULT_LOCK_DIR = '/tmp';

export function getStartLockPath(runAsUsername: string, lockDir = DEFAULT_LOCK_DIR): string {
  const safeUsername = runAsUsername.replace(/[^a-zA-Z0-9_.-]/g, '_');
  return path.join(lockDir, `acp-start-openclaw-${safeUsername}.pid`);
}

export function acquireStartLock(runAsUsername: string, options: StartLockOptions = {}): StartLock {
  const currentPid = options.currentPid ?? process.pid;
  const lockPath = getStartLockPath(runAsUsername, options.lockDir);
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  const readProcessCmdline = options.readProcessCmdline ?? defaultReadProcessCmdline;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(lockPath, 'wx', 0o600);
      fs.writeFileSync(fd, `${currentPid}\n`, 'utf-8');
      fs.closeSync(fd);
      let released = false;
      return {
        release: () => {
          if (released) return;
          released = true;
          releaseStartLock(lockPath, currentPid);
        },
      };
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code !== 'EEXIST') {
        throw err;
      }

      const existingPid = readLockPid(lockPath);
      if (existingPid !== null && isStartProcessRunning(existingPid, runAsUsername, isProcessAlive, readProcessCmdline)) {
        throw new Error(
          `ACP openclaw is already running (pid ${existingPid}) for user ${runAsUsername}. Stop it before starting another instance.`
        );
      }
      try {
        fs.unlinkSync(lockPath);
      } catch {
        // Best effort cleanup for stale lock files.
      }
    }
  }

  throw new Error(`Unable to acquire ACP start lock at ${lockPath}`);
}

function releaseStartLock(lockPath: string, expectedPid: number): void {
  try {
    const lockPid = readLockPid(lockPath);
    if (lockPid !== expectedPid) return;
    fs.unlinkSync(lockPath);
  } catch {
    // Best effort cleanup.
  }
}

function readLockPid(lockPath: string): number | null {
  try {
    const raw = fs.readFileSync(lockPath, 'utf-8').trim();
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isStartProcessRunning(
  pid: number,
  runAsUsername: string,
  isProcessAlive: (pid: number) => boolean,
  readProcessCmdline: (pid: number) => string,
): boolean {
  if (!isProcessAlive(pid)) return false;

  const cmdline = readProcessCmdline(pid);
  if (!cmdline) return true;

  return cmdline.includes('acp start openclaw')
    || (
      cmdline.includes('/usr/bin/acp')
      && cmdline.includes('start')
      && cmdline.includes('openclaw')
      && cmdline.includes(`--openclaw-user=${runAsUsername}`)
    );
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    return error.code !== 'ESRCH';
  }
}

function defaultReadProcessCmdline(pid: number): string {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf-8').replace(/\u0000/g, ' ').trim();
  } catch {
    return '';
  }
}
