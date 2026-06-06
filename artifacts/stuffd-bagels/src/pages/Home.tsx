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

const BUSINESS_PHONE = "27724111011";

const scheduleArray = [
  { day: "Saturday", date: "14", subtitle: "JUNE 14TH–15TH", hours: "10AM – 9PM", venue: "Newlands Cricket Ground" },
  { day: "Sunday",   date: "15", subtitle: "JUNE 15TH",      hours: "11AM – 7PM", venue: "Newlands Cricket Ground" },
  { day: "Saturday", date: "21", subtitle: "JUNE 21ST–22ND", hours: "10AM – 9PM", venue: "Green Point Urban Park" },
];

const menuPricingObject: Record<string, { price: number; image: string; desc: string }> = {
  "Pizza Bagel":    { price: 75, image: "/pizza-bagel.jpeg", desc: "Tomato · Mozz · Basil" },
  "Jalapeno Bagel": { price: 70, image: "/jalapeno-bagel.jpeg", desc: "Spicy · Cream Cheese · Pickled" },
  "Cheesy Bagel":   { price: 65, image: "/cheesy-bagel.jpeg", desc: "Triple Cheese · Chive" },
  "Plain Bagel":    { price: 45, image: "/plain-bagel.jpeg", desc: "Classic · Butter · Sea Salt" },
};

const TICKER_TEXT = "STUFF'D BAGELS · CAPE TOWN'S FIRST STUFFED BAGEL · EVERY BITE PACKED RIGHT · ORDER ON WHATSAPP · ";

// Golden baked-bagel colour
const ACCENT    = "#C8900F";
const ACCENT_DK = "#A06808";

