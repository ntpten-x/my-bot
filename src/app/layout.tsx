import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { IBM_Plex_Sans_Thai } from "next/font/google";
import { headers } from "next/headers";
import { ServiceWorkerRegister } from "@/components/sw-register";
import "./globals.css";

// A fresh CSP nonce must reach every document, including login/setup.
export const dynamic = "force-dynamic";

const thai = IBM_Plex_Sans_Thai({
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

const themeInitScript = `(function(){var el=document.documentElement;var m="dark";try{m=localStorage.getItem("theme")==="light"?"light":"dark";}catch(e){}el.classList.remove("dark","light");el.classList.add(m);})();`;

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    // The installed extension marks this element before hydration; child content must still match.
    <html lang="th" className="dark" suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <style dangerouslySetInnerHTML={{ __html: "body{--font-geist:var(--font-geist-sans)}" }} />
      </head>
      <body className={`${GeistSans.variable} ${thai.variable} font-sans antialiased`}>
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
