import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CredentialVault } from '../sandbox/credentials.js';
import { generateKeyPair } from '../crypto/keys.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'acp-test-'));
}

function writeKeyFile(dir: string): string {
  const kp = generateKeyPair();
  const keyPath = path.join(dir, 'private.key');
  fs.writeFileSync(keyPath, kp.privateKey);
  return keyPath;
}

describe('CredentialVault (no encryption key)', () => {
  let tmpDir: string;
  let vaultPath: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    vaultPath = path.join(tmpDir, 'vault.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('set and get a secret', () => {
    const vault = new CredentialVault(vaultPath, '/nonexistent/key');
    vault.set('API_KEY', 'secret123');
    assert.strictEqual(vault.get('API_KEY'), 'secret123');
  });

  it('list returns keys', () => {
    const vault = new CredentialVault(vaultPath, '/nonexistent/key');
    vault.set('A', '1');
    vault.set('B', '2');
    assert.deepStrictEqual(vault.list().sort(), ['A', 'B']);
  });

  it('remove a secret', () => {
    const vault = new CredentialVault(vaultPath, '/nonexistent/key');
    vault.set('X', 'val');
    assert.strictEqual(vault.remove('X'), true);
    assert.strictEqual(vault.get('X'), undefined);
    assert.strictEqual(vault.remove('X'), false);
  });

  it('has checks existence', () => {
    const vault = new CredentialVault(vaultPath, '/nonexistent/key');
    vault.set('K', 'v');
    assert.strictEqual(vault.has('K'), true);
    assert.strictEqual(vault.has('Z'), false);
  });

  it('persists to disk and reloads (v1 plaintext)', () => {
    const vault1 = new CredentialVault(vaultPath, '/nonexistent/key');
    vault1.set('PERSIST', 'value');

    const vault2 = new CredentialVault(vaultPath, '/nonexistent/key');
    assert.strictEqual(vault2.get('PERSIST'), 'value');
  });

  it('saves v1 format when no encryption key', () => {
    const vault = new CredentialVault(vaultPath, '/nonexistent/key');
    vault.set('T', 'v');
    const content = JSON.parse(fs.readFileSync(vaultPath, 'utf-8'));
    assert.strictEqual(content.version, 1);
    assert.ok(content.secrets);
  });
});

describe('CredentialVault (with encryption)', () => {
  let tmpDir: string;
  let vaultPath: string;
  let keyPath: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    vaultPath = path.join(tmpDir, 'vault.json');
    keyPath = writeKeyFile(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('encrypts vault on save', () => {
    const vault = new CredentialVault(vaultPath, keyPath);
    vault.set('SECRET', 'encrypted_value');

    const content = JSON.parse(fs.readFileSync(vaultPath, 'utf-8'));
    assert.strictEqual(content.version, 2);
    assert.strictEqual(content.encryption, 'aes-256-gcm');
    assert.ok(content.iv);
    assert.ok(content.data);
    assert.ok(content.tag);
    // data should NOT contain plaintext
    assert.ok(!content.data.includes('encrypted_value'));
  });

  it('round-trips encrypted secrets', () => {
    const vault1 = new CredentialVault(vaultPath, keyPath);
    vault1.set('KEY1', 'value1');
    vault1.set('KEY2', 'value2');

    const vault2 = new CredentialVault(vaultPath, keyPath);
    assert.strictEqual(vault2.get('KEY1'), 'value1');
    assert.strictEqual(vault2.get('KEY2'), 'value2');
    assert.deepStrictEqual(vault2.list().sort(), ['KEY1', 'KEY2']);
  });

  it('migrates v1 plaintext to v2 encrypted on load', () => {
    // Write a v1 vault manually
    const v1Data = { version: 1, secrets: { OLD_SECRET: 'old_value' } };
    fs.writeFileSync(vaultPath, JSON.stringify(v1Data));

    // Load with encryption key — should migrate
    const vault = new CredentialVault(vaultPath, keyPath);
    assert.strictEqual(vault.get('OLD_SECRET'), 'old_value');

    // File should now be v2
    const content = JSON.parse(fs.readFileSync(vaultPath, 'utf-8'));
    assert.strictEqual(content.version, 2);
    assert.strictEqual(content.encryption, 'aes-256-gcm');
  });

  it('handles empty vault file gracefully', () => {
    const vault = new CredentialVault(vaultPath, keyPath);
    assert.deepStrictEqual(vault.list(), []);
    assert.strictEqual(vault.get('anything'), undefined);
  });

  it('getAll returns copy of secrets', () => {
    const vault = new CredentialVault(vaultPath, keyPath);
    vault.set('A', '1');
    vault.set('B', '2');
    const all = vault.getAll();
    assert.deepStrictEqual(all, { A: '1', B: '2' });
    // Modifying returned object shouldn't affect vault
    (all as Record<string, string>)['C'] = '3';
    assert.strictEqual(vault.has('C'), false);
  });
});
