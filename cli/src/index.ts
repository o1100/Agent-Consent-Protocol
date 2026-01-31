#!/usr/bin/env node

/**
 * ACP CLI — Agent Consent Protocol
 *
 * One command to wrap any agent in a consent-enforced sandbox.
 *
 * Usage:
 *   acp init [--channel=prompt|telegram|webhook]
 *   acp run [--network-isolation] -- <command>
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
import { secretCommand } from './commands/secret.js';
import { policyCommand } from './commands/policy.js';
import { statusCommand } from './commands/status.js';

const program = new Command();

program
  .name('acp')
  .description('Agent Consent Protocol — 2FA for AI Agents')
  .version('0.2.4');

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
  .option('--network-isolation', 'Enable network isolation (Linux, requires root)', false)
  .option('--policy <file>', 'Policy file to use')
  .option('--port <port>', 'ACP proxy port', '8443')
  .option('--upstream <command>', 'Upstream MCP server command (repeatable)', (val: string, prev: string[]) => { prev.push(val); return prev; }, [] as string[])
  .option('--channel <type>', 'Override approval channel: prompt, telegram, webhook')
  .allowUnknownOption(true)
  .argument('[command...]', 'Agent command to run')
  .action(runCommand);

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
