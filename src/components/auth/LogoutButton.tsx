"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/Button";

/** Signs the user out and returns them to the homepage. */
export function LogoutButton({
  variant = "secondary",
  size = "md",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);
    try {
      // Server-side: the session row is revoked AND the HTTP-only cookie is
      // cleared, so nothing keeps a usable token after this.
      const { signOutCurrentUser } = await import("@/lib/actions/auth");
      await signOutCurrentUser();
      router.push("/");
      router.refresh();
    } catch {
      // Even a failed revoke returns the user home rather than trapping them.
      router.push("/");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      onClick={handleLogout}
      disabled={loading}
    >
      {loading ? "Logging out…" : "Log out"}
    </Button>
  );
}
