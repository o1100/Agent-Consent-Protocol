import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { generateWrappers, cleanupWrappers, DEFAULT_WRAPPED_COMMANDS } from '../interceptors/shell-wrappers.js';

describe('Shell wrapper generation', () => {
  afterEach(() => {
    cleanupWrappers();
  });

  it('creates wrapper bin directory', () => {
    const binDir = generateWrappers({ acpPort: 8443 });
    assert.ok(fs.existsSync(binDir), 'bin dir should exist');
  });

  it('generates acp-gate.mjs helper', () => {
    const binDir = generateWrappers({ acpPort: 8443 });
    const gatePath = path.join(binDir, 'acp-gate.mjs');
    assert.ok(fs.existsSync(gatePath), 'acp-gate.mjs should exist');

    const content = fs.readFileSync(gatePath, 'utf-8');
    assert.ok(content.includes('#!/usr/bin/env node'), 'should have node shebang');
    assert.ok(content.includes('/acp/intercept'), 'should POST to /acp/intercept');
    assert.ok(content.includes('8443'), 'should contain the port');
  });

  it('generates wrapper scripts for commands found on system', () => {
    // 'ls' is always available but isn't in default list
    // Test with a subset that should be available on most systems
    const binDir = generateWrappers({ acpPort: 8443, commands: ['ls', 'cat'] });

    // At least some should exist (ls and cat are everywhere)
    const lsWrapper = path.join(binDir, 'ls');
    const catWrapper = path.join(binDir, 'cat');

    // At least one should be generated
    const anyExist = fs.existsSync(lsWrapper) || fs.existsSync(catWrapper);
    assert.ok(anyExist, 'at least one wrapper should be generated');

    // Check wrapper content if it exists
    if (fs.existsSync(lsWrapper)) {
      const content = fs.readFileSync(lsWrapper, 'utf-8');
      assert.ok(content.includes('#!/bin/bash'), 'should have bash shebang');
      assert.ok(content.includes('acp-gate.mjs'), 'should call acp-gate.mjs');
      assert.ok(content.includes('shell:ls'), 'should use shell:ls tool name');
    }
  });

  it('skips commands not found on system', () => {
    const binDir = generateWrappers({ acpPort: 8443, commands: ['__nonexistent_command_xyz__'] });
    const wrapper = path.join(binDir, '__nonexistent_command_xyz__');
    assert.ok(!fs.existsSync(wrapper), 'should not create wrapper for missing command');
  });

  it('uses deny fail mode by default', () => {
    const binDir = generateWrappers({ acpPort: 8443 });
    const gatePath = path.join(binDir, 'acp-gate.mjs');
    const content = fs.readFileSync(gatePath, 'utf-8');
    assert.ok(content.includes("failMode = 'deny'"), 'should default to deny fail mode');
  });

  it('respects allow fail mode', () => {
    const binDir = generateWrappers({ acpPort: 8443, failMode: 'allow' });
    const gatePath = path.join(binDir, 'acp-gate.mjs');
    const content = fs.readFileSync(gatePath, 'utf-8');
    assert.ok(content.includes("failMode = 'allow'"), 'should use allow fail mode');
  });

  it('cleanup removes the wrapper directory', () => {
    const binDir = generateWrappers({ acpPort: 8443 });
    assert.ok(fs.existsSync(binDir));

    cleanupWrappers();

    // The bin dir's parent (the temp dir) should be cleaned
    const parentDir = path.dirname(binDir);
    assert.ok(!fs.existsSync(parentDir), 'temp directory should be removed');
  });

  it('has sensible default commands list', () => {
    assert.ok(DEFAULT_WRAPPED_COMMANDS.includes('curl'));
    assert.ok(DEFAULT_WRAPPED_COMMANDS.includes('rm'));
    assert.ok(DEFAULT_WRAPPED_COMMANDS.includes('git'));
    assert.ok(DEFAULT_WRAPPED_COMMANDS.includes('docker'));
    assert.ok(DEFAULT_WRAPPED_COMMANDS.includes('npm'));
    assert.ok(DEFAULT_WRAPPED_COMMANDS.includes('python3'));
    assert.ok(DEFAULT_WRAPPED_COMMANDS.length >= 20, 'should have at least 20 default commands');
  });
});
