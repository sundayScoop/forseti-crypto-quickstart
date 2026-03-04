import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config) => {
    // Prevent symlinked file: deps from creating duplicate module instances
    // (breaks Next.js singletons like workUnitAsyncStorage during build)
    config.resolve.symlinks = false;

    // Treat missing re-exports as warnings instead of errors.
    // @tidecloak/js re-exports symbols from heimdall-tide that the local
    // heimdall build doesn't provide (TideMemory, BaseTideRequest, etc.)
    // but our code imports those directly from tide-js instead.
    config.module.parser = {
      ...config.module.parser,
      javascript: {
        ...config.module.parser?.javascript,
        reexportExportsPresence: "warn",
      },
    };
    return config;
  },
};

export default nextConfig;
