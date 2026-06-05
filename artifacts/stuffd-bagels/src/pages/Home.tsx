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
  "Plain Bagel":    { price: 45, image: "https://images.unsplash.com/photo-1509440159596-0249088772ff?w=600&q=80", desc: "Classic · Butter · Sea Salt" },
};

const TICKER_TEXT = "STUFF'D BAGELS · CAPE TOWN'S FIRST STUFFED BAGEL · EVERY BITE PACKED RIGHT · ORDER ON WHATSAPP · ";
const ACCENT = "#E8472A";

function BagelPin({ date, active = false }: { date: string; active?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: 52, height: 52 }}>
        <svg viewBox="0 0 52 52" width="52" height="52" style={{ display: "block" }}>
          {/* Bagel ring */}
          <circle cx="26" cy="26" r="24" fill={active ? ACCENT : "#FBFBF9"} stroke="#1A1A1A" strokeWidth="2.5" />
          {/* Sesame seed marks */}
          <ellipse cx="26" cy="7"  rx="2" ry="1" fill="#1A1A1A" transform="rotate(0 26 26)"   />
          <ellipse cx="26" cy="7"  rx="2" ry="1" fill="#1A1A1A" transform="rotate(45 26 26)"  />
          <ellipse cx="26" cy="7"  rx="2" ry="1" fill="#1A1A1A" transform="rotate(90 26 26)"  />
          <ellipse cx="26" cy="7"  rx="2" ry="1" fill="#1A1A1A" transform="rotate(135 26 26)" />
          <ellipse cx="26" cy="7"  rx="2" ry="1" fill="#1A1A1A" transform="rotate(180 26 26)" />
          <ellipse cx="26" cy="7"  rx="2" ry="1" fill="#1A1A1A" transform="rotate(225 26 26)" />
          <ellipse cx="26" cy="7"  rx="2" ry="1" fill="#1A1A1A" transform="rotate(270 26 26)" />
          <ellipse cx="26" cy="7"  rx="2" ry="1" fill="#1A1A1A" transform="rotate(315 26 26)" />
          {/* Hole */}
          <circle cx="26" cy="26" r="10" fill={active ? ACCENT : "#FBFBF9"} stroke="#1A1A1A" strokeWidth="2" />
          {/* Date in center */}
          <text
            x="26" y="31"
            textAnchor="middle"
            fontFamily="'Bebas Neue', sans-serif"
            fontSize="14"
            fontWeight="900"
            fill={active ? "#FBFBF9" : "#1A1A1A"}
          >
            {date}
          </text>
        </svg>
      </div>
    </div>
  );
}

