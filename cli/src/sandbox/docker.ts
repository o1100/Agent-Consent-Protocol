/**
 * Docker Containment Module
 *
 * Provides kernel-enforced containment via Docker so that agents
 * cannot bypass ACP even if they actively try. The HTTP proxy becomes
 * the only route to the internet, enforced by Docker's internal
 * network — not by environment variables the agent could ignore.
 *
 * Architecture:
 *   HOST: ACP proxies listen on 0.0.0.0
 *   Docker internal network "acp-jail" (10.200.0.0/24, no gateway)
 *   Container: --network=acp-jail, --read-only, --cap-drop=ALL
 *   Agent can ONLY reach the host bridge IP (10.200.0.1)
 */

import { execSync, spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

export interface DockerOptions {
  image: string;
  command: string[];
  workspaceDir: string;
  proxyHost: string;        // Docker bridge gateway IP
  proxyPort: number;        // MCP proxy port
  httpProxyPort: number;    // HTTP forward proxy port
  memoryLimit?: string;     // default "2g"
  pidsLimit?: number;       // default 256
  interactive?: boolean;    // pass stdin to container (requires non-terminal consent channel)
  env?: Record<string, string>;
}

const NETWORK_NAME = 'acp-jail';
const NETWORK_SUBNET = '10.200.0.0/24';

/** Image mapping: command name -> Docker image */
const IMAGE_MAP: Record<string, string> = {
  python: 'python:3.12-slim',
  python3: 'python:3.12-slim',
  node: 'node:20-slim',
  npx: 'node:20-slim',
  ruby: 'ruby:3.3-slim',
  go: 'golang:1.22-slim',
  openclaw: 'node:20-slim',
};

const DEFAULT_IMAGE = 'ubuntu:24.04';

/**
 * Check that Docker CLI exists and daemon is running.
 * Throws a clear error if not available.
 */
export function preflight(): void {
  try {
    execSync('docker version --format "{{.Server.Version}}"', {
      stdio: 'pipe',
      timeout: 10000,
    });
  } catch (err) {
    const msg = (err as Error).message || '';
    if (msg.includes('not found') || msg.includes('ENOENT')) {
      throw new Error(
        'Docker is not installed. Install Docker Desktop or Docker Engine to use --contained mode.\n' +
        '  https://docs.docker.com/get-docker/'
      );
    }
    throw new Error(
      'Docker daemon is not running. Start Docker and try again.\n' +
      `  Detail: ${msg.split('\n')[0]}`
    );
  }
}

/**
 * Create the Docker network (idempotent).
 *
 * On Linux: --internal means no internet gateway. The gateway IP
 * (10.200.0.1) is directly on the host, so ACP is reachable.
 *
 * On macOS/Windows: Docker Desktop runs a VM. --internal blocks ALL
 * routes including to the host. We use a regular bridge network
 * instead, and rely on --dns=127.0.0.1 + proxy env vars for control.
 * This is weaker than Linux (agent could connect to raw IPs without
 * DNS), but is the best Docker Desktop supports without a sidecar.
 */
export function ensureNetwork(): void {
  const platform = os.platform();
  const internal = platform === 'linux' ? '--internal ' : '';

  try {
    execSync(
      `docker network create ${internal}--subnet=${NETWORK_SUBNET} ${NETWORK_NAME}`,
      { stdio: 'pipe', timeout: 15000 }
    );
    console.log(`  Created Docker network: ${NETWORK_NAME}`);
    if (!internal) {
      console.log('  Note: macOS/Windows — using bridge network (DNS-restricted, proxy-enforced)');
    }
  } catch (err) {
    const stderr = (err as { stderr?: Buffer }).stderr?.toString() || '';
    if (stderr.includes('already exists')) {
      // Network already exists — that's fine
      return;
    }
    throw new Error(`Failed to create Docker network: ${stderr.split('\n')[0]}`);
  }
}

/**
 * Get the IP the container should use to reach ACP on the host.
 *
 * On Linux, Docker bridges the internal network directly to the host,
 * so the gateway IP (10.200.0.1) works.
 *
 * On macOS/Windows, Docker Desktop runs containers inside a VM.
 * The gateway IP exists in the VM, not on the real host. We use
 * --add-host=acp-host:host-gateway and return 'acp-host' as the
 * proxy host. Docker resolves host-gateway to the host machine IP.
 */
export function getGatewayIp(): string {
  const platform = os.platform();

  if (platform === 'darwin' || platform === 'win32') {
    // macOS/Windows: use the hostname 'acp-host' which we map via --add-host
    return 'acp-host';
  }

  // Linux: use the actual bridge gateway IP
  try {
    const output = execSync(
      `docker network inspect ${NETWORK_NAME} --format "{{(index .IPAM.Config 0).Gateway}}"`,
      { stdio: 'pipe', timeout: 10000 }
    ).toString().trim();

    if (!output || output === '<no value>') {
      return '10.200.0.1';
    }
    return output;
  } catch {
    return '10.200.0.1';
  }
}

/**
 * Pull a Docker image if not cached locally. Shows progress.
 */
export function pullImage(image: string): void {
  try {
    // Check if image exists locally
    execSync(`docker image inspect ${image}`, { stdio: 'pipe', timeout: 10000 });
    console.log(`  Docker image cached: ${image}`);
  } catch {
    console.log(`  Pulling Docker image: ${image}...`);
    try {
      execSync(`docker pull ${image}`, { stdio: 'inherit', timeout: 300000 });
    } catch (err) {
      throw new Error(`Failed to pull Docker image "${image}": ${(err as Error).message}`);
    }
  }
}

/**
 * Auto-detect a Docker image from the command name.
 * Maps common runtimes to slim images.
 */
export function detectImage(command: string[]): string {
  if (command.length === 0) return DEFAULT_IMAGE;
  const firstWord = command[0].split('/').pop() || '';
  return IMAGE_MAP[firstWord] || DEFAULT_IMAGE;
}

/**
 * Run the agent inside a contained Docker container.
 *
 * Container properties:
 *   - --network=acp-jail: internal network, no internet
 *   - --read-only: container filesystem is read-only
 *   - --cap-drop=ALL: no Linux capabilities
 *   - --security-opt=no-new-privileges: no privilege escalation
 *   - --tmpfs /tmp: writable temp dir inside container
 *   - -v workspace:/workspace: agent's working directory
 *   - HTTP_PROXY/HTTPS_PROXY point to ACP proxy on host bridge
 */
export function runContained(options: DockerOptions): ChildProcess {
  const {
    image,
    command,
    workspaceDir,
    proxyHost,
    proxyPort,
    httpProxyPort,
    memoryLimit = '2g',
    pidsLimit = 256,
    interactive = false,
    env = {},
  } = options;

  const httpProxyUrl = `http://${proxyHost}:${httpProxyPort}`;
  const mcpProxyUrl = `http://${proxyHost}:${proxyPort}`;

  // Run container as the workspace directory's owner UID/GID so file
  // writes work even with --cap-drop=ALL (which drops DAC_OVERRIDE).
  let userFlag: string[] = [];
  try {
    const stat = fs.statSync(workspaceDir);
    userFlag = ['--user', `${stat.uid}:${stat.gid}`];
  } catch {
    // Fall back to running as root if stat fails
  }

  // In interactive mode (-it), stdin is passed to the container so the
  // agent can accept user input (e.g. Claude Code). This means ACP's
  // terminal consent channel can't use stdin — a non-terminal channel
  // (Telegram, webhook) must be used for approvals.
  const platform = os.platform();
  const args = [
    'run', '--rm',
    ...(interactive ? ['-it'] : []),
    ...userFlag,
    `--network=${NETWORK_NAME}`,
    // On macOS/Windows Docker Desktop, the --internal flag can't be used
    // (it blocks routes to the host too). Instead we use a regular network
    // with --add-host for host access and --dns to block DNS resolution.
    ...(platform === 'darwin' || platform === 'win32'
      ? ['--add-host=acp-host:host-gateway', '--dns=127.0.0.1']
      : []),
    '--read-only',
    '--tmpfs', '/tmp:size=100m',
    '--tmpfs', '/home:size=50m',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    `--pids-limit=${pidsLimit}`,
    `--memory=${memoryLimit}`,
    '-v', `${workspaceDir}:/workspace`,
    '-w', '/workspace',
    // Proxy environment variables
    '-e', `HTTP_PROXY=${httpProxyUrl}`,
    '-e', `HTTPS_PROXY=${httpProxyUrl}`,
    '-e', `http_proxy=${httpProxyUrl}`,
    '-e', `https_proxy=${httpProxyUrl}`,
    '-e', `NO_PROXY=${proxyHost}`,
    '-e', `ACP_PROXY_URL=${mcpProxyUrl}`,
    '-e', `MCP_SERVER_URL=${mcpProxyUrl}`,
    '-e', 'ACP_SANDBOX=1',
    '-e', 'ACP_CONTAINED=1',
    '-e', 'ACP_VERSION=0.3.0',
    // Override HOME to /workspace so the agent writes config/state there
    // instead of trying to create directories under the host's HOME path.
    '-e', 'HOME=/workspace',
  ];

  // Add custom environment variables
  for (const [key, value] of Object.entries(env)) {
    args.push('-e', `${key}=${value}`);
  }

  // Image and command
  args.push(image, ...command);

  const child = spawn('docker', args, {
    stdio: interactive ? 'inherit' : ['ignore', 'inherit', 'inherit'],
  });

  child.on('error', (err) => {
    console.error(`  Failed to start Docker container: ${err.message}`);
  });

  return child;
}

/**
 * Force-stop and remove any running container on the acp-jail network.
 * Best-effort cleanup — errors are silently ignored.
 */
export function cleanup(): void {
  try {
    const containers = execSync(
      `docker ps -q --filter network=${NETWORK_NAME}`,
      { stdio: 'pipe', timeout: 10000 }
    ).toString().trim();

    if (containers) {
      for (const id of containers.split('\n').filter(Boolean)) {
        try {
          execSync(`docker kill ${id}`, { stdio: 'pipe', timeout: 10000 });
        } catch {
          // Best effort
        }
      }
    }
  } catch {
    // Best effort cleanup
  }
}
