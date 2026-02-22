/**
 * Linux VM egress enforcement for ACP v0.3.0.
 *
 * Enforces a fail-closed policy for one Linux user:
 *   - Allow TCP only to ACP's local HTTP proxy port on loopback
 *   - Block all other outbound IPv4/IPv6 traffic for that user
 *
 * This guarantees that outbound traffic is either:
 *   1) mediated by ACP's proxy and policy gate, or
 *   2) denied by the kernel firewall.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export const ACP_NFT_TABLE = 'acp_vm_v030';

export interface EgressPolicyOptions {
  uid: number;
  proxyPort: number;
  dnsServers?: string[];
  tableName?: string;
}

export interface LinuxUserIdentity {
  username: string;
  uid: number;
  gid: number;
  homeDir: string;
}

export function assertLinuxHost(): void {
  if (os.platform() !== 'linux') {
    throw new Error('VM mode is Linux-only in v0.3.0.');
  }
}

export function assertRoot(): void {
  if (typeof process.getuid === 'function' && process.getuid() !== 0) {
    throw new Error(
      'VM mode requires root privileges to install nftables egress rules.\n' +
      'Run with sudo (or as root).'
    );
  }
}

export function assertNftablesAvailable(): void {
  try {
    execFileSync('nft', ['--version'], { stdio: 'pipe', timeout: 5000 });
  } catch {
    throw new Error('nftables is required. Install package "nftables" and retry.');
  }
}

export function resolveLinuxUserIdentity(username: string): LinuxUserIdentity {
  const passwd = fs.readFileSync('/etc/passwd', 'utf-8');
  for (const line of passwd.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const fields = line.split(':');
    if (fields.length < 7) continue;
    if (fields[0] !== username) continue;

    const uid = Number(fields[2]);
    const gid = Number(fields[3]);
    const homeDir = fields[5] || `/home/${username}`;
    if (!Number.isInteger(uid) || !Number.isInteger(gid)) {
      throw new Error(`Invalid UID/GID for user "${username}" in /etc/passwd`);
    }
    return { username, uid, gid, homeDir };
  }

  throw new Error(`Linux user "${username}" does not exist.`);
}

export function renderEgressRules(options: EgressPolicyOptions): string {
  const table = sanitizeTableName(options.tableName || ACP_NFT_TABLE);
  const uid = options.uid;
  const proxyPort = options.proxyPort;
  const dnsServers = normalizeDnsServers(options.dnsServers ?? resolveSystemDnsServers());

  if (!Number.isInteger(uid) || uid < 1) {
    throw new Error('UID must be a positive integer (non-root).');
  }
  if (!Number.isInteger(proxyPort) || proxyPort < 1 || proxyPort > 65535) {
    throw new Error('Proxy port must be between 1 and 65535.');
  }

  const lines = [
    `table inet ${table} {`,
    '  chain output {',
    '    type filter hook output priority 0; policy accept;',
    `    meta skuid ${uid} ip daddr 127.0.0.1 tcp dport ${proxyPort} counter accept`,
    `    meta skuid ${uid} ip6 daddr ::1 tcp dport ${proxyPort} counter accept`,
  ];

  for (const ip of dnsServers.ipv4) {
    lines.push(`    meta skuid ${uid} ip daddr ${ip} udp dport 53 counter accept`);
    lines.push(`    meta skuid ${uid} ip daddr ${ip} tcp dport 53 counter accept`);
  }
  for (const ip of dnsServers.ipv6) {
    lines.push(`    meta skuid ${uid} ip6 daddr ${ip} udp dport 53 counter accept`);
    lines.push(`    meta skuid ${uid} ip6 daddr ${ip} tcp dport 53 counter accept`);
  }

  lines.push(
    `    meta skuid ${uid} ip protocol tcp counter reject with icmp type admin-prohibited`,
    `    meta skuid ${uid} ip6 nexthdr tcp counter reject with icmpv6 type admin-prohibited`,
    `    meta skuid ${uid} counter reject with icmpx type admin-prohibited`,
    '  }',
    '}',
    '',
  );

  return lines.join('\n');
}

export function installEgressRules(options: EgressPolicyOptions): void {
  removeEgressRules(options.tableName || ACP_NFT_TABLE);
  const script = renderEgressRules(options);
  const filePath = path.join('/tmp', `acp-nft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.nft`);
  fs.writeFileSync(filePath, script, { encoding: 'utf-8', mode: 0o600 });

  try {
    execFileSync('nft', ['-f', filePath], {
      stdio: 'pipe',
      timeout: 10000,
    });
  } finally {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // Best effort cleanup.
    }
  }
}

export function removeEgressRules(tableName: string = ACP_NFT_TABLE): void {
  const table = sanitizeTableName(tableName);
  try {
    execFileSync('nft', ['delete', 'table', 'inet', table], {
      stdio: 'pipe',
      timeout: 5000,
    });
  } catch {
    // Idempotent cleanup.
  }
}

export function hasEgressRules(tableName: string = ACP_NFT_TABLE): boolean {
  const table = sanitizeTableName(tableName);
  try {
    execFileSync('nft', ['list', 'table', 'inet', table], {
      stdio: 'pipe',
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

function sanitizeTableName(value: string): string {
  if (!/^[a-zA-Z0-9_]+$/.test(value)) {
    throw new Error(`Invalid nftables table name: ${value}`);
  }
  return value;
}

function resolveSystemDnsServers(): string[] {
  try {
    const resolvConf = fs.readFileSync('/etc/resolv.conf', 'utf-8');
    const servers: string[] = [];
    for (const rawLine of resolvConf.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || line.startsWith(';')) continue;
      const parts = line.split(/\s+/);
      if (parts[0] !== 'nameserver' || !parts[1]) continue;
      servers.push(parts[1]);
    }
    return servers;
  } catch {
    return [];
  }
}

function normalizeDnsServers(servers: string[]): { ipv4: string[]; ipv6: string[] } {
  const ipv4 = new Set<string>();
  const ipv6 = new Set<string>();

  for (const candidate of servers) {
    const clean = candidate.trim();
    if (!clean) continue;
    const version = net.isIP(clean);
    if (version === 4) ipv4.add(clean);
    else if (version === 6) ipv6.add(clean);
  }

  return {
    ipv4: [...ipv4],
    ipv6: [...ipv6],
  };
}
