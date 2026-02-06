/**
 * Docker Containment — network + container orchestration
 *
 * Creates an isolated Docker environment where the agent runs:
 *   - Internal network (no internet gateway on Linux)
 *   - Read-only filesystem
 *   - All capabilities dropped
 *   - No privilege escalation
 *   - Workspace mounted as writable volume
 *   - HTTP_PROXY/HTTPS_PROXY pointing to ACP proxy on host bridge
 *
 * The container can ONLY reach the host bridge IP, where ACP's
 * consent server (:8443) and HTTP proxy (:8444) listen.
 */

import { execSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

export interface DockerContainerOptions {
  image: string;
  command: string[];
  workspaceDir: string;
  proxyHost: string;
  consentPort: number;
  httpProxyPort: number;
  wrapperBinDir?: string;
  memoryLimit?: string;
  pidsLimit?: number;
  interactive?: boolean;
  writable?: boolean;
  env?: Record<string, string>;
}

const NETWORK_NAME = 'acp-jail';
const NETWORK_SUBNET = '10.200.0.0/24';

const IMAGE_MAP: Record<string, string> = {
  python: 'python:3.12-slim',
  python3: 'python:3.12-slim',
  node: 'node:22-slim',
  npx: 'node:22-slim',
  ruby: 'ruby:3.3-slim',
  go: 'golang:1.22-slim',
  // OpenClaw long-polling can fail on Node 22+ with proxies; use Node 20 by default.
  openclaw: 'node:20-slim',
};

const DEFAULT_IMAGE = 'ubuntu:24.04';

/**
 * Check that Docker CLI exists and daemon is running.
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
        'Docker is not installed. Install Docker Desktop or Docker Engine.\n' +
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
 * On Linux: --internal means no internet gateway.
 * On macOS/Windows: regular bridge + proxy env vars (weaker but functional).
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
      console.log('  Note: macOS/Windows — using bridge network (proxy-enforced)');
    }
  } catch (err) {
    const stderr = (err as { stderr?: Buffer }).stderr?.toString() || '';
    if (stderr.includes('already exists')) {
      return;
    }
    throw new Error(`Failed to create Docker network: ${stderr.split('\n')[0]}`);
  }
}

/**
 * Get the IP the container should use to reach ACP on the host.
 */
export function getGatewayIp(): string {
  const platform = os.platform();

  if (platform === 'darwin' || platform === 'win32') {
    return 'acp-host';
  }

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
 * Pull a Docker image if not cached locally.
 */
export function pullImage(image: string): void {
  try {
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
 */
export function detectImage(command: string[]): string {
  if (command.length === 0) return DEFAULT_IMAGE;
  const firstWord = command[0].split('/').pop() || '';
  return IMAGE_MAP[firstWord] || DEFAULT_IMAGE;
}

/**
 * Run the agent inside a contained Docker container.
 *
 *   - --network=acp-jail: internal network, no internet
 *   - --read-only: container filesystem is read-only
 *   - --cap-drop=ALL: no Linux capabilities
 *   - --security-opt=no-new-privileges: no privilege escalation
 *   - --tmpfs /tmp: writable temp dir inside container
 *   - -v workspace:/workspace: agent's working directory
 *   - HTTP_PROXY/HTTPS_PROXY point to ACP proxy
 */
export function runContained(options: DockerContainerOptions): ChildProcess {
  const {
    image,
    command,
    workspaceDir,
    proxyHost,
    consentPort,
    httpProxyPort,
    wrapperBinDir,
    memoryLimit = '2g',
    pidsLimit = 256,
    interactive = false,
    writable = false,
    env = {},
  } = options;

  const httpProxyUrl = `http://${proxyHost}:${httpProxyPort}`;

  // Run as workspace directory owner UID/GID
  let userFlag: string[] = [];
  try {
    const stat = fs.statSync(workspaceDir);
    userFlag = ['--user', `${stat.uid}:${stat.gid}`];
  } catch {
    // Fall back to running as root
  }

  const platform = os.platform();
  const args = [
    'run', '--rm',
    ...(interactive ? ['-it'] : []),
    ...userFlag,
    `--network=${NETWORK_NAME}`,
    ...(platform === 'darwin' || platform === 'win32'
      ? ['--add-host=acp-host:host-gateway', '--dns=127.0.0.1']
      : []),
    ...(writable ? [] : ['--read-only']),
    '--tmpfs', '/tmp:size=100m',
    '--tmpfs', '/home:size=50m',
    '--tmpfs', '/root:size=50m',
    '--tmpfs', '/var/tmp:size=100m',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    `--pids-limit=${pidsLimit}`,
    `--memory=${memoryLimit}`,
    '-v', `${workspaceDir}:/workspace`,
    '-w', '/workspace',
  // Proxy environment
  '-e', `HTTP_PROXY=${httpProxyUrl}`,
  '-e', `HTTPS_PROXY=${httpProxyUrl}`,
  '-e', `http_proxy=${httpProxyUrl}`,
  '-e', `https_proxy=${httpProxyUrl}`,
  // Proxy for Node libraries that honor global-agent
  '-e', `GLOBAL_AGENT_HTTP_PROXY=${httpProxyUrl}`,
  '-e', `GLOBAL_AGENT_HTTPS_PROXY=${httpProxyUrl}`,
  '-e', `NO_PROXY=${proxyHost}`,
    '-e', `ACP_CONSENT_URL=http://${proxyHost}:${consentPort}`,
    '-e', 'ACP_SANDBOX=1',
    '-e', 'ACP_CONTAINED=1',
    '-e', 'ACP_VERSION=0.3.0',
    '-e', 'HOME=/workspace',
  ];

  // Mount shell wrappers if generated
  if (wrapperBinDir) {
    args.push('-v', `${wrapperBinDir}:/usr/local/bin/acp-wrappers:ro`);
    // Query the image's default PATH so we don't lose custom entries
    let containerPath = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
    try {
      const envJson = execSync(
        `docker inspect --format '{{json .Config.Env}}' ${image}`,
        { encoding: 'utf-8', stdio: 'pipe', timeout: 10000 }
      ).trim();
      const envVars: string[] = JSON.parse(envJson);
      const pathVar = envVars.find(e => e.startsWith('PATH='));
      if (pathVar) containerPath = pathVar.substring(5);
    } catch { /* use default */ }
    // Also add workspace npm bins so host-installed binaries are available
    const workspaceBins = '/workspace/.npm-global/bin:/workspace/node_modules/.bin';
    args.push('-e', `PATH=/usr/local/bin/acp-wrappers:${workspaceBins}:${containerPath}`);
  }

  // Custom environment variables
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
 * Force-stop and remove any running containers on the acp-jail network.
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
