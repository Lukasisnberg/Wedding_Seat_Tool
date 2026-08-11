import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Eigenständiges Server-Bundle für Docker (siehe Dockerfile, Phase 7) —
  // enthält nur die tatsächlich benötigten node_modules statt des vollen
  // Verzeichnisses, deutlich kleineres Produktions-Image.
  output: "standalone",
  // Ohne das rät Next.js den Workspace-Root anhand des nächsten gefundenen
  // Lockfiles — auf diesem Rechner liegt zufällig eins in einem
  // übergeordneten Verzeichnis, was die File-Tracing-Basis fürs
  // Docker-Bundle sonst falsch verankern würde.
  outputFileTracingRoot: __dirname
};

export default nextConfig;
