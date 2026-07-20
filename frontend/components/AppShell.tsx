"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Which nav pill a route belongs to. Processing (/jobs/[id]) is part of the
// "New" flow; the viewer belongs with "Memories" — mirrors the prototype.
function section(pathname: string): "new" | "memories" | "studio" | null {
  if (pathname === "/") return "new";
  if (pathname.startsWith("/studio")) return "studio";
  if (pathname === "/jobs") return "memories";
  if (pathname.startsWith("/viewer")) return "memories";
  if (pathname.startsWith("/jobs/")) return "new";
  return null;
}

const LINKS = [
  { href: "/", label: "New", key: "new" },
  { href: "/jobs", label: "Memories", key: "memories" },
  { href: "/studio", label: "Studio", key: "studio" },
] as const;

export default function AppShell() {
  const active = section(usePathname());

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-ink/10 bg-paper px-4 sm:px-8">
      <div className="flex min-w-0 items-center gap-3 sm:gap-8">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2.5 font-serif text-xl font-bold tracking-tight text-ink sm:text-2xl"
        >
          <span className="inline-block size-[11px] rounded-full bg-terra" />
          {/* The wordmark alone costs ~120px — the dot carries the brand on
              phones so the nav pills don't push the page into overflow. */}
          <span className="hidden xs:inline">WeddingAI</span>
        </Link>
        <nav className="flex min-w-0 items-center gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] sm:gap-1.5 [&::-webkit-scrollbar]:hidden">
          {LINKS.map((l) => (
            <Link
              key={l.key}
              href={l.href}
              className={
                active === l.key
                  ? "shrink-0 rounded-full bg-ink px-3 py-2 text-[13px] font-semibold text-cream sm:px-4 sm:text-[13.5px]"
                  : "shrink-0 rounded-full px-3 py-2 text-[13px] font-medium text-taupe transition-colors hover:bg-ink/5 sm:px-4 sm:text-[13.5px]"
              }
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-4">
        <span className="hidden text-[13px] font-medium text-mocha sm:inline">
          Help
        </span>
        <div className="flex size-[34px] items-center justify-center rounded-full bg-terra text-xs font-semibold text-white">
          JV
        </div>
      </div>
    </header>
  );
}
