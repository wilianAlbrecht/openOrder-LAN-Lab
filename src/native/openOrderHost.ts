import { registerPlugin } from "@capacitor/core";

type HostSession = {
  sessionId: string;
  port: number;
  startedAt: string;
};

type HostState = {
  mode: "CLOSED" | "OPEN";
  session: HostSession | null;
  trustedDevices: unknown[];
  connectedDevices: unknown[];
};

type NativeHostState = HostState & {
  apiBaseUrl?: string;
  hostIp?: string;
};

type OpenOrderHostPlugin = {
  start(options: { port: number }): Promise<NativeHostState>;
  close(): Promise<HostState>;
  status(): Promise<NativeHostState>;
};

export const OpenOrderHost = registerPlugin<OpenOrderHostPlugin>(
  "OpenOrderHost",
);