function BagelPin({ date, active = false }: { date: string; active?: boolean }) {
  return (
    <div className="relative" style={{ width: 54, height: 54 }}>
      <img
        src="/bagel-pin.png"
        alt="bagel location pin"
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
  const uniqueVenues = Array.from(new Set(scheduleArray.map(s => s.venue)));
  const heroImages = Object.values(menuPricingObject).map(v => v.image);

  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(Object.keys(menuPricingObject).map(k => [k, 0]))
  );
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [venue, setVenue] = useState(uniqueVenues[0] || "");
  const [notes, setNotes] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [displayTotal, setDisplayTotal] = useState(0);
  const slideImages = ["/pizza-bagel.jpeg", "/jalapeno-bagel.jpeg", "/cheesy-bagel.jpeg", "/plain-bagel.jpeg"];
  const [slideIndex, setSlideIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setSlideIndex(i => (i + 1) % slideImages.length), 3000);
    return () => clearInterval(id);
  }, []);

  const total = Object.entries(quantities).reduce(
    (sum, [item, qty]) => sum + qty * menuPricingObject[item].price, 0
  );

  useEffect(() => {
    const diff = total - displayTotal;
    if (diff === 0) return;
    const step = diff > 0 ? Math.max(5, Math.ceil(diff / 4)) : Math.min(-5, Math.floor(diff / 4));
    const t = setTimeout(() => setDisplayTotal(prev => {
      const next = prev + step;
      return (step > 0 && next >= total) || (step < 0 && next <= total) ? total : next;
    }), 30);
    return () => clearTimeout(t);
  }, [total, displayTotal]);

  const handleWhatsAppRedirect = () => {
    let orderLines = "";
    Object.entries(quantities).forEach(([item, qty]) => {
      if (qty > 0) orderLines += `${item} x${qty} — R${qty * menuPricingObject[item].price}\n`;
    });
    const message = `NEW ORDER — STUFF'D BAGELS\n\nPickup: ${venue}\nName: ${name}\nPhone: ${phone}\n\nOrder:\n${orderLines}\nTotal: R${total}\n\nNotes: ${notes || "None"}\n\nSent via stuffdbagels.co.za`;
    window.open(`https://wa.me/${BUSINESS_PHONE}?text=${encodeURIComponent(message)}`, "_blank");
    setShowModal(false);
  };

  const updateQuantity = (item: string, delta: number) => {
    setQuantities(prev => ({ ...prev, [item]: Math.max(0, prev[item] + delta) }));
  };

  const itemCount = Object.values(quantities).reduce((a, b) => a + b, 0);

  return (
    <div className="bg-[#FBFBF9] min-h-screen text-[#1A1A1A] overflow-x-hidden" style={{ "--accent": ACCENT } as React.CSSProperties}>

      {/* STICKY TICKER */}
      <div className="sticky top-0 z-50 overflow-hidden border-b-2 border-[#1A1A1A]" style={{ background: ACCENT }}>
        <div className="ticker-track whitespace-nowrap py-2.5 text-white font-black text-xs tracking-widest uppercase">
          {TICKER_TEXT.repeat(6)}
        </div>
      </div>

      {/* ─── HERO ─────────────────────────────────────────── */}
      <header className="border-b-2 border-[#1A1A1A] relative overflow-hidden" style={{ minHeight: "clamp(320px, 45vh, 560px)" }}>
        {/* Full-bleed background photo */}
        <img
          src="/hero-bagel.jpeg"
          alt=""
          className="absolute inset-0 w-full h-full object-cover object-center"
        />
        {/* Light overlay so black text stays readable over the photo */}
        <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, rgba(251,251,249,0.30) 0%, rgba(251,251,249,0.55) 50%, rgba(251,251,249,0.78) 100%)" }} />

        {/* Wordmark overlaid */}
        <div className="relative px-5 pt-8 pb-8 max-w-4xl mx-auto flex flex-col items-center justify-between text-center" style={{ minHeight: "clamp(320px, 45vh, 560px)" }}>
          <p className="font-black tracking-[0.35em] text-[10px] uppercase text-[#1A1A1A]/60 mb-1">Cape Town · Est. 2024</p>
          <div className="w-full">
            <h1
              className="leading-none tracking-tighter text-[#1A1A1A] m-0"
              style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "clamp(5rem,22vw,9rem)", textShadow: "0 1px 0 rgba(255,255,255,0.15)" }}
            >
              STUFF'D
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <div className="flex-1 h-[2px] bg-[#1A1A1A]" />
              <span className="font-black tracking-[0.35em] text-[10px] text-[#1A1A1A] uppercase">Bagels</span>
              <div className="flex-1 h-[2px] bg-[#1A1A1A]" />
            </div>
            <p className="font-black tracking-widest text-[10px] uppercase text-[#1A1A1A]/70 mt-3">
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
              <span className="font-black tracking-widest uppercase text-xs" style={{ color: ACCENT }}>01</span>
              <h2 className="font-black tracking-widest uppercase text-base text-[#1A1A1A]">Where We At</h2>
              <div className="flex-1 h-[2px] bg-[#1A1A1A]" />
            </div>

            <p className="font-black text-xs tracking-widest uppercase mb-5" style={{ color: ACCENT }}>
              This week — come get STUFF'D here ↓
            </p>

            {/* Mobile: vertical timeline */}
            <div className="lg:hidden relative pl-8">
              <div className="absolute left-[25px] top-7 bottom-7 w-[2px]"
                style={{ background: "repeating-linear-gradient(to bottom,#1A1A1A 0,#1A1A1A 5px,transparent 5px,transparent 12px)" }} />
              {scheduleArray.map((sched, idx) => (
                <div key={idx} className="relative flex items-start gap-4 mb-8 last:mb-0" data-testid={`schedule-card-${idx}`}>
                  <div className="shrink-0 -ml-8 z-10 mt-1"><BagelPin date={sched.date} active={idx === 0} /></div>
                  <div className="flex-1 border-2 border-[#1A1A1A] overflow-hidden">
                    <div className="px-3 py-2 flex items-center justify-between border-b-2 border-[#1A1A1A]"
                      style={{ background: idx === 0 ? ACCENT : "#1A1A1A" }}>
                      <span style={{ fontFamily: "'Permanent Marker', cursive" }} className="text-white text-sm">{sched.day}</span>
                      <span className="font-black text-white text-xs tracking-widest uppercase">{sched.hours}</span>
                    </div>
                    <div className="px-3 py-3 bg-[#FBFBF9]">
                      <div className="font-black text-[10px] tracking-widest uppercase text-[#1A1A1A]/40">{sched.subtitle}</div>
                      <div className="font-bold text-sm mt-0.5">{sched.venue}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop: horizontal cards */}
            <div className="hidden lg:flex gap-5 relative">
              {/* Dashed connector line through pin centres */}
              <div className="absolute top-[26px] left-[27px] right-[27px] h-[2px] z-0"
                style={{ background: "repeating-linear-gradient(to right,#1A1A1A 0,#1A1A1A 6px,transparent 6px,transparent 14px)" }} />
              {scheduleArray.map((sched, idx) => (
                <div key={idx} className="flex-1 flex flex-col items-center gap-3 z-10" data-testid={`schedule-card-${idx}`}>
                  <BagelPin date={sched.date} active={idx === 0} />
                  <div className="w-full border-2 border-[#1A1A1A] overflow-hidden">
                    <div className="px-4 py-2.5 flex items-center justify-between border-b-2 border-[#1A1A1A]"
                      style={{ background: idx === 0 ? ACCENT : "#1A1A1A" }}>
                      <span style={{ fontFamily: "'Permanent Marker', cursive" }} className="text-white text-base">{sched.day}</span>
                      <span className="font-black text-white text-xs tracking-widest uppercase">{sched.hours}</span>
                    </div>
                    <div className="px-4 py-4 bg-[#FBFBF9]">
                      <div className="font-black text-[10px] tracking-widest uppercase text-[#1A1A1A]/40">{sched.subtitle}</div>
                      <div className="font-bold text-sm mt-1">{sched.venue}</div>
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
                <span className="font-black tracking-widest uppercase text-xs" style={{ color: ACCENT }}>02</span>
                <h2 className="font-black tracking-widest uppercase text-base text-[#1A1A1A]">Order Up</h2>
                <div className="flex-1 h-[2px] bg-[#1A1A1A]" />
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {Object.entries(menuPricingObject).map(([item, info]) => (
                  <div key={item} className="border-2 border-[#1A1A1A] flex flex-col overflow-hidden bg-[#FBFBF9]" data-testid={`menu-item-${item}`}>
                    <div className="relative overflow-hidden border-b-2 border-[#1A1A1A]" style={{ aspectRatio: "1/1" }}>
                      <img src={info.image} alt={item} className="w-full h-full object-cover" />
                      {quantities[item] > 0 && (
                        <div className="absolute inset-0 flex items-center justify-center" style={{ background: `${ACCENT}ee` }}>
                          <span className="text-white font-black" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "3.5rem", lineHeight: 1 }}>
                            {quantities[item]}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col flex-1 p-2.5 gap-2">
                      <div>
                        <div className="font-black uppercase text-xs leading-tight">{item}</div>
                        <div className="text-[#1A1A1A]/45 text-[10px] font-medium mt-0.5 leading-snug">{info.desc}</div>
                      </div>
                      <div className="flex items-center justify-between mt-auto">
                        <div className="font-black text-lg" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>R{info.price}</div>
                        <div className="flex items-center gap-0.5">
                          <button
                            data-testid={`btn-decrease-${item}`}
                            onClick={() => updateQuantity(item, -1)}
                            className="w-8 h-8 border-2 border-[#1A1A1A] font-black text-base flex items-center justify-center active:scale-90 transition-transform bg-[#FBFBF9] hover:bg-[#1A1A1A] hover:text-white"
                          >−</button>
                          <span className="font-black text-sm w-5 text-center tabular-nums">{quantities[item]}</span>
                          <button
                            data-testid={`btn-increase-${item}`}
                            onClick={() => updateQuantity(item, 1)}
                            className="w-8 h-8 border-2 text-white font-black text-base flex items-center justify-center active:scale-90 transition-transform"
                            style={{ background: ACCENT, borderColor: ACCENT_DK }}
                          >+</button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 border-2 border-[#1A1A1A] bg-[#1A1A1A] text-[#FBFBF9] p-4 flex items-center justify-between">
                <span className="font-black tracking-widest text-sm uppercase">
                  {itemCount > 0 ? `${itemCount} item${itemCount !== 1 ? "s" : ""}` : "Your order"}
                </span>
                <span className="font-black text-2xl" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>R{displayTotal}</span>
              </div>
            </section>

            {/* MASCOT STRIP */}
            <div className="border-2 border-[#1A1A1A] flex items-center overflow-hidden bg-white">
              <img src="/mascot.png" alt="STUFF'D mascot" className="w-28 shrink-0 -mb-1" />
              <div className="px-4 py-4">
                <p className="font-black tracking-widest text-xs uppercase leading-snug" style={{ color: ACCENT }}>Ready to order?</p>
                <p className="text-[#1A1A1A]/60 font-medium text-xs leading-snug mt-1">
                  Fill in your details below and we'll WhatsApp your order straight to the kitchen.
                </p>
              </div>
            </div>

            {/* 03 YOUR DETAILS */}
            <section>
              <div className="flex items-center gap-3 mb-5">
                <span className="font-black tracking-widest uppercase text-xs" style={{ color: ACCENT }}>03</span>
                <h2 className="font-black tracking-widest uppercase text-base text-[#1A1A1A]">Your Details</h2>
                <div className="flex-1 h-[2px] bg-[#1A1A1A]" />
              </div>

              <div className="border-2 border-[#1A1A1A] divide-y-2 divide-[#1A1A1A]">
                {[
                  { label: "Name",  type: "text", placeholder: "Your name",    value: name,  set: setName,  id: "input-name" },
                  { label: "Phone", type: "tel",  placeholder: "082 123 4567", value: phone, set: setPhone, id: "input-phone" },
                ].map(f => (
                  <div key={f.label} className="flex flex-col">
                    <label className="font-black text-[10px] tracking-widest uppercase px-4 pt-3 pb-1 text-[#1A1A1A]/40">{f.label}</label>
                    <input data-testid={f.id} type={f.type} placeholder={f.placeholder} value={f.value}
                      onChange={e => f.set(e.target.value)}
                      className="px-4 pb-3 bg-transparent font-bold text-base outline-none placeholder:text-[#1A1A1A]/25" />
                  </div>
                ))}
                <div className="flex flex-col">
                  <label className="font-black text-[10px] tracking-widest uppercase px-4 pt-3 pb-1 text-[#1A1A1A]/40">Pickup Location</label>
                  <select data-testid="select-venue" value={venue} onChange={e => setVenue(e.target.value)}
                    className="px-4 pb-3 bg-transparent font-bold text-base outline-none appearance-none">
                    {uniqueVenues.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <div className="flex flex-col">
                  <label className="font-black text-[10px] tracking-widest uppercase px-4 pt-3 pb-1 text-[#1A1A1A]/40">Notes</label>
                  <textarea data-testid="textarea-notes" placeholder="Any special requests?" rows={2} value={notes}
                    onChange={e => setNotes(e.target.value)}
                    className="px-4 pb-3 bg-transparent font-bold text-base outline-none resize-none placeholder:text-[#1A1A1A]/25" />
                </div>
              </div>

              <p className="text-xs font-medium mt-3 text-[#1A1A1A]/50 leading-relaxed px-1">
                No payment online. Swipe your card (Yoco) or pay cash at the truck upon collection.
              </p>

              <button
                data-testid="btn-place-order"
                onClick={() => setShowModal(true)}
                className="mt-4 w-full text-white border-2 p-4 font-black uppercase tracking-widest active:scale-[0.98] transition-transform"
                style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "1.25rem", letterSpacing: "0.15em", background: ACCENT, borderColor: ACCENT_DK }}
              >
                Place WhatsApp Order
                {total > 0 && <span className="ml-3 text-white/70 text-sm font-black">· R{total}</span>}
              </button>
            </section>
          </div>
        </div>{/* end desktop 2-col */}

        {/* ─── 04 ABOUT — full-bleed on mobile, side-by-side on desktop ── */}
        <section className="-mx-4 lg:mx-0 mt-10">
          <div className="flex items-center gap-3 mb-5 px-4 lg:px-0">
            <span className="font-black tracking-widest uppercase text-xs" style={{ color: ACCENT }}>04</span>
            <h2 className="font-black tracking-widest uppercase text-base text-[#1A1A1A]">About Us</h2>
            <div className="flex-1 h-[2px] bg-[#1A1A1A]" />
          </div>
          <div className="border-t-2 border-b-2 lg:border-2 border-[#1A1A1A] overflow-hidden lg:flex lg:flex-row">
            {/* Slideshow — left half on desktop */}
            <div className="relative overflow-hidden border-b-2 lg:border-b-0 lg:border-r-2 border-[#1A1A1A] lg:w-1/2 shrink-0" style={{ aspectRatio: "16/9" }}>
              {slideImages.map((src, i) => (
                <img
                  key={src}
                  src={src}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover"
                  style={{ opacity: i === slideIndex ? 1 : 0, transition: "opacity 0.8s ease-in-out", zIndex: i === slideIndex ? 1 : 0 }}
                />
              ))}
              <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-2 z-10">
                {slideImages.map((_, i) => (
                  <button key={i} onClick={() => setSlideIndex(i)}
                    className="w-2 h-2 border border-white transition-all"
                    style={{ background: i === slideIndex ? "#fff" : "transparent" }}
                    aria-label={`Slide ${i + 1}`} />
                ))}
              </div>
            </div>
            {/* Text — right half on desktop */}
            <div className="lg:flex lg:flex-col lg:justify-between">
              <div className="border-b-2 border-[#1A1A1A] px-5 py-4 bg-[#1A1A1A]">
                <p className="font-black text-white leading-snug" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "1.5rem" }}>
                  Cape Town's first stuffed bagel. Born on the street. Built different.
                </p>
              </div>
              <div className="px-5 py-4 space-y-3 bg-[#FBFBF9] flex-1">
                <p className="font-medium text-sm text-[#1A1A1A] leading-relaxed">
                  STUFF'D started with one question: why does Cape Town not have a proper stuffed bagel? We took the classic New York bagel, packed it with bold fillings, and brought it to the streets of the Mother City.
                </p>
                <p className="font-medium text-sm text-[#1A1A1A]/60 leading-relaxed">
                  We pop up at markets, events, and cricket grounds across Cape Town every weekend. No tables, no reservations — just fresh bagels, fast.
                </p>
                <div className="flex gap-2 pt-1 flex-wrap">
                  {["Street Food", "Cape Town", "Pop-Up", "Handmade"].map(tag => (
                    <span key={tag} className="border-2 border-[#1A1A1A] px-2 py-0.5 font-black text-[10px] tracking-widest uppercase">{tag}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ─── 05 FAQ — iMessage, capped width on desktop ──── */}
        <section className="mt-10 lg:max-w-2xl lg:mx-auto">
          <div className="flex items-center gap-3 mb-5">
            <span className="font-black tracking-widest uppercase text-xs" style={{ color: ACCENT }}>05</span>
            <h2 className="font-black tracking-widest uppercase text-base text-[#1A1A1A]">Got Questions?</h2>
            <div className="flex-1 h-[2px] bg-[#1A1A1A]" />
          </div>

          <div className="border-2 border-[#1A1A1A] overflow-hidden" style={{ background: "#F2F2F7" }}>
            <div className="flex items-center gap-3 px-4 py-3 border-b-2 border-[#1A1A1A] bg-white">
              <div className="relative">
                <div className="w-9 h-9 rounded-full border-2 border-[#1A1A1A] overflow-hidden flex items-center justify-center" style={{ background: ACCENT }}>
                  <span className="text-white font-black text-xs" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>S'D</span>
                </div>
                <div className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-[#34C759] border border-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-black text-sm text-[#1A1A1A]">STUFF'D Bagels</div>
                <div className="text-[10px] text-[#34C759] font-medium">Active now</div>
              </div>
              <div className="flex items-end gap-[2px] opacity-40">
                {[3, 5, 7, 9].map(h => <div key={h} className="w-[3px] bg-[#1A1A1A] rounded-sm" style={{ height: h }} />)}
              </div>
            </div>

            <div className="px-3 py-4 space-y-5">
              {[
                { q: "Where do I collect my order?",           a: "At the venue on your pickup date 📍 Look for the STUFF'D setup — you won't miss us!", time: "10:42" },
                { q: "How do I pay? There's no checkout here 🤔", a: "Pay at the truck with Yoco (tap your card) or cash. No online payment ever needed 🙌", time: "10:44" },
                { q: "Can I book you guys for a private event?", a: "Absolutely! Drop us a WhatsApp below and we'll put together a custom quote for you 🥯", time: "10:47" },
              ].map((msg, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="text-center text-[10px] text-[#8E8E93] font-medium">{msg.time}</div>
                  <div className="flex items-end gap-2">
                    <div className="w-6 h-6 rounded-full bg-[#C7C7CC] border border-[#1A1A1A]/10 shrink-0 flex items-center justify-center mb-0.5">
                      <span className="text-[8px] font-black text-[#3C3C43]">YOU</span>
                    </div>
                    <div className="max-w-[72%] px-3 py-2 text-sm font-medium text-[#1A1A1A] leading-snug"
                      style={{ background: "#FFFFFF", borderRadius: "18px 18px 18px 4px", boxShadow: "0 1px 1px rgba(0,0,0,0.08)" }}>
                      {msg.q}
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <div className="max-w-[72%] px-3 py-2 text-sm font-medium text-white leading-snug"
                      style={{ background: "#007AFF", borderRadius: "18px 18px 4px 18px", boxShadow: "0 1px 2px rgba(0,122,255,0.3)" }}>
                      {msg.a}
                    </div>
                  </div>
                </div>
              ))}

              <div className="flex items-end gap-2">
                <div className="w-6 h-6 rounded-full shrink-0 overflow-hidden border border-[#1A1A1A]/10" style={{ background: ACCENT }}>
                  <span className="flex items-center justify-center h-full text-[7px] font-black text-white" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>S'D</span>
                </div>
                <div className="px-4 py-3 flex gap-1 items-center" style={{ background: "#FFFFFF", borderRadius: "18px 18px 18px 4px", boxShadow: "0 1px 1px rgba(0,0,0,0.08)" }}>
                  {[0, 0.2, 0.4].map((delay, i) => (
                    <div key={i} className="w-2 h-2 rounded-full bg-[#8E8E93]" style={{ animation: `bounce 1.2s ${delay}s infinite` }} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

      </div>

      {/* CONNECT SECTION */}
      <section className="max-w-6xl mx-auto px-4 lg:px-10 mt-14 mb-10">
        <div className="flex items-center gap-3 mb-8">
          <span className="font-black tracking-widest uppercase text-xs" style={{ color: ACCENT }}>05</span>
          <h2 className="font-black tracking-widest uppercase text-base text-[#1A1A1A]">Find Us</h2>
          <div className="flex-1 h-[2px] bg-[#1A1A1A]" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Instagram */}
          <a href="https://instagram.com/stuffd.bagels" target="_blank" rel="noopener noreferrer"
            className="border-2 border-[#1A1A1A] flex items-center gap-4 px-5 py-4 hover:bg-[#1A1A1A] hover:text-white group transition-colors">
            <svg className="w-7 h-7 shrink-0 group-hover:text-white text-[#1A1A1A]" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
            </svg>
            <div>
              <div className="font-black text-xs tracking-widest uppercase">Instagram</div>
              <div className="text-sm font-medium opacity-60">@stuffd.bagels</div>
            </div>
          </a>
          {/* TikTok */}
          <a href="https://tiktok.com/@stuffd.bagels" target="_blank" rel="noopener noreferrer"
            className="border-2 border-[#1A1A1A] flex items-center gap-4 px-5 py-4 hover:bg-[#1A1A1A] hover:text-white group transition-colors">
            <svg className="w-7 h-7 shrink-0 group-hover:text-white text-[#1A1A1A]" fill="currentColor" viewBox="0 0 24 24">
              <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.18 8.18 0 004.78 1.52V6.76a4.85 4.85 0 01-1.01-.07z"/>
            </svg>
            <div>
              <div className="font-black text-xs tracking-widest uppercase">TikTok</div>
              <div className="text-sm font-medium opacity-60">@stuffd.bagels</div>
            </div>
          </a>
          {/* Email */}
          <a href="mailto:stuffd.bagels@gmail.com"
            className="border-2 border-[#1A1A1A] flex items-center gap-4 px-5 py-4 hover:bg-[#1A1A1A] hover:text-white group transition-colors">
            <svg className="w-7 h-7 shrink-0 group-hover:text-white text-[#1A1A1A]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
            </svg>
            <div>
              <div className="font-black text-xs tracking-widest uppercase">Email</div>
              <div className="text-sm font-medium opacity-60">stuffd.bagels@gmail.com</div>
            </div>
          </a>
          {/* Phone */}
          <a href="tel:+27724111011"
            className="border-2 border-[#1A1A1A] flex items-center gap-4 px-5 py-4 hover:bg-[#1A1A1A] hover:text-white group transition-colors">
            <svg className="w-7 h-7 shrink-0 group-hover:text-white text-[#1A1A1A]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/>
            </svg>
            <div>
              <div className="font-black text-xs tracking-widest uppercase">Call / WhatsApp</div>
              <div className="text-sm font-medium opacity-60">+27 72 411 1011</div>
            </div>
          </a>
        </div>
      </section>

      {/* FOOTER — full width */}
      <footer className="border-t-2 border-[#1A1A1A] bg-[#1A1A1A] text-[#FBFBF9]">
        {/* Main footer body */}
        <div className="max-w-6xl mx-auto px-6 lg:px-10 py-12 grid grid-cols-1 sm:grid-cols-3 gap-10 items-center">
          {/* Logo block */}
          <div className="flex flex-col items-center sm:items-start gap-3">
            <img src="/logo.png" alt="Stuff'd Bagels logo" className="h-32 w-32 object-contain invert" />
            <p className="text-[#FBFBF9]/50 text-xs tracking-widest uppercase font-medium leading-relaxed">
              Every bite packed right.
            </p>
          </div>

          {/* Contact */}
          <div className="flex flex-col items-center sm:items-start gap-3">
            <div className="font-black text-xs tracking-widest uppercase mb-1" style={{ color: "#C8900F" }}>Get In Touch</div>
            <a href="tel:+27724111011" className="text-[#FBFBF9]/70 hover:text-white text-sm transition-colors">+27 72 411 1011</a>
            <a href="mailto:stuffd.bagels@gmail.com" className="text-[#FBFBF9]/70 hover:text-white text-sm transition-colors">stuffd.bagels@gmail.com</a>
            <div className="text-[#FBFBF9]/40 text-xs mt-1">Cape Town, South Africa 🇿🇦</div>
          </div>

          {/* Socials */}
          <div className="flex flex-col items-center sm:items-start gap-3">
            <div className="font-black text-xs tracking-widest uppercase mb-1" style={{ color: "#C8900F" }}>Follow Us</div>
            <a href="https://instagram.com/stuffd.bagels" target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 text-[#FBFBF9]/70 hover:text-white text-sm transition-colors">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>
              @stuffd.bagels
            </a>
            <a href="https://tiktok.com/@stuffd.bagels" target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 text-[#FBFBF9]/70 hover:text-white text-sm transition-colors">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.18 8.18 0 004.78 1.52V6.76a4.85 4.85 0 01-1.01-.07z"/></svg>
              @stuffd.bagels
            </a>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="border-t border-[#FBFBF9]/10 py-4 px-6 lg:px-10 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="text-[#FBFBF9]/30 text-xs tracking-widest uppercase">© 2024 Stuff'd Bagels · Cape Town</div>
          <div className="flex gap-1.5">
            <div className="w-2 h-2" style={{ background: "#C8900F" }} />
            <div className="w-2 h-2 bg-[#FBFBF9]/20" />
            <div className="w-2 h-2 bg-[#FBFBF9]/10" />
          </div>
        </div>
      </footer>

      {/* MODAL */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="border-2 border-[#1A1A1A] rounded-none bg-[#FBFBF9] max-w-[92vw] w-[400px] p-0 overflow-hidden">
          <div className="p-5 border-b-2 border-[#1A1A1A]" style={{ background: ACCENT }}>
            <DialogHeader>
              <DialogTitle className="font-black uppercase tracking-wide text-white leading-tight" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "1.5rem" }}>
                Awesome! Handing over to WhatsApp...
              </DialogTitle>
            </DialogHeader>
          </div>
          <div className="p-5">
            <DialogDescription className="font-medium text-sm text-[#1A1A1A]/70 leading-relaxed">
              We've built your order message for you. When WhatsApp opens, hit <strong className="text-[#1A1A1A]">Send</strong> to log your order with our kitchen.
            </DialogDescription>
            {total > 0 && (
              <div className="mt-4 border-2 border-[#1A1A1A] p-3 bg-[#1A1A1A] text-[#FBFBF9] flex justify-between items-center">
                <span className="font-black text-xs tracking-widest uppercase">Order Total</span>
                <span className="font-black text-xl" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>R{total}</span>
              </div>
            )}
            <button
              data-testid="btn-whatsapp-send"
              onClick={handleWhatsAppRedirect}
              className="mt-4 w-full text-white border-2 p-4 font-black uppercase tracking-widest active:scale-[0.98] transition-transform"
              style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "1.1rem", background: ACCENT, borderColor: ACCENT_DK }}
            >
              Open WhatsApp & Send
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
