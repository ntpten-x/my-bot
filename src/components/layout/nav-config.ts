import type { LucideIcon } from "lucide-react";
import {
  Activity, Bell, BookOpen, Bookmark, Bug, LayoutDashboard, Lightbulb,
  MessageSquareText, Radar, Rss, Settings, Sun, Tags, Users, Workflow,
} from "lucide-react";

export type NavGroupId = "start" | "leads" | "messages" | "automation" | "sources" | "system";

export type NavItem = { href: string; label: string; icon: LucideIcon };
export type NavGroup = { id: NavGroupId; label: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "start",
    label: "เริ่มต้น",
    items: [
      { href: "/getting-started", label: "เริ่มใช้งาน", icon: Activity },
      { href: "/overview", label: "ภาพรวมระบบ", icon: Activity },
      { href: "/dashboard", label: "แดชบอร์ด", icon: LayoutDashboard },
    ],
  },
  {
    id: "leads",
    label: "ลีด",
    items: [
      { href: "/feed", label: "ฟีดลีด", icon: Radar },
      { href: "/pipeline", label: "ไปป์ไลน์", icon: Bookmark },
      { href: "/summaries", label: "สรุปรายวัน", icon: Sun },
      { href: "/notifications", label: "การแจ้งเตือน", icon: Bell },
    ],
  },
  {
    id: "messages",
    label: "ข้อความ",
    items: [
      { href: "/messages", label: "จัดการข้อความ", icon: MessageSquareText },
      { href: "/templates", label: "ข้อความสำเร็จรูป", icon: MessageSquareText },
    ],
  },
  {
    id: "automation",
    label: "อัตโนมัติ",
    items: [
      { href: "/automation", label: "กฎและพื้นที่", icon: Workflow },
      { href: "/auto-comment", label: "คอมเมนต์อัตโนมัติ", icon: MessageSquareText },
    ],
  },
  {
    id: "sources",
    label: "แหล่งข้อมูล",
    items: [
      { href: "/accounts", label: "จัดการบัญชี", icon: Users },
      { href: "/groups", label: "จัดการกลุ่ม", icon: Users },
      { href: "/sources", label: "แหล่งข้อมูล", icon: Rss },
      { href: "/parser", label: "ทดสอบตัวอ่าน", icon: Bug },
      { href: "/categories", label: "หมวดและคีย์เวิร์ด", icon: Tags },
    ],
  },
  {
    id: "system",
    label: "ระบบ",
    items: [
      { href: "/learn", label: "เรียนรู้", icon: Lightbulb },
      { href: "/guide", label: "วิธีใช้", icon: BookOpen },
      { href: "/settings", label: "ตั้งค่า", icon: Settings },
    ],
  },
];
