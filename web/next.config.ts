import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ensure Prisma client/engines are treated as externals for server components
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client", "prisma"],
  },
};

export default nextConfig;
