import { useEffect, useRef, useState } from "react";

/** Mobile menu (founder 2026-11-25): a waffle (3x3 dots) button under the ticker that opens the page's sections. Phones and tablets only. */
const LINKS: { href: string; label: string }[] = [
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
            {LINKS.map((l) => (
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
