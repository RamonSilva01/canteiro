import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@react-pdf/renderer"],
  outputFileTracingIncludes: {
    // A biblioteca de PDF carrega estes arquivos em tempo de execução, sem o rastreio da Vercel perceber.
    "/obras/**": ["./lib/relatorio/fonts/**", "./node_modules/pdfkit/js/**"],
  },
};

export default nextConfig;
