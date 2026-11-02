import type { MetadataRoute } from "next";

// Lets the owner "Add to Home Screen" on a phone and open MY-BOT like an app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MY-BOT ลีดจากกลุ่ม",
    short_name: "MY-BOT",
    description: "ดูลีดใหม่จากกลุ่ม Facebook และเว็บบอร์ดแบบเรียลไทม์",
    start_url: "/feed",
    display: "standalone",
    background_color: "#f3ecdf",
    theme_color: "#1e6a45",
    lang: "th",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
