const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),
  // Desktop app serves images from the local bundle — skip the optimizer
  // (avoids the /_next/image internal fetch and a runtime sharp dependency).
  images: {
    unoptimized: true,
  },
};

module.exports = nextConfig;