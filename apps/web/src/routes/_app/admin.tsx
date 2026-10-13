import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/admin")({
  beforeLoad: ({ context }) => {
    if (context.user.role !== "admin") {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw redirect({ to: "/feed" });
    }
  },
  component: AdminLayout,
});

const tabs = [
  { to: "/admin/reports", label: "Reports" },
  { to: "/admin/members", label: "Members" },
  { to: "/admin/invites", label: "Invite tree" },
  { to: "/admin/audit", label: "Audit log" },
];

function AdminLayout() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <nav className="flex gap-2 border-b border-border pb-2">
        {tabs.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            // See nav.tsx's NavRail for why this is a data-[status=active]: variant rather than
            // activeProps - two separately concatenated class strings fighting over the same
            // CSS property silently lose to Tailwind's generated stylesheet order.
            className="min-h-11 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground data-[status=active]:bg-muted data-[status=active]:text-foreground"
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <Outlet />
    </main>
  );
}
