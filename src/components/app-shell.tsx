"use client";

import { BarChart3, Cable, CalendarDays, Settings, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { Brand } from "@/components/brand";

const navigation = [
  { href: "/today", label: "Today", icon: CalendarDays },
  { href: "/restrictions", label: "Restrictions", icon: ShieldCheck },
  { href: "/insights", label: "Insights", icon: BarChart3 },
  { href: "/browsers", label: "Browsers", icon: Cable },
  { href: "/settings", label: "Settings", icon: Settings },
];

type AppShellProps = {
  children: ReactNode;
  user: { email?: string; user_metadata?: { display_name?: string } };
};

export function AppShell({ children, user }: AppShellProps) {
  const currentPath = usePathname();
  const displayName = user.user_metadata?.display_name || user.email?.split("@")[0] || "Focus builder";
  const initial = displayName.slice(0, 1).toUpperCase();

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <Brand dark />
        <nav className="side-nav" aria-label="Main navigation">
          {navigation.map(({ href, label, icon: Icon }) => (
            <Link href={href} key={href} aria-current={currentPath === href ? "page" : undefined}>
              <Icon size={19} strokeWidth={2} aria-hidden="true" />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="account-row">
            <div className="account-avatar" aria-hidden="true">{initial}</div>
            <div className="account-copy"><strong>{displayName}</strong><span>{user.email}</span></div>
          </div>
          <form action="/auth/sign-out" method="post"><button className="plain-button" type="submit">Sign out</button></form>
        </div>
      </aside>
      <main className="app-main">{children}</main>
    </div>
  );
}
