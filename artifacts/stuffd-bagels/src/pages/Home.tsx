import { useState, useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  menuPricingObject,
  FAQ,
  TOPPINGS,
  EVENTS,
  upcomingEvents,
  type MarketEvent,
} from "@/content";

const BUSINESS_PHONE = "27724111011";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseDay(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function eventToCard(e: MarketEvent) {
  const s = parseDay(e.start);
  const en = parseDay(e.end);
  const sameDay = e.start === e.end;
  const sameMonth = s.getMonth() === en.getMonth();
  const days = sameDay
    ? `${s.getDate()}`
    : sameMonth
      ? `${s.getDate()}-${en.getDate()}`
      : `${s.getDate()} ${MONTHS[s.getMonth()]} - ${en.getDate()} ${MONTHS[en.getMonth()]}`;
  const weekday = (d: Date) => d.toLocaleDateString("en-ZA", { weekday: "short" });
  return {
    id: e.id,
    month: MONTHS[s.getMonth()],
    days,
    crossMonth: !sameMonth,
    when: sameDay ? s.toLocaleDateString("en-ZA", { weekday: "long" }) : `${weekday(s)} to ${weekday(en)}`,
    name: e.name,
    venue: e.venue,
  };
}

const TICKER_TEXT =
  "STUFF'D BAGELS ★ CAPE TOWN'S FIRST STUFFED BAGEL ★ EVERY BITE PACKED RIGHT ★ MORE MARKETS, MORE BAGELS ★ ";

const BLUE = "var(--sb-blue)";
const BLUE_DK = "var(--sb-blue-dk)";

/** Hand-drawn style star, like the doodles on their posters. Decorative only. */
function Star({
  className = "",
  fill = "var(--sb-photo)",
  style,
}: {
  className?: string;
  fill?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 48 48"
      className={className}
      style={style}
      fill={fill}
      stroke="var(--sb-ink)"
      strokeWidth="2.5"
      strokeLinejoin="round"
    >
      <path d="M24 3.5l5.6 13.2 14.1 1.1-10.8 9.3 3.4 13.9L24 33.4 11.7 41l3.4-13.9L4.3 17.8l14.1-1.1z" />
    </svg>
  );
}

/** Taped polaroid photo. `tilt` is the resting angle in degrees. */
function Polaroid({
  src,
  alt,
  tilt = 0,
  aspect = "4/5",
  caption,
  className = "",
  eager = false,
  width,
  height,
}: {
  src: string;
  alt: string;
  tilt?: number;
  aspect?: string;
  caption?: string;
  className?: string;
  eager?: boolean;
  width: number;
  height: number;
}) {
  return (
    <figure
      className={`polaroid tape lift m-0 ${className}`}
      style={{ "--tilt": `${tilt}deg`, "--tape-tilt": `${tilt > 0 ? -5 : 4}deg` } as CSSProperties}
    >
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        {...(eager ? { fetchPriority: "high" as const } : {})}
        style={{ aspectRatio: aspect }}
      />
      {caption && (
        <figcaption className="font-marker text-ink text-sm sm:text-base text-center pt-2 leading-tight">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

function SectionHead({ title, note, id }: { title: string; note?: string; id?: string }) {
  return (
    <div className="reveal mb-7 flex flex-wrap items-end gap-x-4 gap-y-1">
      <h2 id={id} className="font-bubble text-[2.1rem] sm:text-5xl text-blue leading-[1.05] m-0">
        <span className="scribble-underline">{title}</span>
      </h2>
      {note && <p className="font-marker text-ink text-base sm:text-lg -rotate-2 m-0 pb-1">{note}</p>}
    </div>
  );
}

function Stepper({
  label,
  qty,
  onDec,
  onInc,
  testid,
}: {
  label: string;
  qty: number;
  onDec: () => void;
  onInc: () => void;
  testid: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        data-testid={`btn-decrease-${testid}`}
        onClick={onDec}
        aria-label={`Remove one ${label}`}
        className="w-11 h-11 rounded-full border-2 border-ink font-black text-lg flex items-center justify-center active:scale-90 transition-transform bg-photo hover:bg-ink hover:text-paper"
      >
        −
      </button>
      <span className="font-black text-base w-6 text-center tabular-nums" aria-live="polite">
        {qty}
      </span>
      <button
        data-testid={`btn-increase-${testid}`}
        onClick={onInc}
        aria-label={`Add one ${label}`}
        className="w-11 h-11 rounded-full border-2 text-white font-black text-lg flex items-center justify-center active:scale-90 transition-transform"
        style={{ background: BLUE, borderColor: "var(--sb-ink)", boxShadow: "0 3px 0 var(--sb-ink)" }}
      >
        +
      </button>
    </div>
  );
}

/** Scroll reveal for `.reveal` elements. Skipped entirely when reduced motion is on. */
function useScrollReveal() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!("IntersectionObserver" in window)) return;
    const els = Array.from(document.querySelectorAll<HTMLElement>(".reveal"));
    // Anything already on screen stays visible, so nothing flickers on load.
    els.forEach((el) => {
      if (el.getBoundingClientRect().top < window.innerHeight) el.classList.add("is-in");
    });
    document.documentElement.classList.add("motion-ok");
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) {
            en.target.classList.add("is-in");
            io.unobserve(en.target);
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );
    els.forEach((el) => !el.classList.contains("is-in") && io.observe(el));
    return () => {
      io.disconnect();
      document.documentElement.classList.remove("motion-ok");
    };
  }, []);
}

