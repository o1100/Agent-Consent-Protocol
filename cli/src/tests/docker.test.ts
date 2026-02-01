/**
 * Tests for the Docker containment module.
 *
 * These are unit tests that mock execSync — no actual Docker required.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { detectImage } from '../sandbox/docker.js';

describe('Docker containment module', () => {
  describe('detectImage()', () => {
    it('maps python to python:3.12-slim', () => {
      assert.strictEqual(detectImage(['python', 'my_agent.py']), 'python:3.12-slim');
    });

    it('maps python3 to python:3.12-slim', () => {
      assert.strictEqual(detectImage(['python3', 'my_agent.py']), 'python:3.12-slim');
    });

    it('maps node to node:20-slim', () => {
      assert.strictEqual(detectImage(['node', 'agent.js']), 'node:20-slim');
    });

    it('maps npx to node:20-slim', () => {
      assert.strictEqual(detectImage(['npx', 'some-tool']), 'node:20-slim');
    });

    it('maps ruby to ruby:3.3-slim', () => {
      assert.strictEqual(detectImage(['ruby', 'agent.rb']), 'ruby:3.3-slim');
    });

    it('maps go to golang:1.22-slim', () => {
      assert.strictEqual(detectImage(['go', 'run', 'main.go']), 'golang:1.22-slim');
    });

    it('maps openclaw to node:20-slim', () => {
      assert.strictEqual(detectImage(['openclaw', 'gateway']), 'node:20-slim');
    });

    it('returns ubuntu:24.04 for unknown commands', () => {
      assert.strictEqual(detectImage(['./my-custom-agent']), 'ubuntu:24.04');
    });

    it('returns ubuntu:24.04 for empty command', () => {
      assert.strictEqual(detectImage([]), 'ubuntu:24.04');
    });

    it('handles full paths by extracting basename', () => {
      assert.strictEqual(detectImage(['/usr/bin/python', 'script.py']), 'python:3.12-slim');
    });

    it('handles full paths for node', () => {
      assert.strictEqual(detectImage(['/usr/local/bin/node', 'app.js']), 'node:20-slim');
    });
  });
});
