import type { NextConfig } from 'next';

const config: NextConfig = {
  distDir: process.env.KX_DIST_DIR || '.next',
  serverExternalPackages: ['better-sqlite3', '@node-rs/argon2', 'web-push', 'undici'],
  ...(Number(process.env.KX_BUILD_CPUS) > 0 ? { experimental: { cpus: Number(process.env.KX_BUILD_CPUS) } } : {}),
  ...(process.env.KX_BUILD_SKIP_TSC === '1' ? { typescript: { ignoreBuildErrors: true } } : {}),
  poweredByHeader: false,
  reactStrictMode: true,
  allowedDevOrigins: ['127.0.0.1'],
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [
          { type: 'header', key: 'cf-visitor', value: '.*"scheme"\\s*:\\s*"http".*' },
          { type: 'host', value: '(?<host>[^:]+)' },
        ],
        destination: 'https://:host/:path*',
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'Permissions-Policy', value: 'microphone=(self), camera=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
        ],
      },
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }, { key: 'Service-Worker-Allowed', value: '/' }] },
    ];
  },
};
export default config;
