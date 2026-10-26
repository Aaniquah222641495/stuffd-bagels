import { useState, useEffect } from "react";
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
  const range = sameDay
    ? `${s.getDate()} ${MONTHS[s.getMonth()]}`
    : sameMonth
      ? `${s.getDate()}–${en.getDate()} ${MONTHS[s.getMonth()]}`
      : `${s.getDate()} ${MONTHS[s.getMonth()]} – ${en.getDate()} ${MONTHS[en.getMonth()]}`;
  return {
    id: e.id,
    day: s.toLocaleDateString("en-ZA", { weekday: "long" }),
    date: String(s.getDate()),
    range,
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
  fill = "var(--sb-highlight)",
}: {
  className?: string;
  fill?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 48 48"
      className={className}
      fill={fill}
      stroke="var(--sb-ink)"
      strokeWidth="2.5"
      strokeLinejoin="round"
    >
      <path d="M24 3.5l5.6 13.2 14.1 1.1-10.8 9.3 3.4 13.9L24 33.4 11.7 41l3.4-13.9L4.3 17.8l14.1-1.1z" />
    </svg>
  );
}

function SectionHead({ n, title }: { n: string; title: string }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <span
        className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-white font-black text-xs"
        style={{ background: BLUE }}
      >
        {n}
      </span>
      <h2 className="font-bubble text-2xl lg:text-3xl text-ink leading-none">
        {title}
      </h2>
      <div className="flex-1 h-[2px] bg-ink" />
    </div>
  );
}

function BagelPin({
  date,
  active = false,
}: {
  date: string;
  active?: boolean;
}) {
  return (
    <div className="relative" style={{ width: 54, height: 54 }}>
      <img
        src="/bagel-pin.png"
        alt=""
        width={108}
        height={108}
        decoding="async"
        className="w-full h-full object-contain"
        style={{
          filter: active
            ? "drop-shadow(0 2px 8px rgba(44,72,230,0.6))"
            : "grayscale(0.3) brightness(0.88)",
        }}
      />
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{ paddingBottom: "2px" }}
      >
        <span
          className="font-bebas text-white leading-none"
          style={{
            fontSize: "0.95rem",
            textShadow: "0 1px 3px rgba(0,0,0,0.8), 0 0 6px rgba(0,0,0,0.6)",
          }}
        >
          {date}
        </span>
      </div>
    </div>
  );
}

