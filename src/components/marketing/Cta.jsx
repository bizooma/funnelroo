import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/AuthContext";
import { APP_ENTRY, REGISTER_URL } from "./constants";

// Primary account action. Signed-out visitors get "Get Started" (register);
// signed-in visitors get "Open App" (the authenticated entry).
/** @param {{ className?: string; size?: "default" | "sm" | "lg" | "icon"; label?: string }} props */
export function PrimaryCta({ className = "", size = "default", label }) {
  const { isAuthenticated, authChecked } = useAuth();
  if (authChecked && isAuthenticated) {
    return (
      <Button asChild className={className} size={size}>
        <Link to={APP_ENTRY}>{label || "Open App"}</Link>
      </Button>
    );
  }
  return (
    <Button asChild className={className} size={size}>
      <Link to={REGISTER_URL}>{label || "Get Started"}</Link>
    </Button>
  );
}