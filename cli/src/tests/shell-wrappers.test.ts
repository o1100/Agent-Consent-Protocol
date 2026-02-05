import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { generateWrappers, cleanupWrappers, getWrapperDir } from '../container/shell-wrappers.js';

describe('Shell Wrappers', () => {
  afterEach(() => {
    cleanupWrappers();
  });

  it('generates wrapper scripts for specified commands', () => {
    const binDir = generateWrappers({
      consentPort: 8443,
      consentHost: '10.200.0.1',
      commands: ['curl', 'rm'],
    });

    assert.ok(fs.existsSync(binDir));

    // Gate helper should exist
    const gateHelper = path.join(binDir, 'acp-gate.sh');
    assert.ok(fs.existsSync(gateHelper));

    // Gate helper should contain the consent host/port
    const gateContent = fs.readFileSync(gateHelper, 'utf-8');
    assert.ok(gateContent.includes('10.200.0.1'));
    assert.ok(gateContent.includes('8443'));
    assert.ok(gateContent.includes('/consent'));
  });

  it('generates wrapper scripts with dynamic runtime resolution', () => {
    const binDir = generateWrappers({
      consentPort: 8443,
      consentHost: '10.200.0.1',
      commands: ['ls'],
    });

    const wrapper = path.join(binDir, 'ls');
    assert.ok(fs.existsSync(wrapper));
    const content = fs.readFileSync(wrapper, 'utf-8');
    assert.ok(content.includes('#!/bin/bash'));
    assert.ok(content.includes('ACP_WRAPPER_ACTIVE'));
    assert.ok(content.includes('acp-gate.sh'));
    // Should resolve binary at runtime, not bake host paths
    assert.ok(content.includes('command -v'));
    assert.ok(content.includes('PATH='));
  });

  it('generates wrappers for all commands (resolution at runtime)', () => {
    const binDir = generateWrappers({
      consentPort: 8443,
      consentHost: '10.200.0.1',
      commands: ['nonexistent_command_xyz'],
    });

    // Wrappers are always generated; binary resolution happens at runtime in the container
    const wrapper = path.join(binDir, 'nonexistent_command_xyz');
    assert.ok(fs.existsSync(wrapper));
    const content = fs.readFileSync(wrapper, 'utf-8');
    assert.ok(content.includes('nonexistent_command_xyz'));
  });

  it('cleanupWrappers removes the directory', () => {
    generateWrappers({
      consentPort: 8443,
      consentHost: '10.200.0.1',
      commands: ['ls'],
    });

    assert.ok(getWrapperDir() !== null);
    cleanupWrappers();
    assert.strictEqual(getWrapperDir(), null);
  });

  it('makes wrapper scripts executable', () => {
    const binDir = generateWrappers({
      consentPort: 8443,
      consentHost: '10.200.0.1',
      commands: ['ls'],
    });

    const gateHelper = path.join(binDir, 'acp-gate.sh');
    const stat = fs.statSync(gateHelper);
    assert.ok((stat.mode & 0o111) !== 0);
  });
});

describe('Shell Wrapper Content', () => {
  afterEach(() => {
    cleanupWrappers();
  });

  it('gate helper uses correct endpoint path', () => {
    const binDir = generateWrappers({
      consentPort: 9999,
      consentHost: '10.200.0.1',
      commands: [],
    });

    const content = fs.readFileSync(path.join(binDir, 'acp-gate.sh'), 'utf-8');
    assert.ok(content.includes('/consent'));
    assert.ok(content.includes('9999'));
  });

  it('gate helper defaults to deny on error', () => {
    const binDir = generateWrappers({
      consentPort: 8443,
      consentHost: '10.200.0.1',
      commands: [],
      failMode: 'deny',
    });

    const content = fs.readFileSync(path.join(binDir, 'acp-gate.sh'), 'utf-8');
    assert.ok(content.includes('FAIL_MODE="deny"'));
  });

  it('gate helper uses allow fail mode when configured', () => {
    const binDir = generateWrappers({
      consentPort: 8443,
      consentHost: '10.200.0.1',
      commands: [],
      failMode: 'allow',
    });

    const content = fs.readFileSync(path.join(binDir, 'acp-gate.sh'), 'utf-8');
    assert.ok(content.includes('FAIL_MODE="allow"'));
  });

  it('wrapper sends real command name for policy matching', () => {
    const binDir = generateWrappers({
      consentPort: 8443,
      consentHost: '10.200.0.1',
      commands: ['node'],
    });

    const content = fs.readFileSync(path.join(binDir, 'node'), 'utf-8');
    // Wrapper should send "node" as the command name, not a display name
    assert.ok(content.includes('acp-gate.sh" "node"'));
    // Should NOT contain display name renaming logic
    assert.ok(!content.includes('DISPLAY_NAME'));
  });

  it('cleanup removes the wrapper directory', () => {
    const binDir = generateWrappers({
      consentPort: 8443,
      consentHost: '10.200.0.1',
      commands: ['ls'],
    });

    assert.ok(fs.existsSync(binDir));
    cleanupWrappers();

    const parentDir = path.dirname(binDir);
    assert.ok(!fs.existsSync(parentDir));
  });
});