function Reveal({
  children,
  className = "",
  delay = 0,
  fromTilt = 0,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  fromTilt?: number;
  as?: "div" | "section" | "li";
}) {
  return (
    <Tag
      className={`reveal ${className}`}
      style={{ "--d": `${delay}ms`, "--from-tilt": `${fromTilt}deg` } as CSSProperties}
    >
      {children}
    </Tag>
  );
}

const MENU_TILTS = [-1.6, 1.2, -0.8, 1.8];

export default function Home() {
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(Object.keys(menuPricingObject).map((k) => [k, 0])),
  );
  const [toppingQty, setToppingQty] = useState<Record<string, number>>(() =>
    Object.fromEntries(Object.keys(TOPPINGS).map((k) => [k, 0])),
  );
  // Start with the full list so the prerendered HTML matches the first client render,
  // then drop past events once the page is running in the browser.
  const [events, setEvents] = useState<MarketEvent[]>(EVENTS);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [venue, setVenue] = useState(EVENTS[0]?.venue ?? "");
  const [notes, setNotes] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [displayTotal, setDisplayTotal] = useState(0);
  const [detailsInView, setDetailsInView] = useState(false);
  const detailsRef = useRef<HTMLDivElement>(null);
  const [availability, setAvailability] = useState<{
    ordersEnabled: boolean;
    closedToday: boolean;
    closedMessage: string;
  } | null>(null);

  useScrollReveal();

  useEffect(() => {
    const upcoming = upcomingEvents();
    setEvents(upcoming);
    if (upcoming.length > 0) setVenue(upcoming[0].venue);
    fetch("/api/availability")
      .then((r) => r.json())
      .then(setAvailability)
      .catch(() => {});
  }, []);

  // Hide the mobile order bar once the details form is on screen.
  useEffect(() => {
    const el = detailsRef.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(([en]) => setDetailsInView(en.isIntersecting), {
      threshold: 0.05,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const total =
    Object.entries(quantities).reduce(
      (sum, [item, qty]) => sum + qty * menuPricingObject[item].price,
      0,
    ) +
    Object.entries(toppingQty).reduce(
      (sum, [t, qty]) => sum + qty * TOPPINGS[t],
      0,
    );

  useEffect(() => {
    const diff = total - displayTotal;
    if (diff === 0) return;
    const step =
      diff > 0
        ? Math.max(5, Math.ceil(diff / 4))
        : Math.min(-5, Math.floor(diff / 4));
    const t = setTimeout(
      () =>
        setDisplayTotal((prev) => {
          const next = prev + step;
          return (step > 0 && next >= total) || (step < 0 && next <= total)
            ? total
            : next;
        }),
      30,
    );
    return () => clearTimeout(t);
  }, [total, displayTotal]);

  const handleWhatsAppRedirect = () => {
    let orderLines = "";
    Object.entries(quantities).forEach(([item, qty]) => {
      if (qty > 0)
        orderLines += `${item} x${qty} - R${qty * menuPricingObject[item].price}\n`;
    });
    Object.entries(toppingQty).forEach(([t, qty]) => {
      if (qty > 0) orderLines += `${t} x${qty} - R${qty * TOPPINGS[t]}\n`;
    });
    const message = `NEW ORDER - STUFF'D BAGELS\n\nPickup: ${venue}\nName: ${name}\nPhone: ${phone}\n\nOrder:\n${orderLines}\nTotal: R${total}\n\nNotes: ${notes || "None"}\n\nSent via stuffdbagels.co.za`;
    window.open(
      `https://wa.me/${BUSINESS_PHONE}?text=${encodeURIComponent(message)}`,
      "_blank",
    );
    setShowModal(false);
  };

  const updateQuantity = (item: string, delta: number) => {
    setQuantities((prev) => ({
      ...prev,
      [item]: Math.max(0, prev[item] + delta),
    }));
  };

  const updateTopping = (t: string, delta: number) => {
    setToppingQty((prev) => ({ ...prev, [t]: Math.max(0, prev[t] + delta) }));
  };

  const itemCount = Object.values(quantities).reduce((a, b) => a + b, 0);
  const scheduleCards = events.map(eventToCard);
  const uniqueVenues = Array.from(new Set(scheduleCards.map((s) => s.venue)));

  const ordersDisabled =
    availability !== null &&
    (!availability.ordersEnabled || availability.closedToday);

  return (
    <div className="dot-paper min-h-screen text-ink overflow-x-hidden">
      {/* STICKY TICKER */}
      <div
        className="sticky top-0 z-40 overflow-hidden border-b-2 border-ink"
        style={{ background: BLUE }}
      >
        <div aria-hidden="true" className="ticker-track whitespace-nowrap py-2.5 text-white font-black text-xs tracking-widest uppercase">
          {TICKER_TEXT.repeat(6)}
        </div>
      </div>

      {/* ─── HERO: logo left, scrapbook collage right ─────────── */}
      <header className="relative border-b-2 border-ink">
        <div className="max-w-6xl mx-auto px-4 lg:px-10 pt-10 pb-14 lg:pt-16 lg:pb-20 grid gap-12 lg:gap-8 lg:grid-cols-[1.05fr_1fr] items-center">
          <div className="flex flex-col items-start gap-5 text-left">
            <p className="hero-pop font-black tracking-[0.3em] text-[11px] uppercase text-blue m-0">
              Cape Town's first stuffed bagel
            </p>
            {/* The client's logo. The H1 text stays for search engines and screen readers. */}
            <h1 className="hero-pop m-0 w-full" style={{ "--d": "80ms" } as CSSProperties}>
              <img
                src="/logo-blue.svg"
                alt="STUFF'D Bagels"
                width={967}
                height={369}
                className="block w-full max-w-[560px] h-auto"
              />
            </h1>
            <p
              className="hero-pop font-marker text-ink text-xl lg:text-2xl -rotate-2 m-0"
              style={{ "--d": "180ms" } as CSSProperties}
            >
              Every bite packed right.
            </p>
            <div
              className="hero-pop flex flex-wrap items-center gap-x-6 gap-y-3 pt-1"
              style={{ "--d": "260ms" } as CSSProperties}
            >
              <a
                href="#order"
                className="inline-flex items-center gap-2 rounded-full border-2 border-ink text-white px-8 py-3.5 font-black uppercase tracking-widest text-sm transition-transform hover:-translate-y-0.5 active:translate-y-0.5"
                style={{ background: BLUE, boxShadow: "0 5px 0 var(--sb-ink)" }}
              >
                get <span className="font-bubble text-lg normal-case tracking-normal">STUFF'D</span>
              </a>
              <a href="#where" className="font-bold text-sm underline underline-offset-4 decoration-2 decoration-blue hover:text-blue">
                Where's the cart this week?
              </a>
            </div>
          </div>

          {/* Collage */}
          <div className="relative mx-auto w-full max-w-[460px] h-[400px] sm:h-[470px]" aria-label="Photos from @stuffd.bagels" role="group">
            <Polaroid
              src="/ig/cart.jpg"
              alt="The blue STUFF'D Bagels cart at a market"
              width={506}
              height={900}
              aspect="3/4"
              tilt={-6}
              eager
              caption="the cart's here"
              className="hero-drop absolute left-0 top-2 w-[54%]"
            />
            <Polaroid
              src="/ig/jalapeno-poster.jpg"
              alt="Holding a jalapeno stuffed bagel, blue duotone photo"
              width={719}
              height={900}
              aspect="4/5"
              tilt={5}
              eager
              className="hero-drop absolute right-0 top-0 w-[52%]"
            />
            <Polaroid
              src="/ig/chic.jpg"
              alt="A customer biting into a STUFF'D bagel at a market"
              width={393}
              height={700}
              aspect="1/1"
              tilt={-2}
              caption="market day"
              className="hero-drop absolute right-[10%] bottom-0 w-[42%]"
            />
            <Star className="hero-pop absolute w-12 h-12 -top-4 left-[46%] rotate-12" fill="var(--sb-blue)" style={{ "--d": "500ms" } as CSSProperties} />
            <Star className="hero-pop absolute w-9 h-9 bottom-10 left-[6%] -rotate-12" style={{ "--d": "620ms" } as CSSProperties} />
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 lg:px-10 py-14 lg:py-20">
        {/* ─── WHERE WE AT: folder-tab cards like their "Upcoming markets" post ── */}
        <section aria-labelledby="where" className="scroll-mt-16">
          <SectionHead id="where" title="Where We At" note="more markets, more bagels" />

          {scheduleCards.length === 0 && (
            <p className="rounded-2xl border-2 border-ink bg-photo px-4 py-4 text-sm font-bold">
              New dates coming soon. Follow{" "}
              <a className="underline" href="https://instagram.com/stuffd.bagels" target="_blank" rel="noopener noreferrer">
                @stuffd.bagels
              </a>{" "}
              for the next market.
            </p>
          )}

          <ol className="list-none p-0 m-0 grid gap-x-5 gap-y-7 sm:grid-cols-2 lg:grid-cols-4">
            {scheduleCards.map((sched, idx) => {
              const next = idx === 0;
              return (
                <Reveal as="li" key={sched.id} delay={idx * 90}>
                  <div data-testid={`schedule-card-${idx}`} className="h-full flex flex-col">
                    <div
                      className="folder-tab self-start px-4 pt-1.5 pb-1 font-marker text-sm"
                      style={{ background: next ? BLUE : "var(--sb-photo)", color: next ? "white" : "var(--sb-ink)" }}
                    >
                      {next ? "Next up" : sched.month}
                    </div>
                    <div
                      className="flex-1 rounded-b-2xl rounded-tr-2xl border-2 border-ink px-4 py-4 flex flex-col gap-1"
                      style={{
                        background: next ? BLUE : "var(--sb-photo)",
                        color: next ? "white" : "var(--sb-ink)",
                        boxShadow: "var(--sb-shadow)",
                      }}
                    >
                      <div className="flex items-baseline gap-2">
                        <span className={`font-bubble leading-none ${sched.crossMonth ? "text-3xl" : "text-4xl"}`}>{sched.days}</span>
                        {!sched.crossMonth && <span className="font-black uppercase tracking-widest text-xs">{sched.month}</span>}
                      </div>
                      <div className="text-sm font-medium opacity-90">{sched.when}</div>
                      <div className="mt-2 font-black text-base leading-snug">{sched.name}</div>
                      <div className="text-sm font-medium opacity-90">{sched.venue}</div>
                    </div>
                  </div>
                </Reveal>
              );
            })}
          </ol>
        </section>

        {/* ─── ORDER UP ──────────────────────────────────── */}
        <div className="mt-20 lg:mt-28 scroll-mt-16" id="order">
          <section aria-labelledby="order-heading">
            <SectionHead id="order-heading" title="Order Up" note="pick your bagels" />

            <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
              {Object.entries(menuPricingObject).map(([item, info], idx) => (
                <Reveal key={item} delay={idx * 80} fromTilt={MENU_TILTS[idx % 4] * 3}>
                  <article
                    className="polaroid tape h-full flex flex-col"
                    style={{ "--tilt": `${MENU_TILTS[idx % 4]}deg` } as CSSProperties}
                    data-testid={`menu-item-${item}`}
                  >
                    <div className="relative">
                      <img
                        src={info.image}
                        alt={item}
                        width={900}
                        height={1200}
                        loading="lazy"
                        decoding="async"
                        className="polaroid-photo"
                        style={{ aspectRatio: "4/3" }}
                      />
                      <span
                        className="price-sticker absolute z-10 -top-3 -right-3 w-16 h-16 rounded-full border-2 border-ink flex items-center justify-center font-bebas text-2xl text-white"
                        style={{ background: BLUE }}
                      >
                        R{info.price}
                      </span>
                      {quantities[item] > 0 && (
                        <div
                          className="absolute inset-0 flex items-center justify-center"
                          style={{ background: "color-mix(in srgb, var(--sb-blue) 82%, transparent)" }}
                          aria-hidden="true"
                        >
                          <span className="font-bubble text-white" style={{ fontSize: "4rem", lineHeight: 1 }}>
                            {quantities[item]}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col flex-1 pt-3 px-1 gap-3">
                      <div>
                        <h3 className="font-bubble text-2xl leading-tight m-0 text-ink">{item.replace(" Bagel", "")}</h3>
                        <p className="text-ink/75 text-sm font-medium mt-1 leading-snug m-0">{info.desc}</p>
                      </div>
                      <div className="flex items-center justify-between mt-auto">
                        <span className="font-marker text-sm text-ink/80">how many?</span>
                        <Stepper
                          label={item}
                          qty={quantities[item]}
                          testid={item}
                          onDec={() => updateQuantity(item, -1)}
                          onInc={() => updateQuantity(item, 1)}
                        />
                      </div>
                    </div>
                  </article>
                </Reveal>
              ))}
            </div>

            <Reveal className="mt-10">
              <div
                className="rounded-2xl border-2 border-dashed border-ink bg-photo px-4 py-3 grid gap-3 sm:grid-cols-[auto_1fr_1fr] sm:items-center sm:gap-x-8"
              >
                <span className="font-bubble text-xl text-blue">
                  Add toppings <span className="font-sans font-bold text-sm text-ink/75">(+R5 each)</span>
                </span>
                {Object.entries(TOPPINGS).map(([t, price]) => (
                  <div key={t} className="flex items-center justify-between gap-2" data-testid={`topping-${t}`}>
                    <span className="text-sm font-bold">
                      {t} <span className="font-bebas text-lg text-ink/75 ml-1">+R{price}</span>
                    </span>
                    <Stepper
                      label={t}
                      qty={toppingQty[t]}
                      testid={t}
                      onDec={() => updateTopping(t, -1)}
                      onInc={() => updateTopping(t, 1)}
                    />
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-2xl border-2 border-ink bg-ink text-paper px-5 py-4 flex items-center justify-between">
                <span className="font-black tracking-widest text-sm uppercase">
                  {itemCount > 0
                    ? `${itemCount} bagel${itemCount !== 1 ? "s" : ""}`
                    : "Your order"}
                </span>
                <span className="font-bebas text-3xl">R{displayTotal}</span>
              </div>
            </Reveal>
          </section>

          {/* ─── YOUR DETAILS ───────────────────────────── */}
          <div ref={detailsRef} id="details" className="mt-20 lg:mt-24 scroll-mt-16">
            <SectionHead title="Your Details" note="we'll WhatsApp it to the kitchen" />

            <div className="lg:grid lg:grid-cols-2 lg:gap-12 lg:items-center">
              <Reveal className="hidden lg:block" fromTilt={-4}>
                <img
                  src="/mascot-drop.png"
                  alt=""
                  width={600}
                  height={600}
                  loading="lazy"
                  className="w-full max-w-md mx-auto object-contain"
                />
              </Reveal>

              <section aria-label="Your details">
                <div className="lg:hidden flex items-center gap-3 mb-5">
                  <img src="/mascot.png" alt="" width={640} height={640} loading="lazy" className="w-24 h-24 object-contain shrink-0" />
                  <p className="font-medium text-sm leading-snug m-0">
                    Fill this in and we'll build your WhatsApp order. You just hit send.
                  </p>
                </div>
                <div className="rounded-2xl border-2 border-ink divide-y-2 divide-ink bg-photo overflow-hidden" style={{ boxShadow: "var(--sb-shadow)" }}>
                  {[
                    {
                      label: "Name",
                      type: "text",
                      placeholder: "Your name",
                      value: name,
                      set: setName,
                      id: "input-name",
                      auto: "name",
                    },
                    {
                      label: "Phone",
                      type: "tel",
                      placeholder: "082 123 4567",
                      value: phone,
                      set: setPhone,
                      id: "input-phone",
                      auto: "tel",
                    },
                  ].map((f) => (
                    <div key={f.label} className="flex flex-col">
                      <label
                        htmlFor={f.id}
                        className="font-black text-[11px] tracking-widest uppercase px-4 pt-3 pb-1 text-ink/75"
                      >
                        {f.label}
                      </label>
                      <input
                        id={f.id}
                        data-testid={f.id}
                        type={f.type}
                        autoComplete={f.auto}
                        placeholder={f.placeholder}
                        value={f.value}
                        onChange={(e) => f.set(e.target.value)}
                        className="px-4 pb-3 bg-transparent font-bold text-base outline-none placeholder:text-ink/45 focus-visible:bg-sky/30"
                      />
                    </div>
                  ))}
                  <div className="flex flex-col">
                    <label
                      htmlFor="select-venue"
                      className="font-black text-[11px] tracking-widest uppercase px-4 pt-3 pb-1 text-ink/75"
                    >
                      Pickup Location
                    </label>
                    <select
                      id="select-venue"
                      data-testid="select-venue"
                      value={venue}
                      onChange={(e) => setVenue(e.target.value)}
                      className="px-4 pb-3 bg-transparent font-bold text-base outline-none appearance-none focus-visible:bg-sky/30"
                    >
                      {uniqueVenues.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col">
                    <label
                      htmlFor="textarea-notes"
                      className="font-black text-[11px] tracking-widest uppercase px-4 pt-3 pb-1 text-ink/75"
                    >
                      Notes
                    </label>
                    <textarea
                      id="textarea-notes"
                      data-testid="textarea-notes"
                      placeholder="Any special requests?"
                      rows={2}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="px-4 pb-3 bg-transparent font-bold text-base outline-none resize-none placeholder:text-ink/45 focus-visible:bg-sky/30"
                    />
                  </div>
                </div>

                <p className="text-sm font-medium mt-3 text-ink/75 leading-relaxed px-1">
                  No payment online. Tap your card (Yoco) or pay cash at the
                  cart when you collect.
                </p>

                {ordersDisabled && (
                  <p className="mt-4 rounded-2xl border-2 border-ink px-4 py-3 text-sm font-bold text-center tracking-wide uppercase bg-ink text-paper">
                    {availability?.closedMessage || "Orders closed for today. See you next time!"}
                  </p>
                )}
                <button
                  data-testid="btn-place-order"
                  onClick={() => !ordersDisabled && setShowModal(true)}
                  disabled={ordersDisabled}
                  className="mt-4 w-full rounded-full text-white border-2 p-4 uppercase tracking-widest transition-transform hover:-translate-y-0.5 active:translate-y-0.5 font-bebas"
                  style={{
                    fontSize: "1.4rem",
                    letterSpacing: "0.12em",
                    background: ordersDisabled ? "var(--sb-disabled)" : BLUE,
                    borderColor: ordersDisabled ? "var(--sb-disabled-border)" : "var(--sb-ink)",
                    boxShadow: ordersDisabled ? "none" : "0 5px 0 var(--sb-ink)",
                    cursor: ordersDisabled ? "not-allowed" : "pointer",
                    opacity: ordersDisabled ? 0.6 : 1,
                  }}
                >
                  {ordersDisabled ? "Orders Closed" : "Get STUFF'D on WhatsApp"}
                  {!ordersDisabled && total > 0 && (
                    <span className="ml-3 text-white/85 text-base">· R{total}</span>
                  )}
                </button>
              </section>
            </div>
          </div>
        </div>

        {/* ─── ABOUT: scrapbook spread ── */}
        <section aria-labelledby="about" className="mt-24 lg:mt-32">
          <SectionHead id="about" title="About Us" />
          <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:items-center">
            <Reveal fromTilt={2}>
              <div
                className="relative rounded-2xl border-2 border-ink px-6 py-7 sm:px-8 sm:py-9 text-white -rotate-1"
                style={{ background: BLUE, boxShadow: "0 8px 0 var(--sb-ink)" }}
              >
                <Star className="absolute w-11 h-11 -top-5 -right-4 rotate-12" />
                <p className="font-bubble leading-tight text-[1.75rem] sm:text-4xl m-0">
                  Born on the street. Built different.
                </p>
                <p className="font-medium text-base leading-relaxed mt-5 mb-0 max-w-[60ch]">
                  STUFF'D started with one question: why does Cape Town not have
                  a proper stuffed bagel? We took the classic New York bagel,
                  packed it with bold fillings, and brought it to the streets of
                  the Mother City.
                </p>
                <p className="font-medium text-base leading-relaxed mt-3 mb-0 text-white/90 max-w-[60ch]">
                  Find the cart at markets and festivals across Cape Town. No
                  tables, no reservations. Just fresh bagels, fast.
                </p>
                <p className="font-marker text-white text-lg mt-5 mb-0">STUFF'D, served on repeat.</p>
              </div>
            </Reveal>

            <div className="grid grid-cols-2 gap-x-5 gap-y-9 sm:gap-x-8 px-2">
              <Reveal fromTilt={-6}>
                <Polaroid src="/ig/boxes.jpg" alt="Pizza and jalapeno stuffed bagels in takeaway boxes" width={769} height={900} aspect="1/1" tilt={-3} />
              </Reveal>
              <Reveal delay={90} fromTilt={6} className="mt-8">
                <Polaroid src="/ig/unboxing.jpg" alt="Opening a STUFF'D takeaway box" width={450} height={800} aspect="4/5" tilt={3} caption="the unboxing" />
              </Reveal>
              <Reveal delay={60} fromTilt={4} className="-mt-6">
                <Polaroid src="/ig/stripes.jpg" alt="A garlic stuffed bagel in its box" width={730} height={900} aspect="4/5" tilt={2} />
              </Reveal>
              <Reveal delay={150} fromTilt={-5}>
                <Polaroid src="/ig/friends.jpg" alt="Friends sharing STUFF'D bagels on a couch" width={720} height={405} aspect="1/1" tilt={-2.5} caption="bring the crew" />
              </Reveal>
            </div>
          </div>
        </section>

        {/* ─── FAQ: chat style ──── */}
        <section aria-labelledby="faq" className="mt-24 lg:mt-32 lg:max-w-2xl lg:mx-auto">
          <SectionHead id="faq" title="Got Questions?" />

          <Reveal>
            <div
              className="rounded-2xl border-2 border-ink overflow-hidden"
              style={{ background: "var(--sb-chat-bg)", boxShadow: "var(--sb-shadow)" }}
            >
              <div className="flex items-center gap-3 px-4 py-3 border-b-2 border-ink bg-photo">
                <div className="relative">
                  <div
                    className="w-9 h-9 rounded-full border-2 border-ink overflow-hidden flex items-center justify-center"
                    style={{ background: BLUE }}
                  >
                    <span className="font-bubble text-white text-xs">S'D</span>
                  </div>
                  <div className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-chat-green border border-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-black text-sm text-ink">STUFF'D Bagels</div>
                  <div className="text-[11px] text-ink/75 font-medium">Chat to us on WhatsApp</div>
                </div>
              </div>

              <div className="px-3 py-4 space-y-5">
                {FAQ.map((msg, i) => (
                  <div key={i} className="space-y-1.5">
                    <div className="text-center text-[11px] text-ink/75 font-medium">
                      {msg.time}
                    </div>
                    <div className="flex items-end gap-2">
                      <div className="w-6 h-6 rounded-full bg-chat-avatar border border-ink/10 shrink-0 flex items-center justify-center mb-0.5">
                        <span className="text-[8px] font-black text-chat-avatar-ink">
                          YOU
                        </span>
                      </div>
                      <div
                        className="max-w-[78%] px-3 py-2 text-sm font-medium text-ink leading-snug"
                        style={{
                          background: "white",
                          borderRadius: "18px 18px 18px 4px",
                          boxShadow: "0 1px 1px rgba(0,0,0,0.08)",
                        }}
                      >
                        {msg.q}
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <div
                        className="max-w-[78%] px-3 py-2 text-sm font-medium text-white leading-snug"
                        style={{
                          background: BLUE,
                          borderRadius: "18px 18px 4px 18px",
                        }}
                      >
                        {msg.a}
                      </div>
                    </div>
                  </div>
                ))}

                <div className="flex items-end gap-2">
                  <div
                    className="w-6 h-6 rounded-full shrink-0 overflow-hidden border border-ink/10 flex items-center justify-center"
                    style={{ background: BLUE }}
                  >
                    <span className="font-bubble text-[7px] text-white">S'D</span>
                  </div>
                  <div
                    className="px-4 py-3 flex gap-1 items-center"
                    style={{
                      background: "white",
                      borderRadius: "18px 18px 18px 4px",
                      boxShadow: "0 1px 1px rgba(0,0,0,0.08)",
                    }}
                  >
                    {[0, 0.2, 0.4].map((delay, i) => (
                      <div
                        key={i}
                        className="typing-dot w-2 h-2 rounded-full bg-chat-gray"
                        style={{ animation: `bounce 1.2s ${delay}s infinite` }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </Reveal>
        </section>
      </main>

      {/* FOOTER — full width */}
      <footer className="border-t-2 border-ink bg-ink text-paper relative overflow-hidden pb-20 lg:pb-0">
        <div className="max-w-6xl mx-auto px-6 lg:px-10 py-12 grid grid-cols-1 sm:grid-cols-3 gap-10 items-center">
          <div className="flex flex-col items-center sm:items-start gap-2">
            <img
              src="/logo-white.png"
              alt="STUFF'D Bagels"
              width={967}
              height={369}
              loading="lazy"
              className="w-56 h-auto"
            />
            <p className="font-marker text-sky text-base mt-2 text-center sm:text-left">
              When hunger calls, it&apos;s time to get STUFF&apos;D.
            </p>
          </div>

          <div className="flex flex-col items-center sm:items-start gap-3">
            <div className="font-black text-xs tracking-widest uppercase mb-1 text-sky">
              Get In Touch
            </div>
            <a href="tel:+27724111011" className="text-paper/85 hover:text-white text-sm transition-colors">
              +27 72 411 1011
            </a>
            <a href="mailto:stuffd.bagels@gmail.com" className="text-paper/85 hover:text-white text-sm transition-colors">
              stuffd.bagels@gmail.com
            </a>
            <div className="text-paper/85 text-xs mt-1">Cape Town, South Africa 🇿🇦</div>
          </div>

          <div className="flex flex-col items-center sm:items-start gap-3">
            <div className="font-black text-xs tracking-widest uppercase mb-1 text-sky">
              Follow Us
            </div>
            <a
              href="https://instagram.com/stuffd.bagels"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-paper/85 hover:text-white text-sm transition-colors"
            >
              <svg aria-hidden="true" className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
              </svg>
              @stuffd.bagels
            </a>
            <a
              href="https://tiktok.com/@stuffd.bagels"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-paper/85 hover:text-white text-sm transition-colors"
            >
              <svg aria-hidden="true" className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.18 8.18 0 004.78 1.52V6.76a4.85 4.85 0 01-1.01-.07z" />
              </svg>
              @stuffd.bagels
            </a>
          </div>
        </div>

        <div className="border-t border-paper/15 py-4 px-6 lg:px-10 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs">
          <div className="text-paper/85 tracking-widest uppercase">
            © 2026 Stuff'd Bagels · Cape Town
          </div>
          <a
            href="https://digitalpantry.co.za"
            target="_blank"
            rel="noopener"
            className="text-paper/85 hover:text-white transition-colors"
          >
            Website by Digital Pantry
          </a>
        </div>
      </footer>

      {/* MOBILE ORDER BAR: shows once something is picked, hides when the form is on screen */}
      {itemCount > 0 && !detailsInView && !ordersDisabled && (
        <div className="lg:hidden fixed inset-x-3 bottom-3 z-30">
          <a
            href="#details"
            className="flex items-center justify-between rounded-full border-2 border-ink text-white pl-5 pr-2 py-2"
            style={{ background: BLUE, boxShadow: "0 5px 0 var(--sb-ink)" }}
          >
            <span className="font-black text-sm tracking-widest uppercase">
              {itemCount} bagel{itemCount !== 1 ? "s" : ""} · R{total}
            </span>
            <span className="rounded-full bg-photo text-ink font-black text-sm uppercase tracking-widest px-4 py-2">
              Checkout
            </span>
          </a>
        </div>
      )}

      {/* MODAL */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="border-2 border-ink rounded-2xl bg-paper max-w-[92vw] w-[400px] p-0 overflow-hidden [&>button]:text-white! [&>button]:bg-transparent! [&>button]:opacity-100">
          <div className="p-5 border-b-2 border-ink" style={{ background: BLUE }}>
            <DialogHeader>
              <DialogTitle className="font-bubble text-white leading-tight text-2xl">
                Awesome! Handing over to WhatsApp...
              </DialogTitle>
            </DialogHeader>
          </div>
          <div className="p-5">
            <DialogDescription className="font-medium text-sm text-ink/75 leading-relaxed">
              We've built your order message for you. When WhatsApp opens, hit{" "}
              <strong className="text-ink">Send</strong> to log your order
              with our kitchen.
            </DialogDescription>
            {total > 0 && (
              <div className="mt-4 rounded-xl border-2 border-ink p-3 bg-ink text-paper flex justify-between items-center">
                <span className="font-black text-xs tracking-widest uppercase">
                  Order Total
                </span>
                <span className="font-bebas text-2xl">R{total}</span>
              </div>
            )}
            <button
              data-testid="btn-whatsapp-send"
              onClick={handleWhatsAppRedirect}
              className="mt-4 w-full rounded-full text-white border-2 border-ink p-4 uppercase tracking-widest active:scale-[0.98] transition-transform font-bebas"
              style={{ fontSize: "1.2rem", background: BLUE, boxShadow: "0 4px 0 var(--sb-ink)" }}
            >
              Open WhatsApp & Send
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
