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
      <header className="border-b-2 border-[#1A1A1A] relative overflow-hidden" style={{ minHeight: 320 }}>
        {/* Full-bleed background photo */}
        <img
          src="/hero-bagel.jpeg"
          alt=""
          className="absolute inset-0 w-full h-full object-cover object-center"
        />
        {/* Light overlay so black text stays readable over the photo */}
        <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, rgba(251,251,249,0.30) 0%, rgba(251,251,249,0.55) 50%, rgba(251,251,249,0.78) 100%)" }} />

        {/* Wordmark overlaid */}
        <div className="relative px-5 pt-8 pb-8 max-w-md mx-auto flex flex-col items-center justify-between text-center" style={{ minHeight: 320 }}>
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

      <div className="max-w-md mx-auto px-4 space-y-10 py-8">

        {/* ─── 01 WHERE WE AT ──────────────────────────────── */}
        <section>
          <div className="flex items-center gap-3 mb-6">
            <span className="font-black tracking-widest uppercase text-xs" style={{ color: ACCENT }}>01</span>
            <h2 className="font-black tracking-widest uppercase text-base text-[#1A1A1A]">Where We At</h2>
            <div className="flex-1 h-[2px] bg-[#1A1A1A]" />
          </div>

          {/* Journey map */}
          {/* Intro line */}
          <p className="font-black text-xs tracking-widest uppercase mb-5" style={{ color: ACCENT }}>
            This week — come get STUFF'D here ↓
          </p>

          <div className="relative pl-8">
            {/* Dotted connecting line */}
            <div
              className="absolute left-[25px] top-7 bottom-7 w-[2px]"
              style={{ background: "repeating-linear-gradient(to bottom,#1A1A1A 0,#1A1A1A 5px,transparent 5px,transparent 12px)" }}
            />
            {scheduleArray.map((sched, idx) => (
              <div key={idx} className="relative flex items-start gap-4 mb-8 last:mb-0" data-testid={`schedule-card-${idx}`}>
                {/* Bagel pin */}
                <div className="shrink-0 -ml-8 z-10 mt-1">
                  <BagelPin date={sched.date} active={idx === 0} />
                </div>
                {/* Info card */}
                <div className="flex-1 border-2 border-[#1A1A1A] overflow-hidden">
                  <div
                    className="px-3 py-2 flex items-center justify-between border-b-2 border-[#1A1A1A]"
                    style={{ background: idx === 0 ? ACCENT : "#1A1A1A" }}
                  >
                    <span style={{ fontFamily: "'Permanent Marker', cursive" }} className="text-white text-sm">
                      {sched.day}
                    </span>
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
        </section>

        {/* ─── 02 ORDER UP ─────────────────────────────────── */}
        <section>
          <div className="flex items-center gap-3 mb-5">
            <span className="font-black tracking-widest uppercase text-xs" style={{ color: ACCENT }}>02</span>
            <h2 className="font-black tracking-widest uppercase text-base text-[#1A1A1A]">Order Up</h2>
            <div className="flex-1 h-[2px] bg-[#1A1A1A]" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {Object.entries(menuPricingObject).map(([item, info]) => (
              <div key={item} className="border-2 border-[#1A1A1A] flex flex-col overflow-hidden bg-[#FBFBF9]" data-testid={`menu-item-${item}`}>
                {/* Photo */}
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
                {/* Details */}
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

          {/* Total bar */}
          <div className="mt-4 border-2 border-[#1A1A1A] bg-[#1A1A1A] text-[#FBFBF9] p-4 flex items-center justify-between">
            <span className="font-black tracking-widest text-sm uppercase">
              {itemCount > 0 ? `${itemCount} item${itemCount !== 1 ? "s" : ""}` : "Your order"}
            </span>
            <span className="font-black text-2xl" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>R{displayTotal}</span>
          </div>
        </section>

        {/* ─── 03 ABOUT ────────────────────────────────────── */}
        <section className="-mx-4">
          <div className="flex items-center gap-3 mb-5 px-4">
            <span className="font-black tracking-widest uppercase text-xs" style={{ color: ACCENT }}>03</span>
            <h2 className="font-black tracking-widest uppercase text-base text-[#1A1A1A]">About Us</h2>
            <div className="flex-1 h-[2px] bg-[#1A1A1A]" />
          </div>
          <div className="border-t-2 border-b-2 border-[#1A1A1A] overflow-hidden">
            {/* Auto-cycling image panel — swap in lifestyle shots when ready */}
            <div className="relative w-full overflow-hidden border-b-2 border-[#1A1A1A]" style={{ aspectRatio: "16/9" }}>
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
              {/* Slide dots */}
              <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-2 z-10">
                {slideImages.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setSlideIndex(i)}
                    className="w-2 h-2 border border-white transition-all"
                    style={{ background: i === slideIndex ? "#fff" : "transparent" }}
                    aria-label={`Slide ${i + 1}`}
                  />
                ))}
              </div>
            </div>
            {/* Text block */}
            <div className="border-b-2 border-[#1A1A1A] px-5 py-4 bg-[#1A1A1A]">
              <p className="font-black text-white leading-snug" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "1.5rem" }}>
                Cape Town's first stuffed bagel. Born on the street. Built different.
              </p>
            </div>
            <div className="px-5 py-4 space-y-3 bg-[#FBFBF9]">
              <p className="font-medium text-sm text-[#1A1A1A] leading-relaxed">
                STUFF'D started with one question: why does Cape Town not have a proper stuffed bagel? We took the classic New York bagel, packed it with bold fillings, and brought it to the streets of the Mother City.
              </p>
              <p className="font-medium text-sm text-[#1A1A1A]/60 leading-relaxed">
                We pop up at markets, events, and cricket grounds across Cape Town every weekend. No tables, no reservations — just fresh bagels, fast.
              </p>
              <div className="flex gap-2 pt-1 flex-wrap">
                {["Street Food", "Cape Town", "Pop-Up", "Handmade"].map(tag => (
                  <span key={tag} className="border-2 border-[#1A1A1A] px-2 py-0.5 font-black text-[10px] tracking-widest uppercase">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ─── MASCOT STRIP ────────────────────────────────── */}
        <div className="border-2 border-[#1A1A1A] flex items-center overflow-hidden bg-[#1A1A1A]">
          <img src="/mascot.png" alt="STUFF'D mascot" className="w-28 shrink-0 -mb-1" />
          <div className="px-4 py-4">
            <p className="font-black tracking-widest text-xs uppercase leading-snug" style={{ color: ACCENT }}>
              Ready to order?
            </p>
            <p className="text-white font-medium text-xs leading-snug mt-1">
              Fill in your details below and we'll WhatsApp your order straight to the kitchen.
            </p>
          </div>
        </div>

        {/* ─── 03 YOUR DETAILS ─────────────────────────────── */}
        <section>
          <div className="flex items-center gap-3 mb-5">
            <span className="font-black tracking-widest uppercase text-xs" style={{ color: ACCENT }}>04</span>
            <h2 className="font-black tracking-widest uppercase text-base text-[#1A1A1A]">Your Details</h2>
            <div className="flex-1 h-[2px] bg-[#1A1A1A]" />
          </div>

          <div className="border-2 border-[#1A1A1A] divide-y-2 divide-[#1A1A1A]">
            {[
              { label: "Name",  type: "text", placeholder: "Your name",      value: name,  set: setName,  id: "input-name" },
              { label: "Phone", type: "tel",  placeholder: "082 123 4567",   value: phone, set: setPhone, id: "input-phone" },
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

        {/* ─── 04 FAQ ──────────────────────────────────────── */}
        <section>
          <div className="flex items-center gap-3 mb-5">
            <span className="font-black tracking-widest uppercase text-xs" style={{ color: ACCENT }}>05</span>
            <h2 className="font-black tracking-widest uppercase text-base text-[#1A1A1A]">Got Questions?</h2>
            <div className="flex-1 h-[2px] bg-[#1A1A1A]" />
          </div>
          <Accordion type="single" collapsible className="w-full">
            {[
              { q: "Where exactly do I collect my order?", a: "At the venue listed on your pickup date. Look for the STUFF'D truck — you won't miss it!" },
              { q: "How do I pay if there is no checkout?", a: "Pay at the truck with Yoco (card tap) or cash. No online payment needed, ever." },
              { q: "Can I book STUFF'D for private catering or pop-ups?", a: "Absolutely! Drop us a WhatsApp and we'll sort you out with a custom quote." },
            ].map((faq, i) => (
              <AccordionItem key={i} value={`item-${i}`} className="border-2 border-[#1A1A1A] mb-2 rounded-none">
                <AccordionTrigger className="font-black uppercase tracking-wide text-sm px-4 hover:no-underline text-left [&>svg]:hidden">
                  <span className="flex items-center gap-3 w-full">
                    <span className="font-black text-xs tabular-nums" style={{ color: ACCENT }}>{String(i + 1).padStart(2, "0")}</span>
                    <span>{faq.q}</span>
                  </span>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 text-sm font-medium text-[#1A1A1A]/70 border-t-2 border-[#1A1A1A] pt-3">
                  {faq.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>

        {/* FOOTER */}
        <footer className="border-2 border-[#1A1A1A] bg-[#1A1A1A] text-[#FBFBF9] p-6 text-center">
          <div className="font-black tracking-widest" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "1.2rem" }}>Stuff'd Bagels</div>
          <div className="text-[#FBFBF9]/40 text-xs tracking-widest uppercase mt-1 font-medium">Cape Town, South Africa 🇿🇦</div>
          <div className="mt-3 flex justify-center gap-2">
            <div className="w-2 h-2" style={{ background: ACCENT }} />
            <div className="w-2 h-2 bg-[#FBFBF9]/20" />
            <div className="w-2 h-2 bg-[#FBFBF9]/20" />
          </div>
        </footer>
      </div>

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
