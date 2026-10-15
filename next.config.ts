import type { NextConfig } from "next";
import { productionEnvProblems } from "./lib/production-env";

// A Vercel production build stops here when a secret the app needs is missing,
// so the live site keeps its last good deployment (see lib/production-env.ts).
if (process.env.VERCEL_ENV === "production") {
  const problems = productionEnvProblems(process.env);
  if (problems.length > 0) {
    throw new Error(`Production environment is incomplete:\n- ${problems.join("\n- ")}`);
  }
}

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  // The product tour is part of the home page now; its #anchors carry over.
  async redirects() {
    return [{ source: "/product", destination: "/", permanent: true }];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
