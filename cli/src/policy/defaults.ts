/**
 * Default Policy
 *
 * Returns a sensible default policy for new ACP installations.
 */

export function getDefaultPolicy() {
  return {
    version: '1',
    default_action: 'ask',
    rules: [
      {
        match: { category: 'read' },
        action: 'allow',
      },
      {
        match: { tool: 'write_file', args: { path: '~/workspace/**' } },
        action: 'allow',
      },
      {
        match: { tool: 'exec' },
        action: 'ask',
        level: 'high',
      },
      {
        match: { category: 'communication' },
        action: 'ask',
        level: 'high',
      },
      {
        match: { category: 'financial' },
        action: 'ask',
        level: 'critical',
        timeout: 300,
      },
      {
        match: { tool: '*' },
        rate_limit: '20/minute',
      },
    ],
  };
}
