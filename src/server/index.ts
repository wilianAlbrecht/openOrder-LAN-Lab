import Fastify from "fastify";

const host = "0.0.0.0";
const port = Number(process.env.OPENORDER_PORT ?? 8787);
const server = Fastify({ logger: true });

server.get("/health", async () => ({
  ok: true,
  service: "openorder-lan-host",
}));

await server.listen({ host, port });
