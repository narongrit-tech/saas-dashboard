/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '20mb',
    },
  },
  eslint: {
    // Allow production builds to complete even with ESLint errors in backup files
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
