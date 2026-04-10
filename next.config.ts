import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  // Run middleware on Node.js on Vercel so the bundle does not hit Edge-only
  // limitations (e.g. __dirname) that cause MIDDLEWARE_INVOCATION_FAILED.
  // Types may lag; option is valid in Next 15.5+ (see next.config warn / build output).
  experimental: {
    nodeMiddleware: true,
  } as NextConfig["experimental"],
  images: {
    remotePatterns: [
      // Cloudflare R2 (S3 API) — presigned GET URLs
      {
        protocol: 'https',
        hostname: '**.r2.cloudflarestorage.com',
        port: '',
        pathname: '/**',
      },
      // Optional: public bucket on *.r2.dev
      {
        protocol: 'https',
        hostname: '**.r2.dev',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
