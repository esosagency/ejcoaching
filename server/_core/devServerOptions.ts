import type { Server } from "node:http";
import type { ServerOptions } from "vite";

/** Express owns the listener; Vite must advertise that same port to HMR. */
export function createViteMiddlewareOptions(
  server: Server,
  base: ServerOptions = {},
  env: NodeJS.ProcessEnv = process.env
): ServerOptions {
  const port = Number(env.PORT || "3000");
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("Invalid development PORT");
  }
  const existingHmr = typeof base.hmr === "object" ? base.hmr : {};
  const hostedHttps = Boolean(env.MANUS_PROJECT_ID);

  return {
    ...base,
    port,
    strictPort: true,
    middlewareMode: true,
    hmr:
      base.hmr === false
        ? false
        : {
            ...existingHmr,
            server,
            // Keep hostname inferred from the browser: no ephemeral Sandbox URL is saved.
            // Public HTTPS reaches Express over HTTP, so the public client port is 443.
            ...(hostedHttps ? { protocol: "wss", clientPort: 443 } : {}),
          },
  };
}
