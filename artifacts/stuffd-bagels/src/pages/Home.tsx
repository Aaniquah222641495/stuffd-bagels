import { useState, useEffect } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { menuPricingObject, FAQ } from "@/content";

const BUSINESS_PHONE = "27724111011";

interface ScheduleEvent {
  id: string;
  eventDate: string;
  hours: string;
  venue: string;
  subtitle: string;
}

function eventToCard(e: ScheduleEvent) {
  const d = new Date(e.eventDate + "T00:00:00");
  return {
    id: e.id,
    day: d.toLocaleDateString("en-ZA", { weekday: "long" }),
    date: String(d.getDate()),
    subtitle: e.subtitle,
    hours: e.hours,
    venue: e.venue,
  };
}


const TICKER_TEXT =
  "STUFF'D BAGELS · CAPE TOWN'S FIRST STUFFED BAGEL · EVERY BITE PACKED RIGHT · ORDER ON WHATSAPP · ";

const ACCENT = "var(--sb-highlight)";
const ACCENT_DK = "var(--sb-highlight-dk)";

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
        alt="bagel location pin"
        width={108}
        height={108}
        decoding="async"
        className="w-full h-full object-contain"
        style={{
          filter: active
            ? "drop-shadow(0 2px 8px rgba(200,144,15,0.7))"
            : "grayscale(0.3) brightness(0.88)",
        }}
      />
      {/* Date in the hole */}
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{ paddingBottom: "2px" }}
      >
        <span
          className="font-black text-white leading-none"
          style={{
            fontFamily: "'Bebas Neue', sans-serif",
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
  const heroImages = Object.values(menuPricingObject).map((v) => v.image);

  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(Object.keys(menuPricingObject).map((k) => [k, 0])),
  );
  const [scheduleEvents, setScheduleEvents] = useState<ScheduleEvent[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [venue, setVenue] = useState("");
  const [notes, setNotes] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [displayTotal, setDisplayTotal] = useState(0);
  const [availability, setAvailability] = useState<{
    ordersEnabled: boolean;
    closedToday: boolean;
    closedMessage: string;
  } | null>(null);

  useEffect(() => {
    fetch("/api/availability")
      .then((r) => r.json())
      .then(setAvailability)
      .catch(() => {});
    fetch("/api/events")
      .then((r) => r.json())
      .then((rows: ScheduleEvent[]) => {
        setScheduleEvents(rows);
        if (rows.length > 0) setVenue(rows[0].venue);
      })
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
  const scheduleCards = scheduleEvents.map(eventToCard);
  const uniqueVenues = Array.from(new Set(scheduleCards.map((s) => s.venue)));

  const ordersDisabled =
    availability !== null &&
    (!availability.ordersEnabled || availability.closedToday);

  return (
    <div
      className="bg-paper min-h-screen text-ink overflow-x-hidden"
      style={{ "--accent": ACCENT } as React.CSSProperties}
    >
      {/* STICKY TICKER */}
      <div
        className="sticky top-0 z-50 overflow-hidden border-b-2 border-ink"
        style={{ background: ACCENT }}
      >
        <div className="ticker-track whitespace-nowrap py-2.5 text-ink font-black text-xs tracking-widest uppercase">
          {TICKER_TEXT.repeat(6)}
        </div>
      </div>

      {/* ─── HERO ─────────────────────────────────────────── */}
      <header
        className="border-b-2 border-ink relative overflow-hidden"
        style={{ minHeight: "clamp(320px, 45vh, 560px)" }}
      >
        {/* Full-bleed background photo */}
        <img
          src="/hero-bagel.jpeg"
          alt=""
          className="absolute inset-0 w-full h-full object-cover object-center"
        />
        {/* Light overlay so black text stays readable over the photo */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to bottom, rgba(251,251,249,0.30) 0%, rgba(251,251,249,0.55) 50%, rgba(251,251,249,0.78) 100%)",
          }}
        />

        {/* Wordmark overlaid */}
        <div
          className="relative px-5 pt-8 pb-8 max-w-4xl mx-auto flex flex-col items-center justify-between text-center"
          style={{ minHeight: "clamp(320px, 45vh, 560px)" }}
        >
          <p className="font-black tracking-[0.35em] text-[10px] uppercase text-ink/60 mb-1">
            Cape Town · Est. 2026
          </p>
          <div className="w-full">
            {/* One H1 for "STUFF'D Bagels" so search engines read the full name (same look as before). */}
            <h1 className="m-0 font-normal text-base">
              <span
                className="block leading-none tracking-tighter text-ink"
                style={{
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: "clamp(5rem,22vw,9rem)",
                  textShadow: "0 1px 0 rgba(255,255,255,0.15)",
                }}
              >
                STUFF'D
              </span>{" "}
              <span className="flex items-center gap-2 mt-1">
                <span aria-hidden="true" className="flex-1 h-[2px] bg-ink" />
                <span className="font-black tracking-[0.35em] text-[10px] text-ink uppercase leading-normal">
                  Bagels
                </span>
                <span aria-hidden="true" className="flex-1 h-[2px] bg-ink" />
              </span>
            </h1>
            <p className="font-black tracking-widest text-[10px] uppercase text-ink/70 mt-3">
              Every bite packed right.
            </p>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 lg:px-10 py-8">
        <div className="space-y-10">
          {/* ─── 01 WHERE WE AT ──────────────────────────────── */}
          <section>
            <div className="flex items-center gap-3 mb-6">
              <span
                className="font-black tracking-widest uppercase text-xs"
              >
                01
              </span>
              <h2 className="font-black tracking-widest uppercase text-base text-ink">
                Where We At
              </h2>
              <div className="flex-1 h-[2px] bg-ink" />
            </div>

            <p
              className="font-black text-xs tracking-widest uppercase mb-5"
            >
              This week — come get STUFF'D here ↓
            </p>

            {/* Mobile: vertical timeline */}
            <div className="lg:hidden relative pl-8">
              <div
                className="absolute left-[25px] top-7 bottom-7 w-[2px]"
                style={{
                  background:
                    "repeating-linear-gradient(to bottom,var(--sb-ink) 0,var(--sb-ink) 5px,transparent 5px,transparent 12px)",
                }}
              />
              {scheduleCards.map((sched, idx) => (
                <div
                  key={sched.id}
                  className="relative flex items-start gap-4 mb-8 last:mb-0"
                  data-testid={`schedule-card-${idx}`}
                >
                  <div className="shrink-0 -ml-8 z-10 mt-1">
                    <BagelPin date={sched.date} active={idx === 0} />
                  </div>
                  <div className="flex-1 border-2 border-ink overflow-hidden">
                    <div
                      className="px-3 py-2 flex items-center justify-between border-b-2 border-ink"
                      style={{ background: idx === 0 ? ACCENT : "var(--sb-ink)" }}
                    >
                      <span
                        style={{ fontFamily: "'Permanent Marker', cursive" }}
                        className={idx === 0 ? "text-ink text-sm" : "text-white text-sm"}
                      >
                        {sched.day}
                      </span>
                      <span className={`font-black text-xs tracking-widest uppercase ${idx === 0 ? "text-ink" : "text-white"}`}>
                        {sched.hours}
                      </span>
                    </div>
                    <div className="px-3 py-3 bg-paper">
                      <div className="font-black text-[10px] tracking-widest uppercase text-ink/40">
                        {sched.subtitle}
                      </div>
                      <div className="font-bold text-sm mt-0.5">
                        {sched.venue}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop: horizontal cards */}
            <div className="hidden lg:flex gap-5 relative">
              {/* Dashed connector line through pin centres */}
              <div
                className="absolute top-[26px] left-[27px] right-[27px] h-[2px] z-0"
                style={{
                  background:
                    "repeating-linear-gradient(to right,var(--sb-ink) 0,var(--sb-ink) 6px,transparent 6px,transparent 14px)",
                }}
              />
              {scheduleCards.map((sched, idx) => (
                <div
                  key={sched.id}
                  className="flex-1 flex flex-col items-center gap-3 z-10"
                  data-testid={`schedule-card-${idx}`}
                >
                  <BagelPin date={sched.date} active={idx === 0} />
                  <div className="w-full border-2 border-ink overflow-hidden">
                    <div
                      className="px-4 py-2.5 flex items-center justify-between border-b-2 border-ink"
                      style={{ background: idx === 0 ? ACCENT : "var(--sb-ink)" }}
                    >
                      <span
                        style={{ fontFamily: "'Permanent Marker', cursive" }}
                        className={idx === 0 ? "text-ink text-base" : "text-white text-base"}
                      >
                        {sched.day}
                      </span>
                      <span className={`font-black text-xs tracking-widest uppercase ${idx === 0 ? "text-ink" : "text-white"}`}>
                        {sched.hours}
                      </span>
                    </div>
                    <div className="px-4 py-4 bg-paper">
                      <div className="font-black text-[10px] tracking-widest uppercase text-ink/40">
                        {sched.subtitle}
                      </div>
                      <div className="font-bold text-sm mt-1">
                        {sched.venue}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ─── 02 ORDER UP + checkout ──────────────────────── */}
          <div className="space-y-8">
            <section>
              <div className="flex items-center gap-3 mb-5">
                <span
                  className="font-black tracking-widest uppercase text-xs"
                >
                  02
                </span>
                <h2 className="font-black tracking-widest uppercase text-base text-ink">
                  Order Up
                </h2>
                <div className="flex-1 h-[2px] bg-ink" />
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {Object.entries(menuPricingObject).map(([item, info]) => (
                  <div
                    key={item}
                    className="border-2 border-ink flex flex-col overflow-hidden bg-paper"
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
                          style={{ background: "color-mix(in srgb, var(--sb-highlight) 93%, transparent)" }}
                        >
                          <span
                            className="text-ink font-black"
                            style={{
                              fontFamily: "'Bebas Neue', sans-serif",
                              fontSize: "3.5rem",
                              lineHeight: 1,
                            }}
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
                        <div className="text-ink/45 text-[10px] font-medium mt-0.5 leading-snug">
                          {info.desc}
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-auto">
                        <div
                          className="font-black text-lg"
                          style={{ fontFamily: "'Bebas Neue', sans-serif" }}
                        >
                          R{info.price}
                        </div>
                        <div className="flex items-center gap-0.5">
                          <button
                            data-testid={`btn-decrease-${item}`}
                            onClick={() => updateQuantity(item, -1)}
                            className="w-8 h-8 border-2 border-ink font-black text-base flex items-center justify-center active:scale-90 transition-transform bg-paper hover:bg-ink hover:text-white"
                          >
                            −
                          </button>
                          <span className="font-black text-sm w-5 text-center tabular-nums">
                            {quantities[item]}
                          </span>
                          <button
                            data-testid={`btn-increase-${item}`}
                            onClick={() => updateQuantity(item, 1)}
                            className="w-8 h-8 border-2 text-ink font-black text-base flex items-center justify-center active:scale-90 transition-transform"
                            style={{
                              background: ACCENT,
                              borderColor: ACCENT_DK,
                            }}
                          >
                            +
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 border-2 border-ink bg-ink text-paper p-4 flex items-center justify-between">
                <span className="font-black tracking-widest text-sm uppercase">
                  {itemCount > 0
                    ? `${itemCount} item${itemCount !== 1 ? "s" : ""}`
                    : "Your order"}
                </span>
                <span
                  className="font-black text-2xl"
                  style={{ fontFamily: "'Bebas Neue', sans-serif" }}
                >
                  R{displayTotal}
                </span>
              </div>
            </section>

            {/* MASCOT STRIP */}
            <div className="border-2 border-ink flex items-center overflow-hidden bg-white">
              <img
                src="/mascot.png"
                alt="STUFF'D mascot"
                className="w-28 shrink-0 -mb-1"
              />
              <div className="px-4 py-4">
                <p
                  className="font-black tracking-widest text-xs uppercase leading-snug"
                >
                  Ready to order?
                </p>
                <p className="text-ink/60 font-medium text-xs leading-snug mt-1">
                  Fill in your details below and we'll WhatsApp your order
                  straight to the kitchen.
                </p>
              </div>
            </div>

            {/* 03 YOUR DETAILS */}
            <div className="flex items-center gap-3 mb-5">
              <span
                className="font-black tracking-widest uppercase text-xs"
              >
                03
              </span>
              <h2 className="font-black tracking-widest uppercase text-base text-ink">
                Your Details
              </h2>
              <div className="flex-1 h-[2px] bg-ink" />
            </div>

            <div className="lg:flex lg:gap-8 lg:items-start">
              {/* Mascot image — desktop only */}
              <div className="hidden lg:block lg:w-1/2 shrink-0">
                <img
                  src="/mascot-drop.png"
                  alt="STUFF'D Bagels mascot"
                  className="w-full object-contain"
                />
              </div>

              <section className="lg:w-1/2">
                <div className="border-2 border-ink divide-y-2 divide-ink">
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
                      <label className="font-black text-[10px] tracking-widest uppercase px-4 pt-3 pb-1 text-ink/40">
                        {f.label}
                      </label>
                      <input
                        data-testid={f.id}
                        type={f.type}
                        placeholder={f.placeholder}
                        value={f.value}
                        onChange={(e) => f.set(e.target.value)}
                        className="px-4 pb-3 bg-transparent font-bold text-base outline-none placeholder:text-ink/25"
                      />
                    </div>
                  ))}
                  <div className="flex flex-col">
                    <label className="font-black text-[10px] tracking-widest uppercase px-4 pt-3 pb-1 text-ink/40">
                      Pickup Location
                    </label>
                    <select
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
                    <label className="font-black text-[10px] tracking-widest uppercase px-4 pt-3 pb-1 text-ink/40">
                      Notes
                    </label>
                    <textarea
                      data-testid="textarea-notes"
                      placeholder="Any special requests?"
                      rows={2}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="px-4 pb-3 bg-transparent font-bold text-base outline-none resize-none placeholder:text-ink/25"
                    />
                  </div>
                </div>

                <p className="text-xs font-medium mt-3 text-ink/50 leading-relaxed px-1">
                  No payment online. Swipe your card (Yoco) or pay cash at the
                  truck upon collection.
                </p>

                {ordersDisabled && (
                  <p className="mt-4 border-2 border-ink px-4 py-3 text-sm font-bold text-center tracking-wide uppercase bg-ink text-paper">
                    {availability?.closedMessage || "Orders closed for today — see you next time!"}
                  </p>
                )}
                <button
                  data-testid="btn-place-order"
                  onClick={() => !ordersDisabled && setShowModal(true)}
                  disabled={ordersDisabled}
                  className="mt-4 w-full text-ink border-2 p-4 font-black uppercase tracking-widest transition-transform"
                  style={{
                    fontFamily: "'Bebas Neue', sans-serif",
                    fontSize: "1.25rem",
                    letterSpacing: "0.15em",
                    background: ordersDisabled ? "var(--sb-disabled)" : ACCENT,
                    borderColor: ordersDisabled ? "var(--sb-disabled-border)" : ACCENT_DK,
                    cursor: ordersDisabled ? "not-allowed" : "pointer",
                    opacity: ordersDisabled ? 0.6 : 1,
                  }}
                >
                  {ordersDisabled ? "Orders Closed" : "Place WhatsApp Order"}
                  {!ordersDisabled && total > 0 && (
                    <span className="ml-3 text-ink/60 text-sm font-black">
                      · R{total}
                    </span>
                  )}
                </button>
              </section>
            </div>
          </div>
        </div>
        {/* end desktop 2-col */}

        {/* ─── 04 ABOUT — full-bleed on mobile, side-by-side on desktop ── */}
        <section className="-mx-4 lg:mx-0 mt-10">
          <div className="flex items-center gap-3 mb-5 px-4 lg:px-0">
            <span
              className="font-black tracking-widest uppercase text-xs"
            >
              04
            </span>
            <h2 className="font-black tracking-widest uppercase text-base text-ink">
              About Us
            </h2>
            <div className="flex-1 h-[2px] bg-ink" />
          </div>
          <div className="border-t-2 border-b-2 lg:border-2 border-ink overflow-hidden lg:flex lg:flex-row">
            {/* Slideshow — left half on desktop */}
            <div
              className="relative overflow-hidden border-b-2 lg:border-b-0 lg:border-r-2 border-ink lg:w-1/2 shrink-0"
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
                    zIndex: i === slideIndex ? 1 : 0,
                  }}
                />
              ))}
              <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-2 z-10">
                {slideImages.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setSlideIndex(i)}
                    className="w-2 h-2 border border-white transition-all"
                    style={{
                      background: i === slideIndex ? "white" : "transparent",
                    }}
                    aria-label={`Slide ${i + 1}`}
                  />
                ))}
              </div>
            </div>
            {/* Text — right half on desktop */}
            <div className="lg:flex lg:flex-col lg:justify-between">
              <div className="border-b-2 border-ink px-5 py-4 bg-ink">
                <p
                  className="font-black text-white leading-snug"
                  style={{
                    fontFamily: "'Bebas Neue', sans-serif",
                    fontSize: "1.5rem",
                  }}
                >
                  Cape Town's first stuffed bagel. Born on the street. Built
                  different.
                </p>
              </div>
              <div className="px-5 py-4 space-y-3 bg-paper flex-1">
                <p className="font-medium text-sm text-ink leading-relaxed">
                  STUFF'D started with one question: why does Cape Town not have
                  a proper stuffed bagel? We took the classic New York bagel,
                  packed it with bold fillings, and brought it to the streets of
                  the Mother City.
                </p>
                <p className="font-medium text-sm text-ink/60 leading-relaxed">
                  We pop up at markets, events, and cricket grounds across Cape
                  Town every weekend. No tables, no reservations — just fresh
                  bagels, fast.
                </p>
                <div className="flex gap-2 pt-1 flex-wrap">
                  {["Street Food", "Cape Town", "Pop-Up", "Handmade"].map(
                    (tag) => (
                      <span
                        key={tag}
                        className="border-2 border-ink px-2 py-0.5 font-black text-[10px] tracking-widest uppercase"
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

        {/* ─── 05 FAQ — iMessage, capped width on desktop ──── */}
        <section className="mt-10 lg:max-w-2xl lg:mx-auto">
          <div className="flex items-center gap-3 mb-5">
            <span
              className="font-black tracking-widest uppercase text-xs"
            >
              05
            </span>
            <h2 className="font-black tracking-widest uppercase text-base text-ink">
              Got Questions?
            </h2>
            <div className="flex-1 h-[2px] bg-ink" />
          </div>

          <div
            className="border-2 border-ink overflow-hidden"
            style={{ background: "var(--sb-chat-bg)" }}
          >
            <div className="flex items-center gap-3 px-4 py-3 border-b-2 border-ink bg-white">
              <div className="relative">
                <div
                  className="w-9 h-9 rounded-full border-2 border-ink overflow-hidden flex items-center justify-center"
                  style={{ background: ACCENT }}
                >
                  <span
                    className="text-ink font-black text-xs"
                    style={{ fontFamily: "'Bebas Neue', sans-serif" }}
                  >
                    S'D
                  </span>
                </div>
                <div className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-chat-green border border-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-black text-sm text-ink">
                  STUFF'D Bagels
                </div>
                <div className="text-[10px] text-chat-green font-medium">
                  Active now
                </div>
              </div>
              <div className="flex items-end gap-[2px] opacity-40">
                {[3, 5, 7, 9].map((h) => (
                  <div
                    key={h}
                    className="w-[3px] bg-ink rounded-sm"
                    style={{ height: h }}
                  />
                ))}
              </div>
            </div>

            <div className="px-3 py-4 space-y-5">
              {FAQ.map((msg, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="text-center text-[10px] text-chat-gray font-medium">
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
                        background: "var(--sb-chat-blue)",
                        borderRadius: "18px 18px 4px 18px",
                        boxShadow: "0 1px 2px rgba(0,122,255,0.3)",
                      }}
                    >
                      {msg.a}
                    </div>
                  </div>
                </div>
              ))}

              <div className="flex items-end gap-2">
                <div
                  className="w-6 h-6 rounded-full shrink-0 overflow-hidden border border-ink/10"
                  style={{ background: ACCENT }}
                >
                  <span
                    className="flex items-center justify-center h-full text-[7px] font-black text-ink"
                    style={{ fontFamily: "'Bebas Neue', sans-serif" }}
                  >
                    S'D
                  </span>
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
      </div>

      {/* FOOTER — full width */}
      <footer className="border-t-2 border-ink bg-ink text-paper">
        {/* Main footer body */}
        <div className="max-w-6xl mx-auto px-6 lg:px-10 py-12 grid grid-cols-1 sm:grid-cols-3 gap-10 items-center">
          {/* Logo block */}
          <div className="flex flex-col items-center sm:items-start gap-3">
            <img
              src="/logo.png"
              alt="Stuff'd Bagels logo"
              className="h-32 w-32 object-contain invert"
            />
            <p className="text-paper/50 text-xs tracking-widest uppercase font-medium leading-relaxed">
              Every bite packed right.
            </p>
          </div>

          {/* Contact */}
          <div className="flex flex-col items-center sm:items-start gap-3">
            <div
              className="font-black text-xs tracking-widest uppercase mb-1"
              style={{ color: "var(--sb-highlight)" }}
            >
              Get In Touch
            </div>
            <a
              href="tel:+27724111011"
              className="text-paper/70 hover:text-white text-sm transition-colors"
            >
              +27 72 411 1011
            </a>
            <a
              href="mailto:stuffd.bagels@gmail.com"
              className="text-paper/70 hover:text-white text-sm transition-colors"
            >
              stuffd.bagels@gmail.com
            </a>
            <div className="text-paper/40 text-xs mt-1">
              Cape Town, South Africa 🇿🇦
            </div>
          </div>

          {/* Socials */}
          <div className="flex flex-col items-center sm:items-start gap-3">
            <div
              className="font-black text-xs tracking-widest uppercase mb-1"
              style={{ color: "var(--sb-highlight)" }}
            >
              Follow Us
            </div>
            <a
              href="https://instagram.com/stuffd.bagels"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-paper/70 hover:text-white text-sm transition-colors"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
              </svg>
              @stuffd.bagels
            </a>
            <a
              href="https://tiktok.com/@stuffd.bagels"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-paper/70 hover:text-white text-sm transition-colors"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.18 8.18 0 004.78 1.52V6.76a4.85 4.85 0 01-1.01-.07z" />
              </svg>
              @stuffd.bagels
            </a>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="border-t border-paper/10 py-4 px-6 lg:px-10 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="text-paper/30 text-xs tracking-widest uppercase">
            © 2026 Stuff'd Bagels · Cape Town
          </div>
          <div className="flex gap-1.5">
            <div className="w-2 h-2" style={{ background: "var(--sb-highlight)" }} />
            <div className="w-2 h-2 bg-paper/20" />
            <div className="w-2 h-2 bg-paper/10" />
          </div>
        </div>
      </footer>

      {/* MODAL */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="border-2 border-ink rounded-none bg-paper max-w-[92vw] w-[400px] p-0 overflow-hidden">
          <div
            className="p-5 border-b-2 border-ink"
            style={{ background: ACCENT }}
          >
            <DialogHeader>
              <DialogTitle
                className="font-black uppercase tracking-wide text-ink leading-tight"
                style={{
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: "1.5rem",
                }}
              >
                Awesome! Handing over to WhatsApp...
              </DialogTitle>
            </DialogHeader>
          </div>
          <div className="p-5">
            <DialogDescription className="font-medium text-sm text-ink/70 leading-relaxed">
              We've built your order message for you. When WhatsApp opens, hit{" "}
              <strong className="text-ink">Send</strong> to log your order
              with our kitchen.
            </DialogDescription>
            {total > 0 && (
              <div className="mt-4 border-2 border-ink p-3 bg-ink text-paper flex justify-between items-center">
                <span className="font-black text-xs tracking-widest uppercase">
                  Order Total
                </span>
                <span
                  className="font-black text-xl"
                  style={{ fontFamily: "'Bebas Neue', sans-serif" }}
                >
                  R{total}
                </span>
              </div>
            )}
            <button
              data-testid="btn-whatsapp-send"
              onClick={handleWhatsAppRedirect}
              className="mt-4 w-full text-ink border-2 p-4 font-black uppercase tracking-widest active:scale-[0.98] transition-transform"
              style={{
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: "1.1rem",
                background: ACCENT,
                borderColor: ACCENT_DK,
              }}
            >
              Open WhatsApp & Send
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
