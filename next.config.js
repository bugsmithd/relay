import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pin tracing root to this app so Next stops scanning the parent's
  // pnpm-lock.yaml ("multiple lockfiles detected" warning).
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
