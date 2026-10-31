import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { createViteMiddlewareOptions } from "./_core/devServerOptions";

const server = createServer();

describe("Vite middleware HMR through HTTPS Preview", () => {
  it("shares the application listener and advertises public WSS/443 without a fixed hostname", () => {
    const options = createViteMiddlewareOptions(
      server,
      {},
      { MANUS_PROJECT_ID: "test-project" }
    );
    expect(options.port).toBe(3000);
    expect(options.strictPort).toBe(true);
    expect(options.middlewareMode).toBe(true);
    expect(options.hmr).toMatchObject({
      server,
      protocol: "wss",
      clientPort: 443,
    });
    expect(options.hmr).not.toHaveProperty("host");
  });

  it("uses PORT instead of Vite's default 5173 and keeps explicit access restrictions", () => {
    const fs = { strict: true, deny: ["**/.*"] };
    const hosts = ["localhost", ".manus.computer"];
    const options = createViteMiddlewareOptions(
      server,
      {
        port: 5173,
        allowedHosts: hosts,
        fs,
        hmr: { overlay: false, path: "/custom-hmr" },
      },
      { PORT: "4100", MANUS_PROJECT_ID: "test-project" }
    );
    expect(options.port).toBe(4100);
    expect(options.allowedHosts).toEqual(hosts);
    expect(options.fs).toEqual(fs);
    expect(options.hmr).toMatchObject({
      server,
      overlay: false,
      path: "/custom-hmr",
      clientPort: 443,
    });
  });

  it("keeps normal browser-derived WS host and port for ordinary local HTTP development", () => {
    const options = createViteMiddlewareOptions(server, {}, { PORT: "4100" });
    expect(options.hmr).toEqual({ server });
    expect(options.port).toBe(4100);
  });

  it("preserves an explicit existing HMR disable rather than altering unrelated preferences", () => {
    expect(createViteMiddlewareOptions(server, { hmr: false }, {}).hmr).toBe(
      false
    );
  });

  it("rejects an invalid listener port", () => {
    for (const port of ["not-a-port", "0", "70000"]) {
      expect(() =>
        createViteMiddlewareOptions(server, {}, { PORT: port })
      ).toThrow("Invalid development PORT");
    }
  });
});
