import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: {
      // Points next-intl at our request config. This is the one thing
      // next-intl's createNextIntlPlugin() does for this setup; it is wired by
      // hand because the plugin also loads @swc/core, which this project does
      // not otherwise need.
      "next-intl/config": "./src/i18n/request.ts",
    },
  },
};

export default nextConfig;
