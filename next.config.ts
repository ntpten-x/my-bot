import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "bcryptjs", "rss-parser", "cheerio", "nodemailer"],
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          "**/node_modules/**",
          "**/.git/**",
          "**/.next/**",
          "**/data/**",
          "**/.playwright-mcp/**",
          "**/agent-tools/**",
          "**/*.db",
          "**/*.db-journal",
        ],
      };
    }
    return config;
  },
};

export default nextConfig;
