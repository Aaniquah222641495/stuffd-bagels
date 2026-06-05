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
  "Pizza Bagel":    { price: 75, image: "https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=600&q=80", desc: "Tomato · Mozz · Basil" },
  "Jalapeno Bagel": { price: 70, image: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=600&q=80", desc: "Spicy · Cream Cheese · Pickled" },
  "Cheesy Bagel":   { price: 65, image: "https://images.unsplash.com/photo-1550547660-d9450f859349?w=600&q=80", desc: "Triple Cheese · Chive" },
  "Plain Bagel":    { price: 45, image: "/plain-bagel.jpeg", desc: "Classic · Butter · Sea Salt" },
};

const TICKER_TEXT = "STUFF'D BAGELS · CAPE TOWN'S FIRST STUFFED BAGEL · EVERY BITE PACKED RIGHT · ORDER ON WHATSAPP · ";

// Golden baked-bagel colour
const ACCENT    = "#C8900F";
const ACCENT_DK = "#A06808";

// Realistic bagel SVG pin — warm golden ring, sesame seeds, date in hole
function BagelPin({ date, active = false }: { date: string; active?: boolean }) {
  const ring   = active ? ACCENT    : "#D4A44C";
  const shadow = active ? ACCENT_DK : "#A07828";
  const seeds  = [
    [28,  5, 5],  [44, 13, 40], [50, 28, 80],
    [44, 43, 130],[28, 50, 175],[12, 43, 220],
    [ 6, 28, 270],[12, 13, 310],
  ];
  return (
    <svg viewBox="0 0 56 56" width="54" height="54" style={{ display: "block", filter: active ? "drop-shadow(0 2px 6px rgba(200,144,15,0.55))" : "none" }}>
      {/* Bagel ring body */}
      <circle cx="28" cy="28" r="25" fill={ring} stroke="#1A1A1A" strokeWidth="2" />
      {/* Inner shadow arc for depth */}
      <circle cx="28" cy="28" r="25" fill="none" stroke={shadow} strokeWidth="6" opacity="0.4" />
      {/* Hole */}
      <circle cx="28" cy="28" r="10.5" fill="#FBFBF9" stroke="#1A1A1A" strokeWidth="1.5" />
      {/* Sesame seeds */}
      {seeds.map(([cx, cy, angle], i) => (
        <ellipse
          key={i}
          cx={cx} cy={cy}
          rx="2.4" ry="1.1"
          fill="#6B4A10"
          opacity="0.85"
          transform={`rotate(${angle} ${cx} ${cy})`}
        />
      ))}
      {/* Date number */}
      <text
        x="28" y="33"
        textAnchor="middle"
        fontFamily="'Bebas Neue', sans-serif"
        fontSize="13"
        fontWeight="900"
        fill="#1A1A1A"
      >{date}</text>
    </svg>
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
        {/* Dark gradient so text stays readable */}
        <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.25) 50%, rgba(0,0,0,0.72) 100%)" }} />

        {/* Wordmark overlaid */}
        <div className="relative px-5 pt-8 pb-8 max-w-md mx-auto flex flex-col justify-between" style={{ minHeight: 320 }}>
          <div>
            <p className="font-black tracking-[0.35em] text-[10px] uppercase text-white/60 mb-1">Cape Town · Est. 2024</p>
          </div>
          <div>
            <h1
              className="leading-none tracking-tighter text-white m-0"
              style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "clamp(5rem,22vw,9rem)" }}
            >
              STUFF'D
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <div className="flex-1 h-[2px] bg-white/70" />
              <span className="font-black tracking-[0.35em] text-[10px] text-white uppercase">Bagels</span>
              <div className="flex-1 h-[2px] bg-white/70" />
            </div>
            <p className="font-black tracking-widest text-[10px] uppercase text-white/60 mt-3">
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

          <div className="space-y-3">
            {Object.entries(menuPricingObject).map(([item, info]) => (
              <div key={item} className="border-2 border-[#1A1A1A] flex overflow-hidden bg-[#FBFBF9]" data-testid={`menu-item-${item}`}>
                {/* Photo */}
                <div className="w-28 shrink-0 relative overflow-hidden border-r-2 border-[#1A1A1A]">
                  <img src={info.image} alt={item} className="w-full h-full object-cover" style={{ minHeight: 112 }} />
                  {quantities[item] > 0 && (
                    <div className="absolute inset-0 flex items-center justify-center" style={{ background: `${ACCENT}ee` }}>
                      <span className="text-white font-black" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "3.5rem", lineHeight: 1 }}>
                        {quantities[item]}
                      </span>
                    </div>
                  )}
                </div>
                {/* Details */}
                <div className="flex flex-col flex-1 p-3 justify-between min-h-[112px]">
                  <div>
                    <div className="font-black uppercase text-sm leading-tight">{item}</div>
                    <div className="text-[#1A1A1A]/45 text-xs font-medium mt-0.5">{info.desc}</div>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <div className="font-black text-xl" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>R{info.price}</div>
                    <div className="flex items-center gap-1">
                      <button
                        data-testid={`btn-decrease-${item}`}
                        onClick={() => updateQuantity(item, -1)}
                        className="w-9 h-9 border-2 border-[#1A1A1A] font-black text-lg flex items-center justify-center active:scale-90 transition-transform bg-[#FBFBF9] hover:bg-[#1A1A1A] hover:text-white"
                      >−</button>
                      <span className="font-black text-base w-6 text-center tabular-nums">{quantities[item]}</span>
                      <button
                        data-testid={`btn-increase-${item}`}
                        onClick={() => updateQuantity(item, 1)}
                        className="w-9 h-9 border-2 text-white font-black text-lg flex items-center justify-center active:scale-90 transition-transform"
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

        {/* ─── MASCOT STRIP ────────────────────────────────── */}
        <div className="border-2 border-[#1A1A1A] flex items-center overflow-hidden" style={{ background: ACCENT }}>
          <img src="/mascot.png" alt="STUFF'D mascot" className="w-28 shrink-0 -mb-1 mix-blend-multiply" />
          <div className="px-4 py-4">
            <p className="text-white font-black tracking-widest text-xs uppercase leading-snug">
              Ready to order?<br />Fill in your details below and we'll WhatsApp your order straight to the kitchen.
            </p>
          </div>
        </div>

        {/* ─── 03 YOUR DETAILS ─────────────────────────────── */}
        <section>
          <div className="flex items-center gap-3 mb-5">
            <span className="font-black tracking-widest uppercase text-xs" style={{ color: ACCENT }}>03</span>
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
            <span className="font-black tracking-widest uppercase text-xs" style={{ color: ACCENT }}>04</span>
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
