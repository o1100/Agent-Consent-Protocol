import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireStartLock, getStartLockPath } from '../vm/start-lock.js';

describe('start lock', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-start-lock-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates and removes lock for the current process', () => {
    const lockPath = getStartLockPath('openclaw', tmpDir);
    const lock = acquireStartLock('openclaw', {
      currentPid: 30001,
      lockDir: tmpDir,
      isProcessAlive: () => false,
      readProcessCmdline: () => '',
    });

    assert.strictEqual(fs.readFileSync(lockPath, 'utf-8').trim(), '30001');

    lock.release();
    assert.strictEqual(fs.existsSync(lockPath), false);
  });

  it('rejects second start when a matching process is active', () => {
    const lock = acquireStartLock('openclaw', {
      currentPid: 30011,
      lockDir: tmpDir,
      isProcessAlive: (pid) => pid === 30011,
      readProcessCmdline: () => '/usr/bin/acp start openclaw --openclaw-user=openclaw',
    });

    assert.throws(() => {
      acquireStartLock('openclaw', {
        currentPid: 30012,
        lockDir: tmpDir,
        isProcessAlive: (pid) => pid === 30011,
        readProcessCmdline: () => '/usr/bin/acp start openclaw --openclaw-user=openclaw',
      });
    }, /already running \(pid 30011\)/);

    lock.release();
  });

  it('replaces stale lock when owning process is gone', () => {
    const lockPath = getStartLockPath('openclaw', tmpDir);
    fs.writeFileSync(lockPath, '39999\n', 'utf-8');

    const lock = acquireStartLock('openclaw', {
      currentPid: 30021,
      lockDir: tmpDir,
      isProcessAlive: () => false,
      readProcessCmdline: () => '',
    });

    assert.strictEqual(fs.readFileSync(lockPath, 'utf-8').trim(), '30021');
    lock.release();
  });

  it('does not delete a lock that was replaced by another process', () => {
    const lockPath = getStartLockPath('openclaw', tmpDir);
    const lock = acquireStartLock('openclaw', {
      currentPid: 30031,
      lockDir: tmpDir,
      isProcessAlive: () => false,
      readProcessCmdline: () => '',
    });

    fs.writeFileSync(lockPath, '30032\n', 'utf-8');
    lock.release();

    assert.strictEqual(fs.existsSync(lockPath), true);
    assert.strictEqual(fs.readFileSync(lockPath, 'utf-8').trim(), '30032');
  });

  it('sanitizes username when building lock file path', () => {
    const lockPath = getStartLockPath('open/claw user', tmpDir);
    assert.match(lockPath, /acp-start-openclaw-open_claw_user\.pid$/);
  });

  it('treats empty cmdline as active process when pid is alive', () => {
    const lockPath = getStartLockPath('openclaw', tmpDir);
    fs.writeFileSync(lockPath, '30041\n', 'utf-8');

    assert.throws(() => {
      acquireStartLock('openclaw', {
        currentPid: 30042,
        lockDir: tmpDir,
        isProcessAlive: (pid) => pid === 30041,
        readProcessCmdline: () => '',
      });
    }, /already running \(pid 30041\)/);
  });
});
