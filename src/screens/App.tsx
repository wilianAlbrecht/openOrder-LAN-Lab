import { useEffect, useMemo, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Html5QrcodeScanner } from "html5-qrcode";
import QRCode from "qrcode";
import { ZeroConf } from "capacitor-zeroconf";
import {
  discoverOpenOrderHosts,
  getHostApiBaseUrl,
  refreshOpenOrderHosts,
  type DiscoveredHost,
} from "../client/index.ts";
import { OpenOrderHost } from "../native/openOrderHost.ts";
import type {
  ClientPairingSession,
  PairingQrPayload,
  PendingPairingRequest,
} from "../pairing/index.ts";
import { roles, type Role } from "../roles/index.ts";

type HostSession = {
  sessionId: string;
  port: number;
  startedAt: string;
};

type TrustedDevice = {
  deviceId: string;
  name: string;
  role: Role;
  tokenHash: string;
  lastSeen: string;
};

type HostState = {
  mode: "CLOSED" | "OPEN";
  session: HostSession | null;
  trustedDevices: TrustedDevice[];
  connectedDevices: unknown[];
};

const initialHostState: HostState = {
  mode: "CLOSED",
  session: null,
  trustedDevices: [],
  connectedDevices: [],
};

const openOrderPort = 8787;

export function App() {
  const isNativeApp = Capacitor.isNativePlatform();
  const defaultApiBaseUrl = useMemo(() => {
    if (isNativeApp || !window.location.hostname) {
      return null;
    }

    const hostname = window.location.hostname;
    const protocol = window.location.protocol === "https:" ? "https:" : "http:";

    return `${protocol}//${hostname}:${openOrderPort}`;
  }, [isNativeApp]);
  const [apiBaseUrl, setApiBaseUrl] = useState<string | null>(defaultApiBaseUrl);
  const [hostState, setHostState] = useState<HostState>(initialHostState);
  const [requestState, setRequestState] = useState<"idle" | "loading" | "error">(
    "idle",
  );
  const [discoveryState, setDiscoveryState] = useState<
    "idle" | "searching" | "found" | "error"
  >("idle");
  const [discoveredHosts, setDiscoveredHosts] = useState<DiscoveredHost[]>([]);
  const [selectedHost, setSelectedHost] = useState<DiscoveredHost | null>(null);
  const [pairingQrPayload, setPairingQrPayload] =
    useState<PairingQrPayload | null>(null);
  const [pairingQrImage, setPairingQrImage] = useState<string | null>(null);
  const [scannedPayload, setScannedPayload] = useState("");
  const [pendingPairingRequests, setPendingPairingRequests] = useState<
    PendingPairingRequest[]
  >([]);
  const [selectedRole, setSelectedRole] = useState<Role>("WAITER");
  const [clientSession, setClientSession] =
    useState<ClientPairingSession | null>(null);
  const [scannerEnabled, setScannerEnabled] = useState(false);

  useEffect(() => {
    if (!apiBaseUrl) {
      return;
    }

    void fetchHostState(apiBaseUrl, setHostState, setRequestState);
    void fetchPairingRequests(apiBaseUrl, setPendingPairingRequests);
    void fetchClientSession(apiBaseUrl, setClientSession);
  }, [apiBaseUrl, defaultApiBaseUrl]);

  useEffect(() => {
    if (!pairingQrPayload) {
      return;
    }

    void QRCode.toDataURL(JSON.stringify(pairingQrPayload), {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 240,
    }).then(setPairingQrImage);
  }, [pairingQrPayload]);

  useEffect(() => {
    if (!scannerEnabled) {
      return undefined;
    }

    const scanner = new Html5QrcodeScanner(
      "pairing-scanner",
      {
        fps: 8,
        qrbox: { width: 240, height: 240 },
      },
      false,
    );

    scanner.render(
      (decodedText) => {
        setScannedPayload(decodedText);
        setScannerEnabled(false);
        void scanner.clear();
      },
      () => undefined,
    );

    return () => {
      void scanner.clear();
    };
  }, [scannerEnabled]);

  async function openStore() {
    if (!isNativeApp && !apiBaseUrl) {
      setRequestState("error");
      return;
    }

    setRequestState("loading");

    try {
      if (isNativeApp) {
        const nativeHostState = await OpenOrderHost.start({ port: openOrderPort });

        if (!nativeHostState.session || !nativeHostState.hostIp) {
          throw new Error("Native host start failed");
        }

        await ZeroConf.register({
          type: "_openorder._tcp.",
          domain: "local.",
          name: "OpenOrder Host Android",
          port: openOrderPort,
          props: {
            name: "OpenOrder Host",
            service: "openorder",
            state: "open",
            sessionId: nativeHostState.session.sessionId,
            version: "1.0.0",
            port: String(openOrderPort),
            hostIp: nativeHostState.hostIp,
          },
        } as never);

        setApiBaseUrl(nativeHostState.apiBaseUrl ?? null);
        setHostState(nativeHostState as HostState);
        setRequestState("idle");
        return;
      }

      const webApiBaseUrl = apiBaseUrl;

      if (!webApiBaseUrl) {
        throw new Error("Host backend unavailable");
      }

      const response = await fetch(`${webApiBaseUrl}/api/host/start`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Host start failed");
      }

      setHostState((await response.json()) as HostState);
      await fetchPairingRequests(webApiBaseUrl, setPendingPairingRequests);
      setRequestState("idle");
    } catch {
      setRequestState("error");
    }
  }

  async function closeStore() {
    if (!isNativeApp && !apiBaseUrl) {
      setRequestState("error");
      return;
    }

    setRequestState("loading");

    try {
      if (isNativeApp) {
        await ZeroConf.unregister({
          type: "_openorder._tcp.",
          domain: "local.",
          name: "OpenOrder Host Android",
        }).catch(() => undefined);

        setHostState((await OpenOrderHost.close()) as HostState);
        setApiBaseUrl(null);
        setPendingPairingRequests([]);
        setRequestState("idle");
        return;
      }

      const webApiBaseUrl = apiBaseUrl;

      if (!webApiBaseUrl) {
        throw new Error("Host backend unavailable");
      }

      const response = await fetch(`${webApiBaseUrl}/api/host/close`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Host close failed");
      }

      setHostState((await response.json()) as HostState);
      setPendingPairingRequests([]);
      setRequestState("idle");
    } catch {
      setRequestState("error");
    }
  }

  async function searchHosts() {
    setDiscoveryState("searching");

    try {
      const hosts = await discoverOpenOrderHosts(apiBaseUrl);

      setDiscoveredHosts(hosts);
      setDiscoveryState("found");

      if (hosts[0]) {
        const discoveredApiBaseUrl = getHostApiBaseUrl(hosts[0]);

        setApiBaseUrl(discoveredApiBaseUrl);
        await fetchHostState(discoveredApiBaseUrl, setHostState, setRequestState);
      }
    } catch {
      setDiscoveryState("error");
    }
  }

  async function selectHostForPairing(host: DiscoveredHost) {
    setSelectedHost(host);
    setApiBaseUrl(getHostApiBaseUrl(host));
    const callbackIp = getRuntimeCallbackIp();

    if (!callbackIp) {
      setRequestState("error");
      return;
    }

    const payload: PairingQrPayload = {
      deviceName: navigator.userAgent.includes("Android")
        ? "Android Device"
        : "OpenOrder Device",
      deviceId: getOrCreateDeviceId(),
      callbackIp,
      callbackPort: openOrderPort,
      nonce: crypto.randomUUID(),
      appVersion: "1.0.0",
    };

    setPairingQrPayload(payload);
  }

  async function registerPairingRequest() {
    if (!apiBaseUrl) {
      setRequestState("error");
      return;
    }

    const payload = parsePairingPayload(scannedPayload);

    if (!payload) {
      setRequestState("error");
      return;
    }

    setRequestState("loading");

    try {
      const response = await fetch(`${apiBaseUrl}/api/host/pairing/requests`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error("Pairing request failed");
      }

      setScannedPayload("");
      await fetchPairingRequests(apiBaseUrl, setPendingPairingRequests);
      setRequestState("idle");
    } catch {
      setRequestState("error");
    }
  }

  async function approvePairingRequest(requestId: string) {
    if (!apiBaseUrl) {
      setRequestState("error");
      return;
    }

    setRequestState("loading");

    try {
      const response = await fetch(
        `${apiBaseUrl}/api/host/pairing/requests/${requestId}/approve`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ role: selectedRole }),
        },
      );

      if (!response.ok) {
        throw new Error("Pairing approval failed");
      }

      await fetchHostState(apiBaseUrl, setHostState, setRequestState);
      await fetchPairingRequests(apiBaseUrl, setPendingPairingRequests);
      await fetchClientSession(apiBaseUrl, setClientSession);
      setRequestState("idle");
    } catch {
      setRequestState("error");
    }
  }

  async function denyPairingRequest(requestId: string) {
    if (!apiBaseUrl) {
      setRequestState("error");
      return;
    }

    setRequestState("loading");

    try {
      const response = await fetch(
        `${apiBaseUrl}/api/host/pairing/requests/${requestId}/deny`,
        {
          method: "POST",
        },
      );

      if (!response.ok) {
        throw new Error("Pairing deny failed");
      }

      await fetchPairingRequests(apiBaseUrl, setPendingPairingRequests);
      setRequestState("idle");
    } catch {
      setRequestState("error");
    }
  }

  async function refreshHosts() {
    try {
      const hosts = await refreshOpenOrderHosts(apiBaseUrl);

      setDiscoveredHosts(hosts);
      setDiscoveryState("found");
    } catch {
      setDiscoveryState("error");
    }
  }

  return (
    <main className="app-shell">
      <section className="start-panel" aria-labelledby="app-title">
        <div className="brand">
          <h1 id="app-title">OpenOrder</h1>
          <p>Conexão local para operar em LAN, sem cloud e sem internet.</p>
        </div>

        <div className="actions">
          <button
            className="primary-action"
            disabled={
              requestState === "loading" ||
              hostState.mode === "OPEN"
            }
            type="button"
            onClick={openStore}
          >
            Abrir Loja
          </button>
          <button
            className="secondary-action"
            disabled={requestState === "loading" || discoveryState === "searching"}
            type="button"
            onClick={searchHosts}
          >
            Conectar a um dispositivo
          </button>
        </div>

        {requestState === "error" ? (
          <p className="status-error">
            Host OpenOrder indisponível na rede local.
          </p>
        ) : null}

        <section className="host-panel" aria-label="Status do host">
          <div>
            <span className="metric-label">Host</span>
            <strong>{hostState.mode === "OPEN" ? "Aberto" : "Fechado"}</strong>
          </div>
          <div>
            <span className="metric-label">Sessão</span>
            <strong>{hostState.session?.sessionId.slice(0, 8) ?? "..."}</strong>
          </div>
          <div>
            <span className="metric-label">Porta</span>
            <strong>{hostState.session?.port ?? openOrderPort}</strong>
          </div>
          <div>
            <span className="metric-label">Dispositivos</span>
            <strong>{hostState.connectedDevices.length}</strong>
          </div>
        </section>

        {hostState.mode === "OPEN" ? (
          <button
            className="text-action"
            disabled={requestState === "loading"}
            type="button"
            onClick={closeStore}
          >
            Fechar Loja
          </button>
        ) : null}

        {discoveryState !== "idle" ? (
          <section className="discovery-panel" aria-label="Hosts encontrados">
            <div className="panel-heading">
              <div>
                <span className="metric-label">Descoberta LAN</span>
                <strong>
                  {discoveryState === "error"
                    ? "Erro na busca"
                    : discoveryState === "searching"
                      ? "Procurando hosts"
                      : "Hosts encontrados"}
                </strong>
              </div>
              <button className="small-action" type="button" onClick={refreshHosts}>
                Atualizar
              </button>
            </div>

            {discoveredHosts.length > 0 ? (
              <ul className="host-list">
                {discoveredHosts.map((host) => (
                  <li key={host.id}>
                    <strong>{host.name}</strong>
                    <span>
                      {(host.addresses[0] ?? host.host)}:{host.port}
                    </span>
                    <span>{host.serviceType}</span>
                    <button
                      className="small-action"
                      type="button"
                      onClick={() => void selectHostForPairing(host)}
                    >
                      Parear
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-state">Nenhum host OpenOrder encontrado ainda.</p>
            )}
          </section>
        ) : null}

        {selectedHost && pairingQrPayload ? (
          <section className="pairing-panel" aria-label="QR temporário">
            <div className="panel-heading">
              <div>
                <span className="metric-label">Pairing</span>
                <strong>{selectedHost.name}</strong>
              </div>
            </div>

            {pairingQrImage ? (
              <img className="qr-image" src={pairingQrImage} alt="QR pairing" />
            ) : null}

            <textarea
              readOnly
              className="payload-box"
              value={JSON.stringify(pairingQrPayload)}
            />
          </section>
        ) : null}

        {hostState.mode === "OPEN" ? (
          <section className="pairing-panel" aria-label="Aprovação de pairing">
            <div className="panel-heading">
              <div>
                <span className="metric-label">Host Pairing</span>
                <strong>Solicitações</strong>
              </div>
              <button
                className="small-action"
                type="button"
                onClick={() => setScannerEnabled((enabled) => !enabled)}
              >
                Scanner
              </button>
            </div>

            {scannerEnabled ? <div id="pairing-scanner" /> : null}

            <textarea
              className="payload-box"
              placeholder="Payload do QR"
              value={scannedPayload}
              onChange={(event) => setScannedPayload(event.target.value)}
            />

            <button
              className="secondary-action"
              disabled={!scannedPayload || requestState === "loading"}
              type="button"
              onClick={registerPairingRequest}
            >
              Registrar solicitação
            </button>

            <label className="field-label">
              Role
              <select
                value={selectedRole}
                onChange={(event) => setSelectedRole(event.target.value as Role)}
              >
                {roles.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </label>

            {pendingPairingRequests.length > 0 ? (
              <ul className="host-list">
                {pendingPairingRequests.map((request) => (
                  <li key={request.id}>
                    <strong>{request.deviceName}</strong>
                    <span>{request.appVersion}</span>
                    <span>{request.status}</span>
                    {request.status === "PENDING" ? (
                      <div className="row-actions">
                        <button
                          className="small-action"
                          type="button"
                          onClick={() => void approvePairingRequest(request.id)}
                        >
                          Permitir
                        </button>
                        <button
                          className="small-danger"
                          type="button"
                          onClick={() => void denyPairingRequest(request.id)}
                        >
                          Negar
                        </button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-state">Nenhuma solicitação pendente.</p>
            )}
          </section>
        ) : null}

        {clientSession ? (
          <section className="pairing-panel" aria-label="Sessão do cliente">
            <div>
              <span className="metric-label">Cliente</span>
              <strong>Pareado como {clientSession.role}</strong>
            </div>
            <p className="empty-state">
              Sessão {clientSession.sessionId.slice(0, 8)} em{" "}
              {clientSession.hostIp}:{clientSession.hostPort}
            </p>
          </section>
        ) : null}
      </section>
    </main>
  );
}

async function fetchHostState(
  apiBaseUrl: string,
  setHostState: (hostState: HostState) => void,
  setRequestState: (requestState: "idle" | "loading" | "error") => void,
) {
  try {
    const response = await fetch(`${apiBaseUrl}/api/host/status`);

    if (!response.ok) {
      throw new Error("Host status failed");
    }

    setHostState((await response.json()) as HostState);
  } catch {
    setRequestState("error");
  }
}

async function fetchPairingRequests(
  apiBaseUrl: string,
  setPendingPairingRequests: (requests: PendingPairingRequest[]) => void,
) {
  const response = await fetch(`${apiBaseUrl}/api/host/pairing/requests`);

  if (!response.ok) {
    return;
  }

  const data = (await response.json()) as { requests: PendingPairingRequest[] };

  setPendingPairingRequests(data.requests);
}

async function fetchClientSession(
  apiBaseUrl: string,
  setClientSession: (session: ClientPairingSession | null) => void,
) {
  const response = await fetch(`${apiBaseUrl}/api/client/session`);

  if (!response.ok) {
    return;
  }

  const data = (await response.json()) as {
    session: ClientPairingSession | null;
  };

  setClientSession(data.session);
}

function getOrCreateDeviceId() {
  const storageKey = "openorder.deviceId";
  const existingDeviceId = localStorage.getItem(storageKey);

  if (existingDeviceId) {
    return existingDeviceId;
  }

  const deviceId = `device-${crypto.randomUUID()}`;

  localStorage.setItem(storageKey, deviceId);

  return deviceId;
}

function parsePairingPayload(value: string) {
  try {
    const payload = JSON.parse(value) as Partial<PairingQrPayload>;

    if (
      typeof payload.deviceName === "string" &&
      typeof payload.deviceId === "string" &&
      typeof payload.callbackIp === "string" &&
      typeof payload.callbackPort === "number" &&
      typeof payload.nonce === "string" &&
      typeof payload.appVersion === "string"
    ) {
      return payload as PairingQrPayload;
    }

    return null;
  } catch {
    return null;
  }
}

function getRuntimeCallbackIp() {
  if (Capacitor.isNativePlatform()) {
    return null;
  }

  return window.location.hostname || null;
}
