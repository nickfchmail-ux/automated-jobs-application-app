import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
  // Renamed/reorganized routes — keep old links and bookmarks working.
  async redirects() {
    return [
      { source: "/evaluate", destination: "/search", permanent: true },
      { source: "/not-evaluated", destination: "/review", permanent: true },
      {
        source: "/not-fit",
        destination: "/matches?view=notfit",
        permanent: true,
      },
      { source: "/not-interested", destination: "/saved", permanent: true },
      // The old "/" dashboard (search launcher) is now /search; "/" is the
      // insight Overview. Keep old root → /search for anyone relying on it.
      // (We keep "/" itself pointing at /overview via the page below.)
    ];
  },
};

export default nextConfig;
