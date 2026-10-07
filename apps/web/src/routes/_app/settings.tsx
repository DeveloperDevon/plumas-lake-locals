import { createFileRoute, Link, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/settings")({ component: SettingsLayout });

const tabs = [
  { to: "/settings/appearance", label: "Appearance" },
  { to: "/settings/invites", label: "Invites" },
  { to: "/settings/account", label: "Account" },
];

function SettingsLayout() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <nav className="flex gap-2 border-b border-border pb-2">
        {tabs.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            className="min-h-11 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            activeProps={{ className: "bg-muted text-foreground" }}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <Outlet />
    </main>
  );
}
