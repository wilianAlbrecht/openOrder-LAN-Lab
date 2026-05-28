import { randomUUID } from "node:crypto";
import type { Role } from "../roles/index.ts";

export type PairingQrPayload = {
  deviceName: string;
  deviceId: string;
  callbackIp: string;
  callbackPort: number;
  nonce: string;
  appVersion: string;
};

export type PendingPairingRequest = PairingQrPayload & {
  id: string;
  requestedAt: Date;
  status: "PENDING" | "ACCEPTED" | "DENIED";
};

export type ClientPairingSession = {
  token: string;
  sessionId: string;
  role: Role;
  hostIp: string;
  hostPort: number;
  deviceId: string;
  pairedAt: Date;
};

const pendingPairingRequests = new Map<string, PendingPairingRequest>();
let clientPairingSession: ClientPairingSession | null = null;

export function createPendingPairingRequest(payload: PairingQrPayload) {
  const request: PendingPairingRequest = {
    ...payload,
    id: randomUUID(),
    requestedAt: new Date(),
    status: "PENDING",
  };

  pendingPairingRequests.set(request.id, request);

  return request;
}

export function getPendingPairingRequests() {
  return [...pendingPairingRequests.values()].sort(
    (left, right) => right.requestedAt.getTime() - left.requestedAt.getTime(),
  );
}

export function acceptPendingPairingRequest(id: string) {
  const request = pendingPairingRequests.get(id);

  if (!request || request.status !== "PENDING") {
    return null;
  }

  const acceptedRequest: PendingPairingRequest = {
    ...request,
    status: "ACCEPTED",
  };

  pendingPairingRequests.set(id, acceptedRequest);

  return acceptedRequest;
}

export function denyPendingPairingRequest(id: string) {
  const request = pendingPairingRequests.get(id);

  if (!request || request.status !== "PENDING") {
    return null;
  }

  const deniedRequest: PendingPairingRequest = {
    ...request,
    status: "DENIED",
  };

  pendingPairingRequests.set(id, deniedRequest);

  return deniedRequest;
}

export function saveClientPairingSession(session: ClientPairingSession) {
  clientPairingSession = session;

  return clientPairingSession;
}

export function getClientPairingSession() {
  return clientPairingSession;
}
