import { useEffect, useRef, useState } from "react";

/** Mobile menu (founder 2026-11-25): a waffle (3x3 dots) button under the ticker that opens the page's sections. Phones and tablets only. */
export const NAV_LINKS: { href: string; label: string }[] = [
  { href: "#where", label: "Markets" },
  { href: "#order", label: "Menu" },
  { href: "#details", label: "Order online" },
  { href: "#about", label: "Our story" },
  { href: "#book", label: "Book us for an event" },
  { href: "#faq", label: "Questions" },
];

function Waffle() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="currentColor">
      {[3, 10, 17].flatMap((y) => [3, 10, 17].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="2.2" />))}
    </svg>
  );
}

function Cross() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
      <path d="M4 4l12 12M16 4L4 16" />
    </svg>
  );
}

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLAnchorElement>("a")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  return (
    <div className="lg:hidden absolute right-3 top-full mt-3" data-testid="mobile-nav">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls="mobile-nav-panel"
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((o) => !o)}
        className="grid place-items-center w-12 h-12 rounded-full border-2 border-ink bg-photo text-blue transition-transform duration-150 active:translate-y-0.5"
        style={{ boxShadow: "0 4px 0 var(--sb-ink)" }}
      >
        {open ? <Cross /> : <Waffle />}
      </button>
      <div
        ref={panel}
        id="mobile-nav-panel"
        hidden={!open}
        className="absolute right-0 top-full mt-3 w-[min(17rem,calc(100vw-1.5rem))] rounded-[22px] border-2 border-ink bg-photo p-2"
        style={{ boxShadow: "0 6px 0 var(--sb-ink)" }}
      >
        <nav aria-label="Sections">
          <ul className="m-0 p-0 list-none">
            {NAV_LINKS.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="flex items-center min-h-12 px-4 rounded-2xl font-bold text-ink text-base hover:bg-sky/60 focus-visible:bg-sky/60"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
}

/** Desktop nav bar (founder 2026-11-25): under the ticker, sticks with it. Laptops and up only; phones use the waffle. */
export function DesktopNav() {
  const links = NAV_LINKS.filter((l) => l.href !== "#details");
  return (
    <nav aria-label="Sections" className="hidden lg:block bg-paper/95 backdrop-blur border-b-2 border-ink" data-testid="desktop-nav">
      <div className="mx-auto max-w-6xl px-10 h-16 flex items-center justify-between gap-8">
        <a href="#top" className="shrink-0" aria-label="STUFF'D Bagels, back to the top">
          <img src="/logo-blue.svg" alt="" width={967} height={369} className="block h-10 w-auto" />
        </a>
        <ul className="m-0 p-0 list-none flex items-center gap-7">
          {links.map((l) => (
            <li key={l.href}>
              <a href={l.href} className="font-bold text-sm text-ink underline-offset-[6px] decoration-2 decoration-blue hover:underline focus-visible:underline">
                {l.label}
              </a>
            </li>
          ))}
          <li>
            <a
              href="#order"
              className="inline-flex items-center rounded-full border-2 border-ink bg-blue text-white px-5 py-2 font-black uppercase tracking-widest text-xs transition-transform duration-150 hover:-translate-y-0.5 active:translate-y-0.5"
              style={{ boxShadow: "0 3px 0 var(--sb-ink)" }}
            >
              Order online
            </a>
          </li>
        </ul>
      </div>
    </nav>
  );
}
