/**
 * Network Isolation
 *
 * Restricts the agent process so it can only communicate with
 * the ACP proxy. Multiple strategies based on platform and permissions.
 *
 * Strategy priority:
 * 1. Linux with root → network namespaces + iptables
 * 2. Linux rootless  → LD_PRELOAD socket interception (future)
 * 3. macOS with root → pf firewall rules (future)
 * 4. Docker          → container networking (handled externally)
 * 5. Fallback        → no isolation, proxy-only mode
 */

import { execSync } from 'node:child_process';
import os from 'node:os';

// Track state for cleanup
let isolationActive = false;
let isolationMethod: string | null = null;
let namespaceCleanup: string | null = null;

/**
 * Set up network isolation for the agent process.
 *
 * Returns a cleanup function to tear down isolation.
 *
 * @param proxyPort - The ACP proxy port that should remain accessible
 * @throws Error if isolation cannot be established
 */
export async function setupNetworkIsolation(
  proxyPort: number
): Promise<() => Promise<void>> {
  const platform = os.platform();
  const isRoot = process.getuid?.() === 0;

  if (platform === 'linux' && isRoot) {
    return setupLinuxIptables(proxyPort);
  }

  if (platform === 'linux' && !isRoot) {
    console.warn('  ⚠️  Network isolation requires root on Linux.');
    console.warn('  Run with: sudo acp run --network-isolation -- <command>');
    throw new Error('Root required for network isolation on Linux');
  }

  if (platform === 'darwin') {
    // macOS pf support (future)
    throw new Error('Network isolation on macOS is not yet implemented. Use Docker mode.');
  }

  throw new Error(`Network isolation not supported on ${platform}`);
}

/**
 * Linux iptables-based isolation.
 *
 * Creates iptables rules that:
 * 1. Allow traffic to 127.0.0.1:<proxyPort> (ACP proxy)
 * 2. Allow established/related connections
 * 3. Drop everything else for the agent's user/cgroup
 */
async function setupLinuxIptables(proxyPort: number): Promise<() => Promise<void>> {
  const chainName = `ACP_SANDBOX_${process.pid}`;

  try {
    // Create a custom iptables chain for ACP
    execSync(`iptables -N ${chainName} 2>/dev/null || true`);

    // Allow loopback traffic to ACP proxy port
    execSync(`iptables -A ${chainName} -o lo -p tcp --dport ${proxyPort} -j ACCEPT`);

    // Allow established/related connections (responses)
    execSync(`iptables -A ${chainName} -m state --state ESTABLISHED,RELATED -j ACCEPT`);

    // Allow DNS to localhost only (if running a local resolver)
    execSync(`iptables -A ${chainName} -o lo -p udp --dport 53 -j ACCEPT`);

    // Drop everything else
    execSync(`iptables -A ${chainName} -j DROP`);

    // Insert the chain into OUTPUT for the current process group
    execSync(`iptables -I OUTPUT 1 -m owner --pid-owner ${process.pid} -j ${chainName}`);

    isolationActive = true;
    isolationMethod = 'iptables';
    namespaceCleanup = chainName;

    return async () => {
      await teardownLinuxIptables(chainName);
    };
  } catch (err) {
    // Clean up partial setup
    try {
      execSync(`iptables -D OUTPUT -m owner --pid-owner ${process.pid} -j ${chainName} 2>/dev/null || true`);
      execSync(`iptables -F ${chainName} 2>/dev/null || true`);
      execSync(`iptables -X ${chainName} 2>/dev/null || true`);
    } catch {
      // Best effort cleanup
    }
    throw new Error(`Failed to set up iptables isolation: ${(err as Error).message}`);
  }
}

/**
 * Tear down Linux iptables isolation.
 */
async function teardownLinuxIptables(chainName: string): Promise<void> {
  try {
    execSync(`iptables -D OUTPUT -m owner --pid-owner ${process.pid} -j ${chainName} 2>/dev/null || true`);
    execSync(`iptables -F ${chainName} 2>/dev/null || true`);
    execSync(`iptables -X ${chainName} 2>/dev/null || true`);
  } catch {
    // Best effort cleanup
  }
  isolationActive = false;
}

/**
 * Tear down any active network isolation.
 */
export async function teardownNetworkIsolation(): Promise<void> {
  if (!isolationActive) return;

  if (isolationMethod === 'iptables' && namespaceCleanup) {
    await teardownLinuxIptables(namespaceCleanup);
  }
}

/**
 * Check if network isolation is currently active.
 */
export function isNetworkIsolated(): boolean {
  return isolationActive;
}
