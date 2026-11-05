import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@react-pdf/renderer"],
  outputFileTracingIncludes: {
    "/obras/**": ["./lib/relatorio/fonts/**"],
  },
};

export default nextConfig;
