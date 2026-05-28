import { randomUUID } from "node:crypto";
import type { Role } from "../roles/index.ts";

export type HostSession = {
  sessionId: string;
  port: number;
  startedAt: Date;
};

export type TrustedDevice = {
  deviceId: string;
  name: string;
  role: Role;
  tokenHash: string;
  lastSeen: Date;
};

export type ConnectedDevice = {
  deviceId: string;
  connectedAt: Date;
  lastSeen: Date;
};

export type HostState = {
  mode: "CLOSED" | "OPEN";
  session: HostSession | null;
  trustedDevices: TrustedDevice[];
  connectedDevices: ConnectedDevice[];
};

const trustedDevices = new Map<string, TrustedDevice>();
const connectedDevices = new Map<string, ConnectedDevice>();

let activeSession: HostSession | null = null;

export function startHostSession(port: number): HostState {
  if (!activeSession) {
    activeSession = {
      sessionId: randomUUID(),
      port,
      startedAt: new Date(),
    };
  }

  return getHostState();
}

export function closeHostSession(): HostState {
  activeSession = null;
  connectedDevices.clear();

  return getHostState();
}

export function getHostState(): HostState {
  return {
    mode: activeSession ? "OPEN" : "CLOSED",
    session: activeSession,
    trustedDevices: [...trustedDevices.values()],
    connectedDevices: [...connectedDevices.values()],
  };
}

export function getActiveHostSession() {
  return activeSession;
}

export function trustDevice(device: Omit<TrustedDevice, "lastSeen">): HostState {
  trustedDevices.set(device.deviceId, {
    ...device,
    lastSeen: new Date(),
  });

  return getHostState();
}

export function markDeviceConnected(deviceId: string): HostState {
  const now = new Date();
  const connectedDevice = connectedDevices.get(deviceId);

  connectedDevices.set(deviceId, {
    deviceId,
    connectedAt: connectedDevice?.connectedAt ?? now,
    lastSeen: now,
  });

  return getHostState();
}

export function markDeviceDisconnected(deviceId: string): HostState {
  connectedDevices.delete(deviceId);

  return getHostState();
}
