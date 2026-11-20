import os from 'node:os';

export interface NetworkInfo {
  lanIps: string[];
  primaryLanIp: string | null;
  hostname: string;
}

/**
 * Discovers private LAN IPv4 addresses on this machine so QR codes
 * can point phones directly to the host computer on the same Wi-Fi.
 */
export function getLocalNetworkInfo(): NetworkInfo {
  const interfaces = os.networkInterfaces();
  const candidates: Array<{ ip: string; priority: number }> = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      const ip = addr.address;
      // Prioritize typical Wi-Fi/Ethernet interfaces (en0, eth0, wlan0) & 192.168.x.x / 10.x.x.x
      let priority = 0;
      if (name.startsWith('en') || name.startsWith('eth') || name.startsWith('wlan')) {
        priority += 10;
      }
      if (ip.startsWith('192.168.')) {
        priority += 5;
      } else if (ip.startsWith('10.')) {
        priority += 4;
      } else if (ip.startsWith('172.')) {
        priority += 3;
      }
      // Deprioritize virtual docker/bridge/utun interfaces
      if (
        name.startsWith('utun') ||
        name.startsWith('docker') ||
        name.startsWith('veth') ||
        name.startsWith('bridge')
      ) {
        priority -= 10;
      }
      candidates.push({ ip, priority });
    }
  }

  candidates.sort((a, b) => b.priority - a.priority);
  const lanIps = Array.from(new Set(candidates.map((c) => c.ip)));

  return {
    lanIps,
    primaryLanIp: lanIps[0] ?? null,
    hostname: os.hostname(),
  };
}
