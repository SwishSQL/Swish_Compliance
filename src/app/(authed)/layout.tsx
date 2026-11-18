import { Suspense } from "react";
import { requireUser } from "@/lib/auth/guard";
import { ROLE_LABELS, isRole } from "@/lib/auth/permissions";
import Sidebar from "@/features/shell/Sidebar";
import NavigationProgress from "@/features/shell/NavigationProgress";

export default async function AuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  return (
    <>
      <Suspense fallback={null}>
        <NavigationProgress />
      </Suspense>
      <Sidebar
        displayName={user.displayName}
        role={user.role}
        roleTitle={user.roles.map((r) => (isRole(r) ? ROLE_LABELS[r] : r)).join(" · ")}
        permissions={Array.from(user.permissions)}
      />
      {children}
    </>
  );
}