export default function Home() {
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(Object.keys(menuPricingObject).map((k) => [k, 0])),
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
  const [availability, setAvailability] = useState<{
    ordersEnabled: boolean;
    closedToday: boolean;
    closedMessage: string;
  } | null>(null);

  useEffect(() => {
    const upcoming = upcomingEvents();
    setEvents(upcoming);
    if (upcoming.length > 0) setVenue(upcoming[0].venue);
    fetch("/api/availability")
      .then((r) => r.json())
      .then(setAvailability)
      .catch(() => {});
  }, []);

  const slideImages = [
    "/pizza-bagel.jpeg",
    "/jalapeno-bagel.jpeg",
    "/cheesy-bagel.jpeg",
    "/plain-bagel.jpeg",
  ];
  const [slideIndex, setSlideIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(
      () => setSlideIndex((i) => (i + 1) % slideImages.length),
      3000,
    );
    return () => clearInterval(id);
  }, []);

  const total = Object.entries(quantities).reduce(
    (sum, [item, qty]) => sum + qty * menuPricingObject[item].price,
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
        orderLines += `${item} x${qty} — R${qty * menuPricingObject[item].price}\n`;
    });
    const message = `NEW ORDER — STUFF'D BAGELS\n\nPickup: ${venue}\nName: ${name}\nPhone: ${phone}\n\nOrder:\n${orderLines}\nTotal: R${total}\n\nNotes: ${notes || "None"}\n\nSent via stuffdbagels.co.za`;
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

  const itemCount = Object.values(quantities).reduce((a, b) => a + b, 0);
  const scheduleCards = events.map(eventToCard);
  const uniqueVenues = Array.from(new Set(scheduleCards.map((s) => s.venue)));

  const ordersDisabled =
    availability !== null &&
    (!availability.ordersEnabled || availability.closedToday);

  return (
    <div className="bg-paper min-h-screen text-ink overflow-x-hidden">
      {/* STICKY TICKER */}
      <div
        className="sticky top-0 z-50 overflow-hidden border-b-2 border-ink"
        style={{ background: BLUE }}
      >
        <div aria-hidden="true" className="ticker-track whitespace-nowrap py-2.5 text-white font-black text-xs tracking-widest uppercase">
          {TICKER_TEXT.repeat(6)}
        </div>
      </div>

      {/* ─── HERO ─────────────────────────────────────────── */}
      <header
        className="border-b-2 border-ink relative overflow-hidden"
        style={{ minHeight: "clamp(420px, 62vh, 640px)" }}
      >
        <div className="duotone absolute inset-0">
          <img
            src="/hero-bagel.jpeg"
            alt=""
            className="w-full h-full object-cover object-center"
          />
        </div>
        {/* Soft navy scrim so the cream wordmark stays readable */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to bottom, color-mix(in srgb, var(--sb-ink) 15%, transparent), color-mix(in srgb, var(--sb-ink) 45%, transparent))",
          }}
        />

        <Star className="absolute w-10 h-10 top-8 left-[8%] -rotate-12" />
        <Star className="absolute w-6 h-6 top-24 right-[12%] rotate-12 hidden sm:block" fill="var(--sb-paper)" />
        <Star className="absolute w-14 h-14 bottom-16 right-[7%] rotate-6 hidden lg:block" />

        <div
          className="relative px-5 py-10 max-w-4xl mx-auto flex flex-col items-center justify-center text-center gap-6"
          style={{ minHeight: "clamp(420px, 62vh, 640px)" }}
        >
          <p className="font-black tracking-[0.35em] text-[10px] uppercase text-paper">
            Cape Town's first stuffed bagel
          </p>
          {/* One H1 for "STUFF'D Bagels" so search engines read the full name. */}
          <h1 className="m-0 font-normal text-base">
            <span
              className="block font-bubble wordmark leading-[0.9]"
              style={{ fontSize: "clamp(4.25rem, 19vw, 10rem)" }}
            >
              STUFF'D
            </span>{" "}
            <span className="block font-black tracking-[0.6em] text-sm lg:text-base text-paper uppercase mt-4 pl-[0.6em]">
              Bagels
            </span>
          </h1>
          <p className="font-marker text-paper text-lg lg:text-xl -rotate-2">
            Every bite packed right.
          </p>
          <a
            href="#order"
            className="inline-flex items-center gap-2 rounded-full border-2 border-ink bg-paper text-ink px-7 py-3 font-black uppercase tracking-widest text-sm transition-transform hover:-translate-y-0.5 active:scale-95"
            style={{ boxShadow: "0 4px 0 var(--sb-ink)" }}
          >
            get <span className="font-bubble text-base normal-case tracking-normal">STUFF'D</span>
          </a>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 lg:px-10 py-10">
        <div className="space-y-12">
          {/* ─── 01 WHERE WE AT ──────────────────────────────── */}
          <section>
            <SectionHead n="01" title="Where We At" />

            <p className="font-black text-xs tracking-widest uppercase mb-5">
              More markets, more bagels. Come get STUFF'D here ↓
            </p>

            {scheduleCards.length === 0 && (
              <p className="rounded-2xl border-2 border-ink bg-white px-4 py-4 text-sm font-bold">
                New dates coming soon. Follow{" "}
                <a className="underline" href="https://instagram.com/stuffd.bagels" target="_blank" rel="noopener noreferrer">
                  @stuffd.bagels
                </a>{" "}
                for the next market.
              </p>
            )}

            {/* Mobile: vertical timeline */}
            <div className="lg:hidden relative pl-8">
              {scheduleCards.length > 1 && (
                <div
                  className="absolute left-[25px] top-7 bottom-7 w-[2px]"
                  style={{
                    background:
                      "repeating-linear-gradient(to bottom,var(--sb-ink) 0,var(--sb-ink) 5px,transparent 5px,transparent 12px)",
                  }}
                />
              )}
              {scheduleCards.map((sched, idx) => (
                <div
                  key={sched.id}
                  className="relative flex items-start gap-4 mb-8 last:mb-0"
                  data-testid={`schedule-card-${idx}`}
                >
                  <div className="shrink-0 -ml-8 z-10 mt-1">
                    <BagelPin date={sched.date} active={idx === 0} />
                  </div>
                  <div className="flex-1 rounded-2xl border-2 border-ink overflow-hidden">
                    <div
                      className="px-3 py-2 flex items-center justify-between border-b-2 border-ink text-white"
                      style={{ background: idx === 0 ? BLUE : "var(--sb-ink)" }}
                    >
                      <span className="font-marker text-sm">{sched.day}</span>
                      <span className="font-black text-xs tracking-widest uppercase">
                        {sched.range}
                      </span>
                    </div>
                    <div className="px-3 py-3 bg-white">
                      <div className="font-black text-[10px] tracking-widest uppercase text-ink/75">
                        {sched.name}
                      </div>
                      <div className="font-bold text-sm mt-0.5">{sched.venue}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop: horizontal cards */}
            <div className="hidden lg:flex gap-5 relative">
              {scheduleCards.length > 1 && (
                <div
                  className="absolute top-[26px] left-[27px] right-[27px] h-[2px] z-0"
                  style={{
                    background:
                      "repeating-linear-gradient(to right,var(--sb-ink) 0,var(--sb-ink) 6px,transparent 6px,transparent 14px)",
                  }}
                />
              )}
              {scheduleCards.map((sched, idx) => (
                <div
                  key={sched.id}
                  className="flex-1 flex flex-col items-center gap-3 z-10"
                  data-testid={`schedule-card-${idx}`}
                >
                  <BagelPin date={sched.date} active={idx === 0} />
                  <div className="w-full rounded-2xl border-2 border-ink overflow-hidden">
                    <div
                      className="px-4 py-2.5 flex items-center justify-between border-b-2 border-ink text-white"
                      style={{ background: idx === 0 ? BLUE : "var(--sb-ink)" }}
                    >
                      <span className="font-marker text-base">{sched.day}</span>
                      <span className="font-black text-xs tracking-widest uppercase">
                        {sched.range}
                      </span>
                    </div>
                    <div className="px-4 py-4 bg-white">
                      <div className="font-black text-[10px] tracking-widest uppercase text-ink/75">
                        {sched.name}
                      </div>
                      <div className="font-bold text-sm mt-1">{sched.venue}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ─── 02 ORDER UP + checkout ──────────────────────── */}
          <div className="space-y-8" id="order">
            <section>
              <SectionHead n="02" title="Order Up" />

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {Object.entries(menuPricingObject).map(([item, info]) => (
                  <div
                    key={item}
                    className="rounded-2xl border-2 border-ink flex flex-col overflow-hidden bg-white"
                    data-testid={`menu-item-${item}`}
                  >
                    <div
                      className="relative overflow-hidden border-b-2 border-ink"
                      style={{ aspectRatio: "1/1" }}
                    >
                      <img
                        src={info.image}
                        alt={item}
                        className="w-full h-full object-cover"
                      />
                      {quantities[item] > 0 && (
                        <div
                          className="absolute inset-0 flex items-center justify-center"
                          style={{ background: "color-mix(in srgb, var(--sb-blue) 88%, transparent)" }}
                        >
                          <span
                            className="font-bubble text-white"
                            style={{ fontSize: "3.5rem", lineHeight: 1 }}
                          >
                            {quantities[item]}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col flex-1 p-2.5 gap-2">
                      <div>
                        <div className="font-black uppercase text-xs leading-tight">
                          {item}
                        </div>
                        <div className="text-ink/75 text-[11px] font-medium mt-0.5 leading-snug">
                          {info.desc}
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-auto">
                        <div className="font-bebas text-xl">R{info.price}</div>
                        <div className="flex items-center gap-0.5">
                          <button
                            data-testid={`btn-decrease-${item}`}
                            onClick={() => updateQuantity(item, -1)}
                            aria-label={`Remove one ${item}`}
                            className="w-8 h-8 rounded-full border-2 border-ink font-black text-base flex items-center justify-center active:scale-90 transition-transform bg-white hover:bg-ink hover:text-white"
                          >
                            −
                          </button>
                          <span className="font-black text-sm w-5 text-center tabular-nums">
                            {quantities[item]}
                          </span>
                          <button
                            data-testid={`btn-increase-${item}`}
                            onClick={() => updateQuantity(item, 1)}
                            aria-label={`Add one ${item}`}
                            className="w-8 h-8 rounded-full border-2 text-white font-black text-base flex items-center justify-center active:scale-90 transition-transform"
                            style={{ background: BLUE, borderColor: BLUE_DK }}
                          >
                            +
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-2xl border-2 border-ink bg-ink text-paper p-4 flex items-center justify-between">
                <span className="font-black tracking-widest text-sm uppercase">
                  {itemCount > 0
                    ? `${itemCount} item${itemCount !== 1 ? "s" : ""}`
                    : "Your order"}
                </span>
                <span className="font-bebas text-3xl">R{displayTotal}</span>
              </div>
            </section>

            {/* MASCOT STRIP */}
            <div className="rounded-2xl border-2 border-ink flex items-center overflow-hidden bg-white">
              <img
                src="/mascot.png"
                alt="STUFF'D mascot"
                className="w-28 shrink-0 -mb-1"
              />
              <div className="px-4 py-4">
                <p className="font-bubble text-lg leading-snug">Ready to order?</p>
                <p className="text-ink/70 font-medium text-xs leading-snug mt-1">
                  Fill in your details below and we'll WhatsApp your order
                  straight to the kitchen.
                </p>
              </div>
            </div>

            {/* 03 YOUR DETAILS */}
            <SectionHead n="03" title="Your Details" />

            <div className="lg:flex lg:gap-8 lg:items-start">
              <div className="hidden lg:block lg:w-1/2 shrink-0">
                <img
                  src="/mascot-drop.png"
                  alt="STUFF'D Bagels mascot"
                  className="w-full object-contain"
                />
              </div>

              <section className="lg:w-1/2">
                <div className="rounded-2xl border-2 border-ink divide-y-2 divide-ink bg-white overflow-hidden">
                  {[
                    {
                      label: "Name",
                      type: "text",
                      placeholder: "Your name",
                      value: name,
                      set: setName,
                      id: "input-name",
                    },
                    {
                      label: "Phone",
                      type: "tel",
                      placeholder: "082 123 4567",
                      value: phone,
                      set: setPhone,
                      id: "input-phone",
                    },
                  ].map((f) => (
                    <div key={f.label} className="flex flex-col">
                      <label
                        htmlFor={f.id}
                        className="font-black text-[10px] tracking-widest uppercase px-4 pt-3 pb-1 text-ink/75"
                      >
                        {f.label}
                      </label>
                      <input
                        id={f.id}
                        data-testid={f.id}
                        type={f.type}
                        placeholder={f.placeholder}
                        value={f.value}
                        onChange={(e) => f.set(e.target.value)}
                        className="px-4 pb-3 bg-transparent font-bold text-base outline-none placeholder:text-ink/35"
                      />
                    </div>
                  ))}
                  <div className="flex flex-col">
                    <label
                      htmlFor="select-venue"
                      className="font-black text-[10px] tracking-widest uppercase px-4 pt-3 pb-1 text-ink/75"
                    >
                      Pickup Location
                    </label>
                    <select
                      id="select-venue"
                      data-testid="select-venue"
                      value={venue}
                      onChange={(e) => setVenue(e.target.value)}
                      className="px-4 pb-3 bg-transparent font-bold text-base outline-none appearance-none"
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
                      className="font-black text-[10px] tracking-widest uppercase px-4 pt-3 pb-1 text-ink/75"
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
                      className="px-4 pb-3 bg-transparent font-bold text-base outline-none resize-none placeholder:text-ink/35"
                    />
                  </div>
                </div>

                <p className="text-xs font-medium mt-3 text-ink/70 leading-relaxed px-1">
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
                  className="mt-4 w-full rounded-full text-white border-2 p-4 uppercase tracking-widest transition-transform active:scale-[0.98] font-bebas"
                  style={{
                    fontSize: "1.35rem",
                    letterSpacing: "0.12em",
                    background: ordersDisabled ? "var(--sb-disabled)" : BLUE,
                    borderColor: ordersDisabled ? "var(--sb-disabled-border)" : "var(--sb-ink)",
                    boxShadow: ordersDisabled ? "none" : "0 4px 0 var(--sb-ink)",
                    cursor: ordersDisabled ? "not-allowed" : "pointer",
                    opacity: ordersDisabled ? 0.6 : 1,
                  }}
                >
                  {ordersDisabled ? "Orders Closed" : "Get STUFF'D on WhatsApp"}
                  {!ordersDisabled && total > 0 && (
                    <span className="ml-3 text-white/80 text-base">· R{total}</span>
                  )}
                </button>
              </section>
            </div>
          </div>
        </div>

        {/* ─── 04 ABOUT ── */}
        <section className="mt-12">
          <SectionHead n="04" title="About Us" />
          <div className="rounded-2xl border-2 border-ink overflow-hidden lg:flex lg:flex-row bg-white">
            {/* Slideshow in a cream frame (food stays in real colour) */}
            <div className="lg:w-1/2 shrink-0 p-3 bg-paper border-b-2 lg:border-b-0 lg:border-r-2 border-ink">
              <div
                className="relative overflow-hidden rounded-xl border-2 border-ink"
                style={{ aspectRatio: "16/9" }}
              >
                {slideImages.map((src, i) => (
                  <img
                    key={src}
                    src={src}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover"
                    style={{
                      opacity: i === slideIndex ? 1 : 0,
                      transition: "opacity 0.8s ease-in-out",
                    }}
                  />
                ))}
                <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-2 z-10">
                  {slideImages.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setSlideIndex(i)}
                      className="w-2.5 h-2.5 rounded-full border border-white transition-all"
                      style={{
                        background: i === slideIndex ? "white" : "transparent",
                      }}
                      aria-label={`Slide ${i + 1}`}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="lg:flex lg:flex-col lg:justify-between flex-1">
              <div className="border-b-2 border-ink px-5 py-5" style={{ background: BLUE }}>
                <p className="font-bubble text-white leading-tight text-2xl">
                  Cape Town's first stuffed bagel. Born on the street. Built
                  different.
                </p>
              </div>
              <div className="px-5 py-5 space-y-3 flex-1">
                <p className="font-medium text-sm text-ink leading-relaxed">
                  STUFF'D started with one question: why does Cape Town not have
                  a proper stuffed bagel? We took the classic New York bagel,
                  packed it with bold fillings, and brought it to the streets of
                  the Mother City.
                </p>
                <p className="font-medium text-sm text-ink/75 leading-relaxed">
                  Find the cart at markets and festivals across Cape Town. No
                  tables, no reservations. Just fresh bagels, fast. More
                  markets, more bagels.
                </p>
                <div className="flex gap-2 pt-1 flex-wrap">
                  {["Street Food", "Cape Town", "Markets", "Handmade"].map(
                    (tag) => (
                      <span
                        key={tag}
                        className="rounded-full border-2 border-ink px-3 py-0.5 font-black text-[10px] tracking-widest uppercase"
                      >
                        {tag}
                      </span>
                    ),
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ─── 05 FAQ — chat style, capped width on desktop ──── */}
        <section className="mt-12 lg:max-w-2xl lg:mx-auto">
          <SectionHead n="05" title="Got Questions?" />

          <div
            className="rounded-2xl border-2 border-ink overflow-hidden"
            style={{ background: "var(--sb-chat-bg)" }}
          >
            <div className="flex items-center gap-3 px-4 py-3 border-b-2 border-ink bg-white">
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
                <div className="text-[10px] text-ink/75 font-medium">Chat to us on WhatsApp</div>
              </div>
            </div>

            <div className="px-3 py-4 space-y-5">
              {FAQ.map((msg, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="text-center text-[10px] text-ink/75 font-medium">
                    {msg.time}
                  </div>
                  <div className="flex items-end gap-2">
                    <div className="w-6 h-6 rounded-full bg-chat-avatar border border-ink/10 shrink-0 flex items-center justify-center mb-0.5">
                      <span className="text-[8px] font-black text-chat-avatar-ink">
                        YOU
                      </span>
                    </div>
                    <div
                      className="max-w-[72%] px-3 py-2 text-sm font-medium text-ink leading-snug"
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
                      className="max-w-[72%] px-3 py-2 text-sm font-medium text-white leading-snug"
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
                      className="w-2 h-2 rounded-full bg-chat-gray"
                      style={{ animation: `bounce 1.2s ${delay}s infinite` }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* FOOTER — full width */}
      <footer className="border-t-2 border-ink bg-ink text-paper relative overflow-hidden">
        <div className="max-w-6xl mx-auto px-6 lg:px-10 py-12 grid grid-cols-1 sm:grid-cols-3 gap-10 items-center">
          <div className="flex flex-col items-center sm:items-start gap-2">
            <div className="font-bubble text-5xl leading-none text-paper">STUFF'D</div>
            <div className="font-black tracking-[0.6em] text-xs uppercase text-paper/80">Bagels</div>
            <p className="font-marker text-highlight text-base mt-2">
              When hunger calls, it&apos;s time to get STUFF&apos;D.
            </p>
          </div>

          <div className="flex flex-col items-center sm:items-start gap-3">
            <div className="font-black text-xs tracking-widest uppercase mb-1 text-highlight">
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
            <div className="font-black text-xs tracking-widest uppercase mb-1 text-highlight">
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