export default function Home() {
  const uniqueVenues = Array.from(new Set(scheduleArray.map(s => s.venue)));

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
    (sum, [item, qty]) => sum + qty * menuPricingObject[item].price,
    0
  );

  useEffect(() => {
    const diff = total - displayTotal;
    if (diff === 0) return;
    const step = diff > 0 ? Math.max(5, Math.ceil(diff / 4)) : Math.min(-5, Math.floor(diff / 4));
    const t = setTimeout(() => setDisplayTotal(prev => {
      const next = prev + step;
      if ((step > 0 && next >= total) || (step < 0 && next <= total)) return total;
      return next;
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
    <div className="bg-[#FBFBF9] min-h-screen text-[#1A1A1A] selection:bg-[#E8472A] selection:text-white overflow-x-hidden">

      {/* STICKY TICKER */}
      <div className="sticky top-0 z-50 overflow-hidden border-b-2 border-[#1A1A1A]" style={{ background: ACCENT }}>
        <div className="ticker-track whitespace-nowrap py-2.5 text-white font-black text-xs tracking-widest uppercase">
          {TICKER_TEXT.repeat(6)}
        </div>
      </div>

      {/* HERO — light background */}
      <header className="bg-[#FBFBF9] border-b-2 border-[#1A1A1A] px-6 pt-10 pb-8 relative overflow-hidden">
        {/* Halftone dot grid texture */}
        <div className="absolute inset-0 opacity-[0.045] pointer-events-none"
          style={{ backgroundImage: "radial-gradient(#1A1A1A 1px, transparent 1px)", backgroundSize: "18px 18px" }} />

        <div className="relative max-w-md mx-auto">
          <div className="flex items-end gap-2">
            {/* Mascot */}
            <img
              src="/mascot.png"
              alt="STUFF'D mascot"
              className="w-32 shrink-0 -mb-1"
              style={{ imageRendering: "crisp-edges" }}
            />
            {/* Wordmark */}
            <div className="flex flex-col justify-end pb-1 flex-1">
              <h1
                className="leading-none tracking-tighter font-black text-[#1A1A1A] m-0"
                style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "clamp(3.8rem,17vw,6.5rem)" }}
              >
                STUFF'D
              </h1>
              <div className="flex items-center gap-2 mt-1">
                <div className="flex-1 h-[2.5px] bg-[#1A1A1A]" />
                <span className="font-black tracking-[0.3em] text-[10px] text-[#1A1A1A] uppercase">Bagels</span>
                <div className="flex-1 h-[2.5px] bg-[#1A1A1A]" />
              </div>
            </div>
          </div>

          <div className="mt-5 flex items-center gap-3">
            <div className="border-2 border-[#1A1A1A] px-3 py-1" style={{ background: ACCENT }}>
              <span className="text-white font-black text-[10px] tracking-widest uppercase">Cape Town · Est. 2024</span>
            </div>
            <p className="font-black tracking-widest text-[10px] uppercase text-[#1A1A1A]/50 flex-1">
              Every bite packed right.
            </p>
          </div>
        </div>
      </header>

      <div className="max-w-md mx-auto px-4 space-y-10 py-8">

        {/* SECTION 01 — WHERE WE AT (bagel journey map) */}
        <section>
          <div className="flex items-center gap-3 mb-6">
            <span className="font-black tracking-widest uppercase text-xs" style={{ color: ACCENT }}>01</span>
            <h2 className="font-black tracking-widest uppercase text-base text-[#1A1A1A]">Where We At</h2>
            <div className="flex-1 h-[2px] bg-[#1A1A1A]" />
          </div>

          {/* Journey map — vertical */}
          <div className="relative pl-8">
            {/* Vertical dotted line connecting all stops */}
            <div
              className="absolute left-[25px] top-6 bottom-6 w-[2px]"
              style={{
                background: "repeating-linear-gradient(to bottom, #1A1A1A 0px, #1A1A1A 6px, transparent 6px, transparent 14px)"
              }}
            />

            {scheduleArray.map((sched, idx) => (
              <div key={idx} className="relative flex items-start gap-4 mb-8 last:mb-0" data-testid={`schedule-card-${idx}`}>
                {/* Bagel pin on the line */}
                <div className="shrink-0 -ml-8 z-10">
                  <BagelPin date={sched.date} active={idx === 0} />
                </div>

                {/* Info card */}
                <div className="flex-1 border-2 border-[#1A1A1A] bg-[#FBFBF9]">
                  {/* Header strip */}
                  <div className="border-b-2 border-[#1A1A1A] px-3 py-2 flex items-center justify-between"
                    style={{ background: idx === 0 ? ACCENT : "#1A1A1A" }}>
                    <span style={{ fontFamily: "'Permanent Marker', cursive" }} className="text-white text-sm">
                      {sched.day}
                    </span>
                    <span className="font-black text-white text-xs tracking-widest uppercase">{sched.hours}</span>
                  </div>
                  <div className="px-3 py-3">
                    <div className="font-black text-xs tracking-widest uppercase text-[#1A1A1A]/50">{sched.subtitle}</div>
                    <div className="font-bold text-sm mt-1">{sched.venue}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* SECTION 02 — ORDER UP */}
        <section>
          <div className="flex items-center gap-3 mb-5">
            <span className="font-black tracking-widest uppercase text-xs" style={{ color: ACCENT }}>02</span>
            <h2 className="font-black tracking-widest uppercase text-base text-[#1A1A1A]">Order Up</h2>
            <div className="flex-1 h-[2px] bg-[#1A1A1A]" />
          </div>

          <div className="space-y-3">
            {Object.entries(menuPricingObject).map(([item, info]) => (
              <div
                key={item}
                className="border-2 border-[#1A1A1A] bg-[#FBFBF9] flex overflow-hidden"
                data-testid={`menu-item-${item}`}
              >
                {/* Image */}
                <div className="w-28 shrink-0 relative overflow-hidden border-r-2 border-[#1A1A1A]">
                  <img src={info.image} alt={item} className="w-full h-full object-cover" style={{ minHeight: "112px" }} />
                  {quantities[item] > 0 && (
                    <div className="absolute inset-0 flex items-center justify-center" style={{ background: `${ACCENT}ee` }}>
                      <span className="text-white font-black" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "3.5rem", lineHeight: 1 }}>
                        {quantities[item]}
                      </span>
                    </div>
                  )}
                </div>

                {/* Info + controls */}
                <div className="flex flex-col flex-1 p-3 justify-between min-h-[112px]">
                  <div>
                    <div className="font-black uppercase text-sm leading-tight tracking-tight">{item}</div>
                    <div className="text-[#1A1A1A]/50 text-xs font-medium mt-0.5">{info.desc}</div>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <div className="font-black text-xl" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>
                      R{info.price}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        data-testid={`btn-decrease-${item}`}
                        onClick={() => updateQuantity(item, -1)}
                        className="w-9 h-9 border-2 border-[#1A1A1A] font-black text-lg flex items-center justify-center transition-all active:scale-90 bg-[#FBFBF9] hover:bg-[#1A1A1A] hover:text-white"
                      >−</button>
                      <span className="font-black text-base w-6 text-center tabular-nums">{quantities[item]}</span>
                      <button
                        data-testid={`btn-increase-${item}`}
                        onClick={() => updateQuantity(item, 1)}
                        className="w-9 h-9 border-2 text-white font-black text-lg flex items-center justify-center transition-all active:scale-90"
                        style={{ background: ACCENT, borderColor: ACCENT }}
                      >+</button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* TOTAL */}
          <div className="mt-4 border-2 border-[#1A1A1A] bg-[#1A1A1A] text-[#FBFBF9] p-4 flex items-center justify-between">
            <span className="font-black tracking-widest text-sm uppercase">
              {itemCount > 0 ? `${itemCount} item${itemCount !== 1 ? "s" : ""}` : "Your order"}
            </span>
            <span className="font-black text-2xl" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>
              R{displayTotal}
            </span>
          </div>
        </section>

        {/* SECTION 03 — YOUR DETAILS */}
        <section>
          <div className="flex items-center gap-3 mb-5">
            <span className="font-black tracking-widest uppercase text-xs" style={{ color: ACCENT }}>03</span>
            <h2 className="font-black tracking-widest uppercase text-base text-[#1A1A1A]">Your Details</h2>
            <div className="flex-1 h-[2px] bg-[#1A1A1A]" />
          </div>

          <div className="border-2 border-[#1A1A1A] divide-y-2 divide-[#1A1A1A]">
            {[
              { label: "Name", type: "text", placeholder: "Your name", value: name, onChange: (v: string) => setName(v), testId: "input-name" },
              { label: "Phone", type: "tel", placeholder: "082 123 4567", value: phone, onChange: (v: string) => setPhone(v), testId: "input-phone" },
            ].map(field => (
              <div key={field.label} className="flex flex-col">
                <label className="font-black text-[10px] tracking-widest uppercase px-4 pt-3 pb-1 text-[#1A1A1A]/40">{field.label}</label>
                <input
                  data-testid={field.testId}
                  type={field.type}
                  placeholder={field.placeholder}
                  value={field.value}
                  onChange={e => field.onChange(e.target.value)}
                  className="px-4 pb-3 bg-transparent font-bold text-base outline-none placeholder:text-[#1A1A1A]/25"
                />
              </div>
            ))}
            <div className="flex flex-col">
              <label className="font-black text-[10px] tracking-widest uppercase px-4 pt-3 pb-1 text-[#1A1A1A]/40">Pickup Location</label>
              <select
                data-testid="select-venue"
                value={venue}
                onChange={e => setVenue(e.target.value)}
                className="px-4 pb-3 bg-transparent font-bold text-base outline-none appearance-none"
              >
                {uniqueVenues.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div className="flex flex-col">
              <label className="font-black text-[10px] tracking-widest uppercase px-4 pt-3 pb-1 text-[#1A1A1A]/40">Notes</label>
              <textarea
                data-testid="textarea-notes"
                placeholder="Any special requests?"
                rows={2}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="px-4 pb-3 bg-transparent font-bold text-base outline-none resize-none placeholder:text-[#1A1A1A]/25"
              />
            </div>
          </div>

          <p className="text-xs font-medium mt-3 text-[#1A1A1A]/50 leading-relaxed px-1">
            No payment online. Swipe your card (Yoco) or pay cash at the truck upon collection.
          </p>

          <button
            data-testid="btn-place-order"
            onClick={() => setShowModal(true)}
            className="mt-4 w-full text-white border-2 p-4 font-black text-base uppercase tracking-widest active:scale-[0.98] transition-transform"
            style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "1.25rem", letterSpacing: "0.15em", background: ACCENT, borderColor: ACCENT }}
          >
            Place WhatsApp Order
            {total > 0 && <span className="ml-3 text-white/70 text-sm font-black">· R{total}</span>}
          </button>
        </section>

        {/* SECTION 04 — FAQ */}
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
              { q: "Can I book STUFF'D for private catering or pop-ups?", a: "Absolutely! Drop us a WhatsApp and we'll sort you out with a custom quote for your event." },
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
          <div className="font-black tracking-widest" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "1.2rem" }}>
            Stuff'd Bagels
          </div>
          <div className="text-[#FBFBF9]/40 text-xs tracking-widest uppercase mt-1 font-medium">
            Cape Town, South Africa 🇿🇦
          </div>
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
              We've built your order message for you. When WhatsApp opens, hit <strong className="text-[#1A1A1A]">Send</strong> in the chat window to officially log your order with our kitchen.
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
              style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "1.1rem", background: ACCENT, borderColor: ACCENT }}
            >
              Open WhatsApp & Send
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
