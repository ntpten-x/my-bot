import type { Metadata } from "next";
import { IBM_Plex_Sans_Thai } from "next/font/google";
import { ServiceWorkerRegister } from "@/components/sw-register";
import "./globals.css";

// A fresh CSP nonce must reach every document, including login/setup.
export const dynamic = "force-dynamic";

const sans = IBM_Plex_Sans_Thai({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ibm",
  display: "swap",
});

export const metadata: Metadata = {
  title: "MY-BOT เรดาร์ลีด",
  description: "เรดาร์ลีดส่วนตัวสำหรับกลุ่ม Facebook และบอร์ดประกาศ ใช้งานคนเดียวบนเครื่องตัวเอง",
  icons: { apple: "/apple-touch-icon.png" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // The installed extension marks this element before hydration; child content must still match.
    <html lang="th" suppressHydrationWarning>
      <body className={`${sans.variable} font-sans antialiased`}>
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
