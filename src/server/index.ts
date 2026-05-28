import Fastify from "fastify";
import { WebSocketServer } from "ws";
import { createRuntimeToken, hashToken } from "../auth/index.ts";
import {
  closeHostSession,
  getActiveHostSession,
  getHostState,
  markDeviceConnected,
  markDeviceDisconnected,
  startHostSession,
  trustDevice,
} from "../host/index.ts";
import {
  getDiscoveredOpenOrderHosts,
  getLanIpAddress,
  getOpenOrderMdnsPublishState,
  publishOpenOrderHost,
  startOpenOrderDiscovery,
  stopOpenOrderDiscovery,
  unpublishOpenOrderHost,
} from "../mdns/index.ts";
import {
  acceptPendingPairingRequest,
  createPendingPairingRequest,
  denyPendingPairingRequest,
  getClientPairingSession,
  getPendingPairingRequests,
  saveClientPairingSession,
  type ClientPairingSession,
  type PairingQrPayload,
} from "../pairing/index.ts";
import { roles, type Role } from "../roles/index.ts";
import { createMessage, parseMessage } from "../websocket/index.ts";

const bindHost = "0.0.0.0";
const port = Number(process.env.OPENORDER_PORT ?? 8787);
const server = Fastify({ logger: true });
const webSocketServer = new WebSocketServer({
  noServer: true,
});

server.addHook("onRequest", async (_request, reply) => {
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  reply.header("Access-Control-Allow-Headers", "Content-Type,Authorization");
});

server.options("/*", async (_request, reply) => {
  reply.status(204).send();
});

server.get("/health", async () => ({
  ok: true,
  service: "openorder-lan-host",
}));

server.get("/api/host/status", async () => getHostState());

server.get("/api/host/mdns", async () => getOpenOrderMdnsPublishState());

server.post("/api/host/start", async (_request, reply) => {
  const state = startHostSession(port);

  if (state.session) {
    try {
      publishOpenOrderHost(port, state.session.sessionId);
    } catch {
      closeHostSession();
      return reply.status(409).send({ reason: "LAN_IP_NOT_FOUND" });
    }
  }

  return state;
});

server.post("/api/host/close", async () => {
  unpublishOpenOrderHost();

  return closeHostSession();
});

server.post("/api/client/discovery/start", async () => ({
  hosts: startOpenOrderDiscovery(),
}));

server.post("/api/client/discovery/stop", async () => {
  stopOpenOrderDiscovery();

  return { hosts: getDiscoveredOpenOrderHosts() };
});

server.get("/api/client/discovery/hosts", async () => ({
  hosts: getDiscoveredOpenOrderHosts(),
}));

server.post("/api/host/pairing/requests", async (request, reply) => {
  const payload = request.body as Partial<PairingQrPayload>;

  if (!isPairingQrPayload(payload)) {
    return reply.status(400).send({ reason: "INVALID_PAIRING_QR" });
  }

  return createPendingPairingRequest(payload);
});

server.get("/api/host/pairing/requests", async () => ({
  requests: getPendingPairingRequests(),
}));

server.post("/api/host/pairing/requests/:id/approve", async (request, reply) => {
  const params = request.params as { id: string };
  const body = request.body as { role?: Role };
  const activeSession = getActiveHostSession();

  if (!activeSession) {
    return reply.status(409).send({ reason: "HOST_SESSION_CLOSED" });
  }

  if (!body.role || !roles.includes(body.role)) {
    return reply.status(400).send({ reason: "INVALID_ROLE" });
  }

  const pairingRequest = acceptPendingPairingRequest(params.id);

  if (!pairingRequest) {
    return reply.status(404).send({ reason: "PAIRING_REQUEST_NOT_FOUND" });
  }

  const token = createRuntimeToken();
  const hostIp = getLanIpAddress();

  if (!hostIp) {
    return reply.status(409).send({ reason: "LAN_IP_NOT_FOUND" });
  }

  const callbackPayload: ClientPairingSession = {
    token,
    sessionId: activeSession.sessionId,
    role: body.role,
    hostIp,
    hostPort: activeSession.port,
    deviceId: pairingRequest.deviceId,
    pairedAt: new Date(),
  };

  trustDevice({
    deviceId: pairingRequest.deviceId,
    name: pairingRequest.deviceName,
    role: body.role,
    tokenHash: hashToken(token),
  });

  await sendPairingCallback(pairingRequest, callbackPayload);

  return {
    request: pairingRequest,
    trustedDevices: getHostState().trustedDevices,
  };
});

