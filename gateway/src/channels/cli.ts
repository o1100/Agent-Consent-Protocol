/**
 * ACP Gateway — CLI Channel Adapter
 *
 * Terminal-based approval channel for development and testing.
 * Displays consent requests in the terminal and reads responses
 * from stdin.
 */

import readline from 'node:readline';
import type { ConsentRequest, ChannelAdapter } from '../types.js';

const RISK_EMOJI: Record<string, string> = {
  low: '🟢',
  medium: '🟡',
  high: '🔴',
  critical: '⛔',
};

export interface CLIResponseHandler {
  (requestId: string, decision: 'approved' | 'denied', approverId: string): Promise<void>;
}

export class CLIAdapter implements ChannelAdapter {
  readonly name = 'cli';
  private responseHandler?: CLIResponseHandler;
  private rl: readline.Interface;

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  /**
   * Register a handler for approval/denial responses.
   */
  onResponse(handler: CLIResponseHandler): void {
    this.responseHandler = handler;
  }

  /**
   * Display a consent request in the terminal and prompt for a decision.
   */
  async deliverRequest(request: ConsentRequest): Promise<void> {
    const risk = request.action.risk_level;
    const riskEmoji = RISK_EMOJI[risk] || '❓';

    console.log('\n' + '═'.repeat(60));
    console.log('  🤖 AGENT CONSENT REQUEST');
    console.log('═'.repeat(60));
    console.log(`  ID:       ${request.id}`);
    console.log(`  Agent:    ${request.agent.name || request.agent.id}`);
    console.log(`  Action:   ${request.action.tool}`);
    console.log(`  Risk:     ${riskEmoji} ${risk.toUpperCase()}`);
    console.log(`  Category: ${request.action.category}`);
    console.log('─'.repeat(60));
    console.log(`  Description: ${request.action.description}`);
    console.log('─'.repeat(60));
    console.log('  Parameters:');
    console.log(`  ${JSON.stringify(request.action.parameters, null, 2).split('\n').join('\n  ')}`);

    if (request.context?.conversation_summary) {
      console.log('─'.repeat(60));
      console.log(`  Context: ${request.context.conversation_summary}`);
    }

    console.log('─'.repeat(60));
    console.log(`  Expires at: ${request.expires_at}`);
    console.log('═'.repeat(60));

    const answer = await this.prompt('\n  [A]pprove or [D]eny? ');
    const decision = answer.toLowerCase().startsWith('a') ? 'approved' : 'denied';

    console.log(`\n  → ${decision === 'approved' ? '✅ Approved' : '❌ Denied'}\n`);

    if (this.responseHandler) {
      await this.responseHandler(request.id, decision, 'cli_user');
    }
  }

  /**
   * Cancel a pending request.
   */
  async cancelRequest(requestId: string): Promise<void> {
    console.log(`\n  🚫 Request ${requestId} was cancelled.\n`);
  }

  /**
   * CLI is always available.
   */
  async healthCheck(): Promise<boolean> {
    return true;
  }

  /**
   * Prompt the user for input.
   */
  private prompt(question: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(question, (answer) => {
        resolve(answer);
      });
    });
  }

  /**
   * Close the readline interface.
   */
  close(): void {
    this.rl.close();
  }
}
