import { Link } from "@tanstack/react-router";
import {
  Bell,
  CalendarDays,
  CircleUserRound,
  MessageCircle,
  Newspaper,
  Search,
  Settings as SettingsIcon,
  Shield,
  ShoppingBag,
  Store,
  Users,
} from "lucide-react";
import type { ComponentType } from "react";

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  badge?: number;
}

function navItems(userId: string, isAdmin: boolean, unreadCount: number): NavItem[] {
  const items: NavItem[] = [
    { to: "/feed", label: "Feed", icon: Newspaper },
    { to: "/search", label: "Search", icon: Search },
    { to: "/groups", label: "Groups", icon: Users },
    { to: "/businesses", label: "Businesses", icon: Store },
    { to: "/calendar", label: "Calendar", icon: CalendarDays },
    { to: "/marketplace", label: "Marketplace", icon: ShoppingBag },
    { to: "/messages", label: "Messages", icon: MessageCircle },
    { to: "/notifications", label: "Notifications", icon: Bell, badge: unreadCount },
    { to: `/profile/${userId}`, label: "Profile", icon: CircleUserRound },
    { to: "/settings", label: "Settings", icon: SettingsIcon },
  ];
  if (isAdmin) items.push({ to: "/admin", label: "Admin", icon: Shield });
  return items;
}

function NavBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground">
      {count > 99 ? "99+" : count}
    </span>
  );
}

// ≥1024px (NFR-01) - Tailwind's lg: breakpoint already lines up, no custom config needed.
export function NavRail({
  userId,
  isAdmin,
  unreadCount,
}: {
  userId: string;
  isAdmin: boolean;
  unreadCount: number;
}) {
  return (
    <nav className="hidden w-56 shrink-0 flex-col gap-1 border-r border-border bg-card p-4 lg:flex">
      <p className="mb-4 px-3 text-sm font-semibold text-foreground">Plumas Lake Locals</p>
      {navItems(userId, isAdmin, unreadCount).map((item) => (
        <Link
          key={item.to}
          to={item.to}
          // Both the hover and active colors are expressed as data-[status=active]/hover:
          // variants on one static className, rather than via activeProps - two separately
          // concatenated class strings compete on equal specificity, so which one visually
          // wins depends on Tailwind's generated stylesheet order, not JSX order. That silently
          // broke the active-link text color (it kept losing to the base text-muted-foreground)
          // and failed axe-core's color-contrast check - a compound data-attribute selector
          // doesn't have that ambiguity.
          className="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground data-[status=active]:bg-muted data-[status=active]:text-foreground"
        >
          <item.icon className="h-5 w-5" />
          {item.label}
          {item.badge ? <NavBadge count={item.badge} /> : null}
        </Link>
      ))}
    </nav>
  );
}

export function TabBar({
  userId,
  isAdmin,
  unreadCount,
}: {
  userId: string;
  isAdmin: boolean;
  unreadCount: number;
}) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 flex border-t border-border bg-card lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      {navItems(userId, isAdmin, unreadCount).map((item) => (
        <Link
          key={item.to}
          to={item.to}
          className="relative flex min-h-11 flex-1 flex-col items-center justify-center gap-1 py-2 text-xs font-medium text-muted-foreground data-[status=active]:text-foreground"
        >
          <item.icon className="h-5 w-5" />
          {item.label}
          {item.badge ? (
            <span className="absolute right-3 top-1">
              <NavBadge count={item.badge} />
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
