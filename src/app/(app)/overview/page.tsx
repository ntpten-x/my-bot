"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, ExternalLink, LogIn, RefreshCw } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
import { AiProviderUsage } from "@/components/ai-provider-usage";
import { LEVEL_STYLE, LevelDot, useSystemOverview } from "@/components/system-overview";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Check } from "@/lib/system-status";

function CheckCard({ check }: { check: Check }) {
  const style = LEVEL_STYLE[check.level];
  return (
    <div className={cn("rounded-xl border p-3", style.card)}>
      <div className="flex items-center gap-2 text-sm">
        <LevelDot level={check.level} />
        <span className="font-medium">{check.label}</span>
        <span className={cn("ml-auto text-xs", style.text)}>{style.label}</span>
      </div>
      <p className={cn("mt-1 text-base font-semibold", style.text)}>{check.value}</p>
      {check.detail ? <p className="mt-1 break-words text-xs text-muted">{check.detail}</p> : null}
      {check.hint ? <p className="mt-2 rounded-lg bg-white/70 px-2 py-1 text-xs">วิธีแก้: {check.hint}</p> : null}
    </div>
  );
}

function useInstalledExtensionVersion() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setVersion(document.documentElement.getAttribute("data-mybot-extension-version"));
    read();
    const timer = setTimeout(read, 1500);
    return () => clearTimeout(timer);
  }, []);
  return version;
}

