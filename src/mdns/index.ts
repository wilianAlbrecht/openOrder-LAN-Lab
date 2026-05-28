import Bonjour from "bonjour-service";
import { hostname, networkInterfaces } from "node:os";

export const OPENORDER_SERVICE_TYPE = "openorder";
export const OPENORDER_SERVICE_PROTOCOL = "tcp";
export const OPENORDER_SERVICE_NAME = "OpenOrder Host";

export type OpenOrderMdnsHost = {
  id: string;
  name: string;
  host: string;
  addresses: string[];
  port: number;
  version: string;
  serviceType: string;
  lastSeen: Date;
};

export type OpenOrderMdnsPublishState = {
  published: boolean;
  name: string;
  type: string;
  port: number;
  hostIp: string | null;
  sessionId: string | null;
};

type MdnsService = {
  name: string;
  type: string;
  protocol: "tcp" | "udp";
  host: string;
  port: number;
  txt?: Record<string, unknown>;
  addresses?: string[];
  published?: boolean;
  stop: CallableFunction;
};

type MdnsBrowser = {
  start: () => void;
  stop: () => void;
  update: () => void;
  on: (
    event: "down" | "txt-update" | "srv-update",
    listener: (service: MdnsService) => void,
  ) => void;
};

const bonjour = new Bonjour(undefined, (error: unknown) => {
  console.error("mDNS error", error);
});

const discoveredHosts = new Map<string, OpenOrderMdnsHost>();

let publishedService: MdnsService | null = null;
let publishedState: OpenOrderMdnsPublishState | null = null;
let browser: MdnsBrowser | null = null;

export function publishOpenOrderHost(port: number, sessionId: string) {
  if (publishedService) {
    return publishedService;
  }

  const hostIp = getLanIpAddress();

  if (!hostIp) {
    throw new Error("LAN_IP_NOT_FOUND");
  }

  const serviceName = `${OPENORDER_SERVICE_NAME} ${hostname()}`;

  publishedService = bonjour.publish({
    name: serviceName,
    type: OPENORDER_SERVICE_TYPE,
    protocol: OPENORDER_SERVICE_PROTOCOL,
    port,
    probe: false,
    disableIPv6: true,
    txt: {
      name: OPENORDER_SERVICE_NAME,
      service: "openorder",
      state: "open",
      sessionId,
      version: "1.0.0",
      port: String(port),
      hostIp,
    },
  });

  publishedState = {
    published: true,
    name: serviceName,
    type: `_${OPENORDER_SERVICE_TYPE}._${OPENORDER_SERVICE_PROTOCOL}.local`,
    port,
    hostIp,
    sessionId,
  };

  return publishedService;
}

export function unpublishOpenOrderHost() {
  if (!publishedService) {
    return;
  }

  publishedService.stop();
  publishedService = null;
  publishedState = null;
}

export function getOpenOrderMdnsPublishState(): OpenOrderMdnsPublishState {
  return (
    publishedState ?? {
      published: false,
      name: OPENORDER_SERVICE_NAME,
      type: `_${OPENORDER_SERVICE_TYPE}._${OPENORDER_SERVICE_PROTOCOL}.local`,
      port: 0,
      hostIp: getLanIpAddress(),
      sessionId: null,
    }
  );
}

export function startOpenOrderDiscovery() {
  if (browser) {
    browser.update();
    return getDiscoveredOpenOrderHosts();
  }

  browser = bonjour.find(
    {
      type: OPENORDER_SERVICE_TYPE,
      protocol: OPENORDER_SERVICE_PROTOCOL,
    },
    (service: MdnsService) => {
      rememberOpenOrderHost(service);
    },
  ) as MdnsBrowser;

  browser.on("down", (service) => {
    discoveredHosts.delete(createServiceId(service));
  });

  browser.on("txt-update", (service) => {
    rememberOpenOrderHost(service);
  });

  browser.on("srv-update", (service) => {
    rememberOpenOrderHost(service);
  });

  browser.start();
  browser.update();

  return getDiscoveredOpenOrderHosts();
}

export function stopOpenOrderDiscovery() {
  browser?.stop();
  browser = null;
}

export function getDiscoveredOpenOrderHosts() {
  return [...discoveredHosts.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

function rememberOpenOrderHost(service: MdnsService) {
  if (service.type !== OPENORDER_SERVICE_TYPE) {
    return;
  }

  const hostIp = readTxtValue(service.txt?.hostIp);

  discoveredHosts.set(createServiceId(service), {
    id: createServiceId(service),
    name: readTxtValue(service.txt?.name) ?? service.name,
    host: service.host,
    addresses: [hostIp, ...(service.addresses ?? [])].filter(
      (address): address is string => Boolean(address),
    ),
    port: service.port,
    version: readTxtValue(service.txt?.version) ?? "unknown",
    serviceType: `_${service.type}._${service.protocol}.local`,
    lastSeen: new Date(),
  });
}

function createServiceId(service: MdnsService) {
  return `${service.name}:${service.host}:${service.port}`;
}

function readTxtValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }

  if (typeof value === "number") {
    return String(value);
  }

  return null;
}

export function getLanIpAddress() {
  for (const interfaces of Object.values(networkInterfaces())) {
    for (const networkInterface of interfaces ?? []) {
      if (networkInterface.family === "IPv4" && !networkInterface.internal) {
        return networkInterface.address;
      }
    }
  }

  return null;
}
