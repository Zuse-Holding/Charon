import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["compromise"],
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
