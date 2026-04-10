import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  webpack: (config, { webpack, nextRuntime }) => {
    // Edge middleware has no Node `__dirname` / `__filename`; some deps still reference them.
    if (nextRuntime === "edge") {
      config.plugins.push(
        new webpack.DefinePlugin({
          __dirname: JSON.stringify("/"),
          __filename: JSON.stringify("/middleware.js"),
        }),
      );
    }
    return config;
  },
  images: {
    remotePatterns: [
      // Cloudflare R2 (S3 API) — presigned GET URLs
      {
        protocol: "https",
        hostname: "**.r2.cloudflarestorage.com",
        port: "",
        pathname: "/**",
      },
      // Optional: public bucket on *.r2.dev
      {
        protocol: "https",
        hostname: "**.r2.dev",
        port: "",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
