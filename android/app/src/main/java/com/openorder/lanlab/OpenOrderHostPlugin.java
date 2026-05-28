package com.openorder.lanlab;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Collections;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "OpenOrderHost")
public class OpenOrderHostPlugin extends Plugin {

    private static final int DEFAULT_PORT = 8787;

    private LocalHostServer server;
    private String sessionId;
    private String startedAt;

    @PluginMethod
    public void start(PluginCall call) {
        int port = call.getInt("port", DEFAULT_PORT);
        String hostIp = getLanIpAddress();

        if (hostIp == null) {
            call.reject("LAN_IP_NOT_FOUND");
            return;
        }

        if (server == null) {
            sessionId = UUID.randomUUID().toString();
            startedAt = Instant.now().toString();
            server = new LocalHostServer(port);

            try {
                server.start();
            } catch (IOException error) {
                server = null;
                sessionId = null;
                startedAt = null;
                call.reject(error.getMessage());
                return;
            }
        }

        JSObject result = createHostState(port, hostIp);
        result.put("apiBaseUrl", "http://" + hostIp + ":" + port);
        call.resolve(result);
    }

    @PluginMethod
    public void close(PluginCall call) {
        if (server != null) {
            server.close();
            server = null;
        }

        sessionId = null;
        startedAt = null;
        call.resolve(createClosedHostState());
    }

    @PluginMethod
    public void status(PluginCall call) {
        String hostIp = getLanIpAddress();

        if (server == null || hostIp == null) {
            call.resolve(createClosedHostState());
            return;
        }

        call.resolve(createHostState(server.port, hostIp));
    }

    private JSObject createHostState(int port, String hostIp) {
        JSObject session = new JSObject();
        session.put("sessionId", sessionId);
        session.put("port", port);
        session.put("startedAt", startedAt);

        JSObject state = new JSObject();
        state.put("mode", "OPEN");
        state.put("session", session);
        state.put("trustedDevices", Collections.emptyList());
        state.put("connectedDevices", Collections.emptyList());
        state.put("hostIp", hostIp);
        return state;
    }

    private JSObject createClosedHostState() {
        JSObject state = new JSObject();
        state.put("mode", "CLOSED");
        state.put("session", JSObject.NULL);
        state.put("trustedDevices", Collections.emptyList());
        state.put("connectedDevices", Collections.emptyList());
        return state;
    }

    private static String getLanIpAddress() {
        try {
            for (NetworkInterface networkInterface : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!networkInterface.isUp() || networkInterface.isLoopback()) {
                    continue;
                }

                for (InetAddress address : Collections.list(networkInterface.getInetAddresses())) {
                    if (address instanceof Inet4Address && !address.isLoopbackAddress()) {
                        return address.getHostAddress();
                    }
                }
            }
        } catch (Exception ignored) {
            return null;
        }

        return null;
    }

    private final class LocalHostServer {
        private final int port;
        private final ExecutorService executor = Executors.newCachedThreadPool();
        private ServerSocket serverSocket;
        private volatile boolean running;

        private LocalHostServer(int port) {
            this.port = port;
        }

        private void start() throws IOException {
            serverSocket = new ServerSocket(port);
            running = true;

            executor.execute(() -> {
                while (running) {
                    try {
                        Socket socket = serverSocket.accept();
                        executor.execute(() -> handle(socket));
                    } catch (IOException ignored) {
                        if (running) {
                            running = false;
                        }
                    }
                }
            });
        }

        private void close() {
            running = false;

            try {
                if (serverSocket != null) {
                    serverSocket.close();
                }
            } catch (IOException ignored) {
                // Server is already closing.
            }

            executor.shutdownNow();
        }

        private void handle(Socket socket) {
            try (socket) {
                BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
                String requestLine = reader.readLine();

                if (requestLine == null) {
                    return;
                }

                String path = "/";
                String[] parts = requestLine.split(" ");
                if (parts.length > 1) {
                    path = parts[1];
                }

                while (true) {
                    String line = reader.readLine();
                    if (line == null || line.isEmpty()) {
                        break;
                    }
                }

                if (path.equals("/health")) {
                    writeJson(socket, 200, "{\"ok\":true,\"service\":\"openorder-android-host\"}");
                    return;
                }

                if (path.equals("/api/host/status")) {
                    writeJson(socket, 200, getStateJson());
                    return;
                }

                if (path.equals("/api/host/mdns")) {
                    writeJson(socket, 200, getMdnsJson());
                    return;
                }

                writeJson(socket, 404, "{\"reason\":\"NOT_FOUND\"}");
            } catch (IOException ignored) {
                // Connection was closed by the client.
            }
        }

        private String getStateJson() {
            return "{\"mode\":\"OPEN\",\"session\":{\"sessionId\":\"" + sessionId + "\",\"port\":" + port + ",\"startedAt\":\"" + startedAt + "\"},\"trustedDevices\":[],\"connectedDevices\":[]}";
        }

        private String getMdnsJson() {
            String hostIp = getLanIpAddress();
            return "{\"published\":true,\"name\":\"OpenOrder Host Android\",\"type\":\"_openorder._tcp.local\",\"port\":" + port + ",\"hostIp\":\"" + hostIp + "\",\"sessionId\":\"" + sessionId + "\"}";
        }

        private void writeJson(Socket socket, int statusCode, String body) throws IOException {
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            String reason = statusCode == 200 ? "OK" : "Not Found";
            String headers = "HTTP/1.1 " + statusCode + " " + reason + "\r\n"
                + "Content-Type: application/json; charset=utf-8\r\n"
                + "Content-Length: " + bytes.length + "\r\n"
                + "Access-Control-Allow-Origin: *\r\n"
                + "Access-Control-Allow-Methods: GET,POST,OPTIONS\r\n"
                + "Access-Control-Allow-Headers: Content-Type,Authorization\r\n"
                + "Connection: close\r\n\r\n";

            OutputStream output = socket.getOutputStream();
            output.write(headers.getBytes(StandardCharsets.UTF_8));
            output.write(bytes);
            output.flush();
        }
    }
}
