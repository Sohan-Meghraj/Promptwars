import { ShieldCheck } from "lucide-react";
import Link from "next/link";

export function Brand({ href = "/today", dark = false }: { href?: string; dark?: boolean }) {
  return (
    <Link className="brand" href={href} aria-label="ScrollGate home" style={dark ? { color: "#eff5f0" } : undefined}>
      <span className="brand-mark" aria-hidden="true"><ShieldCheck size={34} strokeWidth={2.3} /></span>
      <span>ScrollGate</span>
    </Link>
  );
}
