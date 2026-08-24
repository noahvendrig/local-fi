import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Import posts audio through proxy.ts, which buffers the body. The default
    // 10MB cap truncates multipart uploads and the route then fails to parse
    // form data. 1gb covers a single large lossless file; the client also
    // splits folders into smaller batches so a library is not one request.
    proxyClientMaxBodySize: "1gb",
  },
};

export default nextConfig;