export default function OverviewPage() {
  const { data, error, loading, reload } = useSystemOverview();
  const installedHere = useInstalledExtensionVersion();
  const [pinged, setPinged] = useState("");
  const [fbHint, setFbHint] = useState(false);
  const [copied, setCopied] = useState("");
  const waitingFocus = useRef(false);

  const refreshAll = async () => {
    // Ask the extension in this browser (if any) to send a fresh heartbeat, then re-test everything.
    window.postMessage({ source: "mybot-app", type: "heartbeat-now" }, window.location.origin);
    setPinged("ขอให้ส่วนขยายส่งสถานะใหม่แล้ว");
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await reload(true);
  };

  // After the user opens Facebook in a new tab, re-check as soon as they come back to this tab.
  useEffect(() => {
    const onFocus = () => {
      if (!waitingFocus.current) return;
      waitingFocus.current = false;
      void refreshAll();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  });

  const openedFacebook = () => {
    waitingFocus.current = true;
    setFbHint(true);
  };

  const copyExtensionsUrl = async () => {
    try {
      await navigator.clipboard.writeText("chrome://extensions");
      setCopied("คัดลอกแล้ว — เปิดแท็บใหม่ วาง (Ctrl+V) แล้วกด Enter จากนั้นกดรีโหลด MY-BOT");
    } catch {
      setCopied("คัดลอกไม่ได้ — พิมพ์ chrome://extensions ในแถบที่อยู่เอง");
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            {data ? <LevelDot level={data.overall} className="h-3.5 w-3.5" /> : null}
            ภาพรวมระบบ
          </h1>
          <p className="mt-1 text-sm text-muted">
            สถานะ Facebook, ส่วนขยาย, AI และระบบเบื้องหลัง อัปเดตเองทุก 15 วินาที
            {data ? ` · ตรวจล่าสุด ${new Date(data.generatedAt).toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok" })}` : ""}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refreshAll()} disabled={loading}>
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> ตรวจใหม่ทั้งหมด
        </Button>
      </div>
      {pinged ? <p className="mt-2 text-xs text-muted">{pinged}</p> : null}
      {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}
      {!data && !error ? <p className="mt-6 text-sm text-muted">กำลังตรวจระบบ...</p> : null}

      {data ? (
        <>
          <div className="mt-4 flex flex-wrap gap-2 text-sm">
            <Badge tone="pine">ปกติ {data.counts.ok}</Badge>
            <Badge tone="amber">ควรดู {data.counts.warn}</Badge>
            <Badge tone="danger">มีปัญหา {data.counts.bad}</Badge>
            <Badge>ไม่ได้ใช้ {data.counts.off}</Badge>
            <Badge tone={installedHere ? "pine" : "neutral"}>
              เบราว์เซอร์นี้: {installedHere ? `มีส่วนขยาย v${installedHere}` : "ไม่พบส่วนขยาย"}
            </Badge>
          </div>
          <AiProviderUsage />

          {data.sections.map((item) => (
            <Card key={item.id} className="mt-5">
              <h2 className="flex items-center gap-2 font-semibold">
                <LevelDot level={item.level} /> {item.title}
              </h2>
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {item.checks.map((check) => (
                  <CheckCard key={check.key} check={check} />
                ))}
              </div>

              {item.id === "facebook" ? (
                <div className="mt-4 overflow-x-auto">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    {data.facebook.loggedIn === true ? (
                      <>
                        <a href="https://www.facebook.com/" target="_blank" rel="noopener noreferrer" onClick={openedFacebook}
                          className="inline-flex items-center gap-1 rounded-lg border border-line bg-card px-3 py-1.5 text-sm hover:bg-stone-50">
                          <ExternalLink className="h-4 w-4" /> เปิด Facebook
                        </a>
                        <a href="https://www.facebook.com/groups/feed/" target="_blank" rel="noopener noreferrer" onClick={openedFacebook}
                          className="inline-flex items-center gap-1 rounded-lg border border-line bg-card px-3 py-1.5 text-sm hover:bg-stone-50">
                          <ExternalLink className="h-4 w-4" /> เปิดกลุ่มที่ติดตาม
                        </a>
                        <a href="https://www.facebook.com/login" target="_blank" rel="noopener noreferrer" onClick={openedFacebook}
                          className="text-xs text-muted hover:underline">
                          เพิ่ม/สลับบัญชี
                        </a>
                      </>
                    ) : (
                      <a href="https://www.facebook.com/login" target="_blank" rel="noopener noreferrer" onClick={openedFacebook}
                        className="inline-flex items-center gap-2 rounded-lg bg-[#1877F2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#166FE5]">
                        <LogIn className="h-4 w-4" /> เข้าสู่ระบบ Facebook
                      </a>
                    )}
                  </div>
                  {fbHint ? (
                    <p className="mb-3 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900">ล็อกอินเสร็จแล้วกลับมาที่นี่ ระบบจะตรวจเองภายใน 1 นาที</p>
                  ) : null}
                  {data.facebook.accounts.length ? (
                    <table className="w-full min-w-[640px] text-left text-sm">
                      <thead className="text-xs text-muted">
                        <tr>
                          <th className="py-1 pr-3">สถานะ</th>
                          <th className="py-1 pr-3">ชื่อ</th>
                          <th className="py-1 pr-3">Facebook ID</th>
                          <th className="py-1 pr-3">เห็นล่าสุด</th>
                          <th className="py-1 pr-3">เบราว์เซอร์</th>
                          <th className="py-1 pr-3 text-right">โพสต์ที่เก็บได้</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.facebook.accounts.map((account) => (
                          <tr key={account.id} className="border-t border-line">
                            <td className="py-2 pr-3">
                              <span className="flex items-center gap-2">
                                <LevelDot level={account.loggedIn ? "ok" : "off"} />
                                {account.loggedIn ? "ล็อกอินอยู่" : "ไม่ได้ล็อกอินแล้ว"}
                              </span>
                            </td>
                            <td className="py-2 pr-3">{account.name || <span className="text-muted">ไม่ทราบชื่อ</span>}</td>
                            <td className="py-2 pr-3 font-mono text-xs">
                              <a className="hover:underline" href={`https://www.facebook.com/profile.php?id=${account.id}`} target="_blank" rel="noreferrer">
                                {account.id}
                              </a>
                            </td>
                            <td className="py-2 pr-3">{timeAgo(account.lastSeenAt)}</td>
                            <td className="py-2 pr-3">{[account.browser, account.profileLabel].filter(Boolean).join(" · ") || "-"}</td>
                            <td className="py-2 pr-3 text-right">{account.postsCaptured}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="text-sm text-muted">
                      ยังไม่เห็นบัญชีใด — อัปเดตส่วนขยายเป็น v{data.extension.expectedVersion} แล้วเปิด facebook.com สักครั้ง
                    </p>
                  )}
                  <p className="mt-2 text-xs text-muted">
                    ส่วนขยายอ่านแค่เลขบัญชีจากคุกกี้ c_user ของ facebook.com และชื่อที่แสดงบนหน้า (ถ้าหาได้) ไม่อ่านรหัสผ่าน ไม่โพสต์ ไม่คอมเมนต์แทนคุณ
                  </p>
                </div>
              ) : null}

              {item.id === "extension" && item.level !== "ok" ? (
                <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
                  <Button variant="outline" size="sm" onClick={() => void copyExtensionsUrl()}>
                    <Copy className="h-4 w-4" /> คัดลอก chrome://extensions
                  </Button>
                  <span className="text-xs text-muted">
                    {copied || "เบราว์เซอร์ไม่ให้ลิงก์ไปหน้านี้ตรง ๆ — คัดลอกแล้ววางในแท็บใหม่ แล้วกดรีโหลดส่วนขยาย MY-BOT"}
                  </span>
                </div>
              ) : null}

              {item.id === "extension" && data.extension.installs.length ? (
                <div className="mt-4 space-y-2">
                  <h3 className="text-sm font-medium">เบราว์เซอร์ที่ติดตั้งส่วนขยาย</h3>
                  {data.extension.installs.map((install) => (
                    <div key={install.id} className={cn("rounded-xl border p-3 text-sm", LEVEL_STYLE[install.level].card)}>
                      <div className="flex flex-wrap items-center gap-2">
                        <LevelDot level={install.level} />
                        <span className="font-medium">{install.browser || "เบราว์เซอร์"}</span>
                        <Badge>v{install.version || "?"}</Badge>
                        <Badge tone={install.enabled ? "pine" : "amber"}>{install.enabled ? "เปิดใช้งาน" : "ปิดอยู่"}</Badge>
                        <span className="text-xs text-muted">รหัสเครื่อง {install.id}</span>
                        <span className="ml-auto text-xs text-muted">สัญญาณล่าสุด {timeAgo(install.lastSeenAt)}</span>
                      </div>
                      <p className="mt-1 text-xs">
                        Facebook: {install.fbLoggedIn ? `${install.fbUserName || "ไม่ทราบชื่อ"} (${install.fbUserId})` : "ยังไม่ได้ล็อกอิน / ยังไม่เห็นหน้า Facebook"}
                        {" · "}ส่งโพสต์แล้ว {install.postsSent} · โพสต์ล่าสุด {install.lastPostAt ? timeAgo(install.lastPostAt) : "ยังไม่มี"}
                      </p>
                      {install.tabs.length ? (
                        <ul className="mt-1 list-disc pl-5 text-xs text-muted">
                          {install.tabs.map((tab) => (
                            <li key={tab.url} className="truncate">
                              กำลังเปิด: {tab.title || tab.url}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {install.lastError ? (
                        <p className="mt-1 text-xs text-red-800">
                          ข้อผิดพลาดล่าสุด ({install.lastErrorAt ? timeAgo(install.lastErrorAt) : "-"}): {install.lastError}
                        </p>
                      ) : null}
                      {install.outboxSize ? <p className="mt-1 text-xs text-amber-800">โพสต์รอส่งใหม่ (เซิร์ฟเวอร์ติดต่อไม่ได้ตอนนั้น): {install.outboxSize} ชุด</p> : null}
                      {install.errorLog?.length ? (
                        <details className="mt-1 text-xs">
                          <summary className="cursor-pointer text-muted">บันทึกข้อผิดพลาดของส่วนขยาย · 24 ชม. {install.errorCount24h} ครั้ง</summary>
                          <ul className="mt-1 list-disc pl-5">
                            {install.errorLog.map((entry) => (
                              <li key={`${entry.at}-${entry.message}`}>
                                {entry.at ? timeAgo(new Date(entry.at).toISOString()) : "-"} · {entry.message}{entry.count > 1 ? ` (×${entry.count})` : ""}
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </Card>
          ))}
        </>
      ) : null}
    </div>
  );
}
