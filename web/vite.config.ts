import type { Socket } from "node:net";

import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

type SocketError = Error & { code?: string };

function suppressSocketErrors(): Plugin {
  return {
    name: "suppress-socket-errors",
    configureServer(server: ViteDevServer) {
      server.httpServer?.on("connection", (socket: Socket) => {
        socket.on("error", (err: SocketError) => {
          if (err.code === "ECONNRESET" || err.code === "EPIPE") return;
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const devPort = Number(env.WEB_PORT || 29283);
  const previewPort = Number(env.WEB_PORT || 29281);
  const devProxyTarget = env.VITE_DEV_PROXY_TARGET || "http://127.0.0.1:29282";
  const allowedHosts = env.WEB_ALLOWED_HOSTS
    ? env.WEB_ALLOWED_HOSTS.split(",").map((host) => host.trim()).filter(Boolean)
    : ["draw.devbin.de"];

  return {
    plugins: [react(), tailwindcss(), suppressSocketErrors()],
    server: {
      port: devPort,
      strictPort: true,
      host: "0.0.0.0",
      allowedHosts,
      proxy: {
        "/api": {
          target: devProxyTarget,
          changeOrigin: true,
        },
      },
    },
    preview: {
      port: previewPort,
      strictPort: true,
      host: "0.0.0.0",
      allowedHosts,
    },
  };
});
