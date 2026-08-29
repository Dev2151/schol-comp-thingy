import { Bonjour, Service } from 'bonjour-service';
import { NodeInfo, MDNS_SERVICE_TYPE, TCP_DEFAULT_PORT } from '../../shared/types';
import * as os from 'os';

const bonjour = new Bonjour();

let publishedService: Service | null = null;
let discoveredNodes: Map<string, NodeInfo> = new Map();

/**
 * Publish this node as an mDNS service on the local network.
 */
export function publishNode(nodeId: string, port: number = TCP_DEFAULT_PORT): void {
  const hostname = os.hostname();

  publishedService = bonjour.publish({
    name: `title-tbd-${hostname}`,
    type: MDNS_SERVICE_TYPE.replace('.', ''), // bonjour-service expects type without leading dot
    port,
    txt: {
      nodeId,
      hostname,
      version: '0.1.0',
    },
  });

  console.log(`[mDNS] Published node: ${hostname} (${nodeId.slice(0, 8)}) on port ${port}`);
}

/**
 * Start browsing for other Title TBD nodes on the local network.
 * Calls onNodeFound when a new node is discovered.
 */
export function startDiscovery(
  onNodeFound: (info: NodeInfo) => void,
  onNodeLost: (nodeId: string) => void
): void {
  const browser = bonjour.find({ type: MDNS_SERVICE_TYPE.replace('.', '') }, (service: Service) => {
    // Ignore our own service
    if (service.name?.startsWith(`title-tbd-${os.hostname()}`)) {
      return;
    }

    const nodeId = service.txt?.nodeId as string;
    const hostname = service.txt?.hostname as string || service.name || 'unknown';

    if (!nodeId) return;

    const nodeInfo: NodeInfo = {
      nodeId,
      hostname,
      ip: service.referer?.address || '0.0.0.0',
      port: service.port || TCP_DEFAULT_PORT,
      storageOffered: 2 * 1024 * 1024 * 1024, // Default 2GB
      storageUsed: 0,
      status: 'online',
      nodeType: 'desktop',
      isRelay: false,
      lastSeen: Date.now(),
    };

    discoveredNodes.set(nodeId, nodeInfo);
    onNodeFound(nodeInfo);

    console.log(`[mDNS] Found node: ${hostname} (${nodeId.slice(0, 8)}) at ${nodeInfo.ip}:${nodeInfo.port}`);
  });

  // Note: Service departure tracking is handled by the heartbeat/timeout mechanism
  // in the network manager, not via mDNS events (which are unreliable for departures)

  console.log('[mDNS] Started browsing for Title TBD nodes...');
}

/**
 * Get all discovered nodes.
 */
export function getDiscoveredNodes(): NodeInfo[] {
  return Array.from(discoveredNodes.values());
}

/**
 * Stop publishing and browsing.
 */
export function stopDiscovery(): void {
  if (publishedService) {
    publishedService.stop();
    publishedService = null;
  }
  bonjour.destroy();
  discoveredNodes.clear();
  console.log('[mDNS] Stopped discovery');
}
