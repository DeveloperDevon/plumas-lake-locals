import { Link } from "@tanstack/react-router";
import {
  CircleUserRound,
  MessageCircle,
  Newspaper,
  Settings as SettingsIcon,
  Shield,
  Store,
  Users,
} from "lucide-react";
import type { ComponentType } from "react";

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

function navItems(userId: string, isAdmin: boolean): NavItem[] {
  const items: NavItem[] = [
    { to: "/feed", label: "Feed", icon: Newspaper },
    { to: "/groups", label: "Groups", icon: Users },
    { to: "/businesses", label: "Businesses", icon: Store },
    { to: "/messages", label: "Messages", icon: MessageCircle },
    { to: `/profile/${userId}`, label: "Profile", icon: CircleUserRound },
    { to: "/settings", label: "Settings", icon: SettingsIcon },
  ];
  if (isAdmin) items.push({ to: "/admin", label: "Admin", icon: Shield });
  return items;
}

// ≥1024px (NFR-01) - Tailwind's lg: breakpoint already lines up, no custom config needed.
export function NavRail({ userId, isAdmin }: { userId: string; isAdmin: boolean }) {
  return (
    <nav className="hidden w-56 shrink-0 flex-col gap-1 border-r border-border bg-card p-4 lg:flex">
      <p className="mb-4 px-3 text-sm font-semibold text-foreground">Plumas Lake Locals</p>
      {navItems(userId, isAdmin).map((item) => (
        <Link
          key={item.to}
          to={item.to}
          className="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          activeProps={{ className: "bg-muted text-foreground" }}
        >
          <item.icon className="h-5 w-5" />
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export function TabBar({ userId, isAdmin }: { userId: string; isAdmin: boolean }) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 flex border-t border-border bg-card lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      {navItems(userId, isAdmin).map((item) => (
        <Link
          key={item.to}
          to={item.to}
          className="flex min-h-11 flex-1 flex-col items-center justify-center gap-1 py-2 text-xs font-medium text-muted-foreground"
          activeProps={{ className: "text-foreground" }}
        >
          <item.icon className="h-5 w-5" />
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