server.post("/api/host/pairing/requests/:id/deny", async (request, reply) => {
  const params = request.params as { id: string };
  const pairingRequest = denyPendingPairingRequest(params.id);

  if (!pairingRequest) {
    return reply.status(404).send({ reason: "PAIRING_REQUEST_NOT_FOUND" });
  }

  return pairingRequest;
});

server.post("/pair", async (request, reply) => {
  const session = request.body as ClientPairingSession;

  if (!isClientPairingSession(session)) {
    return reply.status(400).send({ reason: "INVALID_PAIRING_SESSION" });
  }

  return saveClientPairingSession(session);
});

server.post("/api/client/pair", async (request, reply) => {
  const session = request.body as ClientPairingSession;

  if (!isClientPairingSession(session)) {
    return reply.status(400).send({ reason: "INVALID_PAIRING_SESSION" });
  }

  return saveClientPairingSession(session);
});

server.get("/api/client/session", async () => ({
  session: getClientPairingSession(),
}));

server.server.on("upgrade", (request, socket, head) => {
  if (request.url !== "/ws") {
    socket.destroy();
    return;
  }

  webSocketServer.handleUpgrade(request, socket, head, (connection) => {
    webSocketServer.emit("connection", connection, request);
  });
});

webSocketServer.on("connection", (connection) => {
  const deviceId = crypto.randomUUID();

  markDeviceConnected(deviceId);

  connection.send(JSON.stringify(createMessage("STATE_SYNC", getHostState())));

  connection.on("message", (rawMessage) => {
    const message = parseMessage(rawMessage.toString());

    if (!message) {
      connection.send(
        JSON.stringify(createMessage("ERROR", { reason: "INVALID_MESSAGE" })),
      );
      return;
    }

    if (message.type === "PING") {
      connection.send(JSON.stringify(createMessage("PONG", getHostState())));
    }
  });

  connection.on("close", () => {
    markDeviceDisconnected(deviceId);
  });
});

await server.listen({ host: bindHost, port });

function isPairingQrPayload(
  payload: Partial<PairingQrPayload>,
): payload is PairingQrPayload {
  return (
    typeof payload.deviceName === "string" &&
    typeof payload.deviceId === "string" &&
    typeof payload.callbackIp === "string" &&
    typeof payload.callbackPort === "number" &&
    typeof payload.nonce === "string" &&
    typeof payload.appVersion === "string"
  );
}

function isClientPairingSession(
  session: Partial<ClientPairingSession>,
): session is ClientPairingSession {
  return (
    typeof session.token === "string" &&
    typeof session.sessionId === "string" &&
    typeof session.hostIp === "string" &&
    typeof session.hostPort === "number" &&
    typeof session.deviceId === "string" &&
    roles.includes(session.role as Role)
  );
}

async function sendPairingCallback(
  pairingRequest: PairingQrPayload,
  payload: ClientPairingSession,
) {
  const callbackUrls = [
    `http://${pairingRequest.callbackIp}:${pairingRequest.callbackPort}/pair`,
    `http://${pairingRequest.callbackIp}:${pairingRequest.callbackPort}/api/client/pair`,
  ];

  let lastError: unknown = null;

  for (const callbackUrl of callbackUrls) {
    try {
      const response = await fetch(callbackUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        return;
      }

      lastError = new Error(`Pairing callback failed with ${response.status}`);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}
