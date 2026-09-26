import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Playwright suite builds into its own directory (NEXT_DIST_DIR=.next-e2e)
  // so an E2E run never overwrites a normal build or collides with `next dev`.
  // Unset everywhere else, including Vercel, where the default is required.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
};

export default nextConfig;
