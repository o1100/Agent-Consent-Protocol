#!/usr/bin/env node

/**
 * ACP CLI — Agent Consent Protocol
 *
 * 2FA for AI Agents. Human authorization via push notification
 * for any agentic system running inside a Docker container.
 *
 * Usage:
 *   acp init [--channel=prompt|telegram|webhook]
 *   acp contain [options] -- <command>
 */

import { Command } from 'commander';
import { initCommand } from './cli/init.js';
import { containCommand } from './cli/contain.js';

const program = new Command();

program
  .name('acp')
  .description('Agent Consent Protocol — 2FA for AI Agents')
  .version('1.0.0');

// acp init
program
  .command('init')
  .description('Initialize ACP configuration')
  .option('--channel <type>', 'Approval channel: prompt, telegram, webhook', 'prompt')
  .action(initCommand);

// acp contain -- <command>
program
  .command('contain')
  .description('Run an agent inside a consent-gated Docker container')
  .option('--interactive', 'Pass stdin to container (requires non-terminal channel)', false)
  .option('--image <image>', 'Docker image (default: auto-detect from command)')
  .option('--workspace <dir>', 'Workspace directory to mount (default: CWD)')
  .option('--policy <file>', 'Policy YAML file')
  .option('--channel <type>', 'Override consent channel: prompt, telegram, webhook')
  .option('--env <KEY>', 'Forward host env var to container (repeatable)',
    (val: string, prev: string[]) => { prev.push(val); return prev; }, [] as string[])
  .option('--consent-port <port>', 'Consent server port (Layer 1)', '8443')
  .option('--http-proxy-port <port>', 'HTTP proxy port (Layer 2)', '8444')
  .allowUnknownOption(true)
  .argument('[command...]', 'Agent command to run')
  .action(containCommand);

program.parse();
