import type { Metadata } from "next";
import { IBM_Plex_Sans_Thai } from "next/font/google";
import "./globals.css";

const sans = IBM_Plex_Sans_Thai({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ibm",
  display: "swap",
});

export const metadata: Metadata = {
  title: "MY-BOT เรดาร์ลีด",
  description: "เรดาร์ลีดส่วนตัวสำหรับกลุ่ม Facebook และบอร์ดประกาศ ใช้งานคนเดียวบนเครื่องตัวเอง",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th">
      <body className={`${sans.variable} font-sans antialiased`}>{children}</body>
    </html>
  );
}
