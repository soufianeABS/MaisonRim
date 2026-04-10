import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  webpack: (config, { webpack, nextRuntime }) => {
    // Edge has no Node `__dirname`; some transitive code still references it.
    // Run early (unshift). Banner covers cases DefinePlugin misses on some hosts.
    if (nextRuntime === "edge") {
      config.plugins.unshift(
        new webpack.BannerPlugin({
          banner: 'var __dirname="/";var __filename="/middleware.js";',
          raw: true,
          entryOnly: true,
        }),
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
