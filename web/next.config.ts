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
  experimental: {
    serverActions: {
      // Result files delivered to the vault are capped at 8 MB (see
      // RESULT_MAX_BYTES); the default 1 MB would reject them before our own
      // validation runs.
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
