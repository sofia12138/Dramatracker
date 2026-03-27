/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    instrumentationHook: true,
  },
};

export default nextConfig;

// Note: /api/data/import route uses `export const config = { api: { bodyParser: false } }`
// to handle large file uploads via FormData (up to 100MB).
