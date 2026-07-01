import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  serverExternalPackages: ["compromise"],
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@src": path.resolve(__dirname, "../src"),
    };
    return config;
  },
};

export default nextConfig;
