/**
 * LOCAL DEV ONLY.
 *
 * This listener is for demo recordings that need to show 1Shot webhook delivery.
 * It is not imported by any app, not deployed by Keycat, and not a production
 * status path. Production Keycat polls the public relayer because Keycat runs no
 * backend infrastructure.
 *
 * Run with:
 *   pnpm exec tsx scripts/webhook-listener.ts
 */
import { createServer } from "node:http";

const port = Number(process.env.ONESHOT_WEBHOOK_PORT ?? 8787);

const server = createServer((request, response) => {
  if (request.method !== "POST") {
    response.writeHead(405, { allow: "POST" });
    response.end("Method Not Allowed\n");
    return;
  }

  const chunks: Buffer[] = [];
  request.on("data", (chunk: Buffer) => chunks.push(chunk));
  request.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    const signature =
      request.headers["x-1shot-signature"] ??
      request.headers["x-signature"] ??
      request.headers.signature ??
      "(no signature header)";

    console.log("1Shot webhook");
    console.log("path:", request.url);
    console.log("signature:", signature);
    console.log("body:", body);

    response.writeHead(204);
    response.end();
  });
});

server.listen(port, () => {
  console.log(`Local 1Shot webhook listener: http://localhost:${port}/webhooks/oneshot`);
  console.log("This process is local demo tooling only. Do not deploy it.");
});
