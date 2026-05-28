import { Capacitor } from "@capacitor/core";
import { ZeroConf, type ZeroConfService } from "capacitor-zeroconf";

export type ClientDevice = {
  deviceId: string;
  deviceName: string;
  appVersion: string;
};

export type DiscoveredHost = {
  id: string;
  name: string;
  host: string;
  addresses: string[];
  port: number;
  version: string;
  serviceType: string;
  lastSeen: string;
};

const openOrderServiceType = "_openorder._tcp.";
const openOrderServiceDomain = "local.";

const nativeDiscoveredHosts = new Map<string, DiscoveredHost>();
let nativeDiscoverySetup: Promise<void> | null = null;

export async function discoverOpenOrderHosts(
  fallbackApiBaseUrl: string | null,
): Promise<DiscoveredHost[]> {
  if (Capacitor.isNativePlatform()) {
    return discoverOpenOrderHostsWithNativeMdns();
  }

  if (!fallbackApiBaseUrl) {
    throw new Error("Discovery backend unavailable");
  }

  const response = await fetch(`${fallbackApiBaseUrl}/api/client/discovery/start`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("Discovery start failed");
  }

  const data = (await response.json()) as { hosts: DiscoveredHost[] };

  return data.hosts;
}

export async function refreshOpenOrderHosts(
  fallbackApiBaseUrl: string | null,
): Promise<DiscoveredHost[]> {
  if (Capacitor.isNativePlatform()) {
    return discoverOpenOrderHostsWithNativeMdns();
  }

  if (!fallbackApiBaseUrl) {
    throw new Error("Discovery backend unavailable");
  }

  const response = await fetch(`${fallbackApiBaseUrl}/api/client/discovery/hosts`);

  if (!response.ok) {
    throw new Error("Discovery hosts failed");
  }

  const data = (await response.json()) as { hosts: DiscoveredHost[] };

  return data.hosts;
}

export function getHostApiBaseUrl(host: DiscoveredHost) {
  return `http://${host.addresses[0] ?? host.host}:${host.port}`;
}

async function discoverOpenOrderHostsWithNativeMdns() {
  await ensureNativeDiscovery();
  await wait(5000);

  return [...nativeDiscoveredHosts.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

async function ensureNativeDiscovery() {
  nativeDiscoverySetup ??= setupNativeDiscovery();

  return nativeDiscoverySetup;
}

async function setupNativeDiscovery() {
  await ZeroConf.watch({
    type: openOrderServiceType,
    domain: openOrderServiceDomain,
    addressFamily: "ipv4",
  } as never, (result) => {
    if (result.action === "removed") {
      nativeDiscoveredHosts.delete(createNativeHostId(result.service));
      return;
    }

    const host = toDiscoveredHost(result.service);

    if (host.addresses.length > 0) {
      nativeDiscoveredHosts.set(host.id, host);
    }
  });
}

function toDiscoveredHost(service: ZeroConfService): DiscoveredHost {
  const port = Number(service.txtRecord.port ?? service.port);
  const addresses = [
    service.txtRecord.hostIp,
    ...service.ipv4Addresses,
  ].filter((address): address is string => Boolean(address));

  return {
    id: createNativeHostId(service),
    name: service.txtRecord.name ?? service.name,
    host: service.hostname,
    addresses,
    port,
    version: service.txtRecord.version ?? "unknown",
    serviceType: "_openorder._tcp.local",
    lastSeen: new Date().toISOString(),
  };
}

function createNativeHostId(service: ZeroConfService) {
  return `${service.name}:${service.hostname}:${service.port}`;
}

function wait(milliseconds: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}
