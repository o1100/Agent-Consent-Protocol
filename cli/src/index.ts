#!/usr/bin/env node

/**
 * ACP CLI — Agent Consent Protocol
 *
 * One command to wrap any agent in a consent-enforced sandbox.
 * Intercepts MCP tool calls, shell commands, HTTP requests, and file operations.
 * Docker containment mode (--contained) provides kernel-enforced isolation.
 *
 * Usage:
 *   acp init [--channel=prompt|telegram|webhook]
 *   acp run [--contained] [--image <image>] [--workspace <dir>] -- <command>
 *   acp setup claude-code|openclaw
 *   acp secret set KEY=VALUE
 *   acp secret list
 *   acp secret remove KEY
 *   acp policy apply <file>
 *   acp policy show
 *   acp status
 */

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { runCommand } from './commands/run.js';
import { setupCommand } from './commands/setup.js';
import { secretCommand } from './commands/secret.js';
import { policyCommand } from './commands/policy.js';
import { statusCommand } from './commands/status.js';

const program = new Command();

program
  .name('acp')
  .description('Agent Consent Protocol — 2FA for AI Agents')
  .version('0.3.0');

// acp init
program
  .command('init')
  .description('Initialize ACP configuration')
  .option('--channel <type>', 'Approval channel: prompt, telegram, webhook', 'prompt')
  .action(initCommand);

// acp run -- <command>
program
  .command('run')
  .description('Run an agent inside the ACP sandbox')
  .option('--contained', 'Enable Docker containment (kernel-enforced isolation)', false)
  .option('--interactive', 'Pass stdin to container (for interactive agents like Claude Code)', false)
  .option('--image <image>', 'Docker image to use (default: auto-detect from command)')
  .option('--workspace <dir>', 'Workspace directory to mount in container (default: CWD)')
  .option('--env <KEY>', 'Forward host env var to container (repeatable)', (val: string, prev: string[]) => { prev.push(val); return prev; }, [] as string[])
  .option('--network-isolation', 'Deprecated: use --contained instead', false)
  .option('--policy <file>', 'Policy file to use')
  .option('--port <port>', 'ACP proxy port', '8443')
  .option('--http-proxy-port <port>', 'HTTP forward proxy port', '8444')
  .option('--upstream <command>', 'Upstream MCP server command (repeatable)', (val: string, prev: string[]) => { prev.push(val); return prev; }, [] as string[])
  .option('--channel <type>', 'Override approval channel: prompt, telegram, webhook')
  .option('--no-shell-intercept', 'Disable shell command interception')
  .option('--no-http-intercept', 'Disable HTTP request interception')
  .allowUnknownOption(true)
  .argument('[command...]', 'Agent command to run')
  .action(runCommand);

// acp setup
program
  .command('setup <integration>')
  .description('Set up integration (claude-code, openclaw)')
  .option('--port <port>', 'ACP proxy port', '8443')
  .action(setupCommand);

// acp secret
const secret = program
  .command('secret')
  .description('Manage the encrypted credential vault');

secret
  .command('set <pair>')
  .description('Store a secret (KEY=VALUE)')
  .action((pair: string) => secretCommand('set', pair));

secret
  .command('list')
  .description('List stored secrets')
  .action(() => secretCommand('list'));

secret
  .command('remove <key>')
  .description('Remove a secret')
  .action((key: string) => secretCommand('remove', key));

// acp policy
const policy = program
  .command('policy')
  .description('Manage consent policies');

policy
  .command('apply <file>')
  .description('Apply a YAML policy file')
  .action((file: string) => policyCommand('apply', file));

policy
  .command('show')
  .description('Show current policy')
  .action(() => policyCommand('show'));

// acp status
program
  .command('status')
  .description('Show ACP status and running sessions')
  .action(statusCommand);

program.parse();
