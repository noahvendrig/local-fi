import type { NextConfig } from "next";

// Next's dev server (since 15.3-ish) 403s JS chunk/HMR requests whose Origin header isn't in
// this allowlist — a DNS-rebinding defense that otherwise silently breaks the app for any
// device reaching it via the PC's LAN IP (the page shell server-renders fine, but React never
// hydrates because its own bundle is blocked, so every data-driven screen goes blank while
// static chrome like the bottom tab bar still shows).
//
// Wildcard patterns for the three RFC 1918 private ranges, not a specific machine-address
// snapshot: a snapshot computed once at boot (via os.networkInterfaces()) goes stale the moment
// the PC's network changes — a Wi-Fi to phone-hotspot switch mid-session lands on a different
// subnet (e.g. Android's 192.168.43.0/24) without a server restart to pick it up. Next's origin
// matcher (block-cross-site-dev.js) splits on "." and matches "*" per segment regardless of
// whether the string looks like a hostname, so IPv4 octet wildcards work the same way its docs'
// hostname examples ("*.example.com") do. This is dev-only — production never runs this check.
const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "10.*.*.*",
    "172.16.*.*", "172.17.*.*", "172.18.*.*", "172.19.*.*",
    "172.20.*.*", "172.21.*.*", "172.22.*.*", "172.23.*.*",
    "172.24.*.*", "172.25.*.*", "172.26.*.*", "172.27.*.*",
    "172.28.*.*", "172.29.*.*", "172.30.*.*", "172.31.*.*",
    "192.168.*.*",
  ],
  experimental: {
    // Import posts audio through proxy.ts, which buffers the body. The default
    // 10MB cap truncates multipart uploads and the route then fails to parse
    // form data. 1gb covers a single large lossless file; the client also
    // splits folders into smaller batches so a library is not one request.
    proxyClientMaxBodySize: "1gb",
  },
};

export default nextConfig;
