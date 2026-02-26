#!/usr/bin/env node

/**
 * ACP CLI — Agent Consent Protocol
 *
 * 2FA for AI Agents. v0.3.0 is Linux VM-first for OpenClaw.
 *
 * Usage:
 *   acp init [--channel=prompt|telegram|webhook]
 *   acp start <preset> [--workspace=DIR] [--openclaw-user=USER]
 *   acp contain [options] -- <command>   (legacy Docker compatibility)
 */

import { Command } from 'commander';
import { initCommand } from './cli/init.js';
import { containCommand } from './cli/contain.js';
import { startCommand } from './cli/start.js';

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
  .option('--config <dir>', 'ACP config directory (default: ~/.acp)')
  .action(initCommand);

// acp contain -- <command>
program
  .command('contain')
  .description('Run an agent in legacy Docker compatibility mode')
  .option('--interactive', 'Pass stdin to container (requires non-terminal channel)', false)
  .option('--writable', 'Disable read-only filesystem for containers that need it', false)
  .option('--image <image>', 'Docker image (default: auto-detect from command)')
  .option('--workspace <dir>', 'Workspace directory to mount (default: CWD)')
  .option('--policy <file>', 'Policy YAML file')
  .option('--channel <type>', 'Override consent channel: prompt, telegram, webhook')
  .option('--env <KEY>', 'Forward host env var to container (repeatable)',
    (val: string, prev: string[]) => { prev.push(val); return prev; }, [] as string[])
  .option('--consent-port <port>', 'Consent server port (Layer 1)', '8443')
  .option('--http-proxy-port <port>', 'HTTP proxy port (Layer 2)', '8444')
  .option('--config <dir>', 'ACP config directory (default: ~/.acp)')
  .allowUnknownOption(true)
  .argument('[command...]', 'Agent command to run')
  .action(containCommand);

// acp start <preset>
program
 .command('start')
  .description('Start a known agent in ACP Linux VM mode')
  .argument('<preset>', 'Agent preset to run (e.g. openclaw)')
  .option('--workspace <dir>', 'Workspace directory (default: target user home/openclaw-workspace)')
  .option('--openclaw-user <user>', 'Linux user to run OpenClaw under', 'openclaw')
  .option('--http-proxy-port <port>', 'HTTP proxy port', '8444')
  .option('--config <dir>', 'ACP config directory (default: ~/.acp)')
  .action(startCommand);

program.parse();
