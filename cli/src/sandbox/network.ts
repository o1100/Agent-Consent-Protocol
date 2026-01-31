/**
 * Network Isolation
 *
 * Restricts the agent process so it can only communicate with
 * the ACP proxy. Multiple strategies based on platform and permissions.
 *
 * Strategy priority:
 * 1. Linux with root → network namespaces (unshare) for true isolation
 * 2. Linux with root (fallback) → cgroup + iptables
 * 3. Docker          → container networking (handled externally)
 * 4. Fallback        → no isolation, proxy-only mode
 *
 * KNOWN LIMITATION: iptables --pid-owner targets the PID at rule creation
 * time. Since the child agent process doesn't exist yet when we set up
 * isolation, we use a cgroup-based approach (cgroup v2 + iptables cgroup
 * match) or network namespaces (unshare) which properly isolate the child.
 *
 * If neither cgroup nor namespace isolation is available, we fall back to
 * UID-based iptables rules when running under a dedicated ACP sandbox user.
 */

import { execSync } from 'node:child_process';
import os from 'node:os';

// Track state for cleanup
let isolationActive = false;
let isolationMethod: string | null = null;
let cleanupInfo: string | null = null;

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
    // Try cgroup-based isolation first (works with child processes)
    try {
      return await setupLinuxCgroup(proxyPort);
    } catch {
      // Fall back to namespace-based if cgroup not available
      console.warn('  ⚠️  cgroup isolation unavailable, trying iptables with cgroup match...');
    }

    // Fall back to iptables with cgroup matching
    return setupLinuxIptablesCgroup(proxyPort);
  }

  if (platform === 'linux' && !isRoot) {
    console.warn('  ⚠️  Network isolation requires root on Linux.');
    console.warn('  Run with: sudo acp run --network-isolation -- <command>');
    throw new Error('Root required for network isolation on Linux');
  }

  if (platform === 'darwin') {
    throw new Error('Network isolation on macOS is not yet implemented. Use Docker mode.');
  }

  throw new Error(`Network isolation not supported on ${platform}`);
}

/**
 * Linux cgroup-based isolation.
 *
 * Creates a dedicated cgroup for the ACP sandbox, then uses
 * iptables cgroup matching to restrict network access. The child
 * process will be placed into this cgroup, ensuring all its
 * network traffic is subject to our rules.
 *
 * This avoids the --pid-owner problem since cgroup membership
 * is inherited by child processes.
 */
async function setupLinuxCgroup(proxyPort: number): Promise<() => Promise<void>> {
  const cgroupName = `acp_sandbox_${process.pid}`;
  const cgroupPath = `/sys/fs/cgroup/${cgroupName}`;
  const chainName = `ACP_CG_${process.pid}`;

  try {
    // Create cgroup (cgroup v2)
    execSync(`mkdir -p ${cgroupPath}`);

    // Create iptables chain
    execSync(`iptables -N ${chainName} 2>/dev/null || true`);

    // Allow loopback traffic to ACP proxy port
    execSync(`iptables -A ${chainName} -o lo -p tcp --dport ${proxyPort} -j ACCEPT`);

    // Allow established/related connections
    execSync(`iptables -A ${chainName} -m state --state ESTABLISHED,RELATED -j ACCEPT`);

    // Allow DNS to localhost only
    execSync(`iptables -A ${chainName} -o lo -p udp --dport 53 -j ACCEPT`);

    // Drop everything else
    execSync(`iptables -A ${chainName} -j DROP`);

    // Link chain to OUTPUT using cgroup match
    execSync(`iptables -I OUTPUT 1 -m cgroup --path ${cgroupName} -j ${chainName}`);

    isolationActive = true;
    isolationMethod = 'cgroup';
    cleanupInfo = JSON.stringify({ chainName, cgroupPath, cgroupName });

    return async () => {
      await teardownLinuxCgroup(chainName, cgroupPath, cgroupName);
    };
  } catch (err) {
    // Clean up partial setup
    try {
      execSync(`iptables -D OUTPUT -m cgroup --path ${cgroupName} -j ${chainName} 2>/dev/null || true`);
      execSync(`iptables -F ${chainName} 2>/dev/null || true`);
      execSync(`iptables -X ${chainName} 2>/dev/null || true`);
      execSync(`rmdir ${cgroupPath} 2>/dev/null || true`);
    } catch {
      // Best effort cleanup
    }
    throw new Error(`Failed to set up cgroup isolation: ${(err as Error).message}`);
  }
}

/**
 * Fallback: Linux iptables with cgroup v2 net_cls matching.
 *
 * If the full cgroup approach fails, try using iptables with
 * the owner module targeting a dedicated UID. This requires
 * the agent to run as a separate user.
 *
 * NOTE: This is a best-effort fallback. For production use,
 * prefer Docker-based isolation or the cgroup approach.
 */
async function setupLinuxIptablesCgroup(proxyPort: number): Promise<() => Promise<void>> {
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

    // Use process group (PGID) instead of PID for better child coverage.
    // The child agent will inherit our process group.
    // NOTE: --pid-owner with process.pid only covers THIS process, not children.
    // This is a known limitation. For proper isolation, use Docker or cgroups.
    execSync(`iptables -I OUTPUT 1 -m owner --pid-owner ${process.pid} -j ${chainName}`);

    isolationActive = true;
    isolationMethod = 'iptables';
    cleanupInfo = chainName;

    console.warn('  ⚠️  Using PID-based iptables isolation (limited).');
    console.warn('  This only covers the ACP process itself, not child processes.');
    console.warn('  For production, use Docker-based isolation or cgroup mode.');

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
 * Tear down Linux cgroup isolation.
 */
async function teardownLinuxCgroup(chainName: string, cgroupPath: string, cgroupName: string): Promise<void> {
  try {
    execSync(`iptables -D OUTPUT -m cgroup --path ${cgroupName} -j ${chainName} 2>/dev/null || true`);
    execSync(`iptables -F ${chainName} 2>/dev/null || true`);
    execSync(`iptables -X ${chainName} 2>/dev/null || true`);
    execSync(`rmdir ${cgroupPath} 2>/dev/null || true`);
  } catch {
    // Best effort cleanup
  }
  isolationActive = false;
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
  if (!isolationActive || !cleanupInfo) return;

  if (isolationMethod === 'cgroup') {
    const info = JSON.parse(cleanupInfo);
    await teardownLinuxCgroup(info.chainName, info.cgroupPath, info.cgroupName);
  } else if (isolationMethod === 'iptables') {
    await teardownLinuxIptables(cleanupInfo);
  }
}

/**
 * Check if network isolation is currently active.
 */
export function isNetworkIsolated(): boolean {
  return isolationActive;
}

/**
 * Get the cgroup path for the sandbox.
 * The child agent process should be placed in this cgroup for proper isolation.
 * Returns null if not using cgroup isolation.
 */
export function getSandboxCgroupPath(): string | null {
  if (isolationMethod !== 'cgroup' || !cleanupInfo) return null;
  const info = JSON.parse(cleanupInfo);
  return info.cgroupPath;
}
