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

const TICKER_TEXT = "STUFF'D BAGELS · CAPE TOWN'S FIRST STUFFED BAGEL · EVERY BITE PACKED RIGHT · ORDER NOW ON WHATSAPP · ";

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
  const [pressedItem, setPressedItem] = useState<string | null>(null);
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
      if (qty > 0) {
        orderLines += `${item} x${qty} — R${qty * menuPricingObject[item].price}\n`;
      }
    });
    const message = `NEW ORDER — STUFF'D BAGELS\n\nPickup: ${venue}\nName: ${name}\nPhone: ${phone}\n\nOrder:\n${orderLines}\nTotal: R${total}\n\nNotes: ${notes || "None"}\n\nSent via stuffdbagels.co.za`;
    window.open(`https://wa.me/${BUSINESS_PHONE}?text=${encodeURIComponent(message)}`, "_blank");
    setShowModal(false);
  };

  const updateQuantity = (item: string, delta: number) => {
    setPressedItem(item + delta);
    setTimeout(() => setPressedItem(null), 150);
    setQuantities(prev => ({ ...prev, [item]: Math.max(0, prev[item] + delta) }));
  };

  const itemCount = Object.values(quantities).reduce((a, b) => a + b, 0);

  return (
    <div className="bg-[#FBFBF9] min-h-screen text-[#1A1A1A] selection:bg-[#007AFF] selection:text-white overflow-x-hidden">

      {/* STICKY AD BANNER */}
      <div className="sticky top-0 z-50 bg-[#007AFF] border-b-2 border-[#1A1A1A] overflow-hidden">
        <div className="ticker-track whitespace-nowrap py-2.5 text-white font-black text-xs tracking-widest uppercase">
          {TICKER_TEXT.repeat(6)}
        </div>
      </div>

      {/* HERO */}
      <header className="bg-[#1A1A1A] text-[#FBFBF9] border-b-2 border-[#1A1A1A] px-6 pt-14 pb-10 relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.04] pointer-events-none"
          style={{ backgroundImage: "repeating-linear-gradient(0deg,#fff 0px,#fff 1px,transparent 1px,transparent 32px),repeating-linear-gradient(90deg,#fff 0px,#fff 1px,transparent 1px,transparent 32px)" }} />
        <div className="relative max-w-md mx-auto">
          <div className="inline-block border-2 border-[#007AFF] px-3 py-1 mb-4">
            <span className="text-[#007AFF] font-black text-xs tracking-widest uppercase">Cape Town · Est. 2024</span>
          </div>

          {/* Mascot + wordmark row */}
          <div className="flex items-flex-end gap-0">
            <img
              src="/mascot.png"
              alt="STUFF'D mascot"
              className="w-36 shrink-0 -mb-2"
              style={{ filter: "drop-shadow(0 0 6px rgba(255,255,255,0.55)) drop-shadow(0 0 1px white)" }}
            />
            <div className="flex flex-col justify-end pb-2">
              <h1
                className="text-[clamp(4rem,18vw,7rem)] leading-none tracking-tighter font-black text-[#FBFBF9] m-0"
                style={{ fontFamily: "'Bebas Neue', sans-serif" }}
              >
                STUFF'D
              </h1>
              <div className="flex items-center gap-2 mt-1">
                <div className="flex-1 h-[2px] bg-[#007AFF]" />
                <span className="font-black tracking-[0.3em] text-xs text-[#FBFBF9] uppercase">Bagels</span>
                <div className="flex-1 h-[2px] bg-[#007AFF]" />
              </div>
            </div>
          </div>

          <p className="mt-5 font-black tracking-widest text-sm uppercase text-[#FBFBF9]/70">
            Every bite packed right.
          </p>
        </div>
      </header>

      <div className="max-w-md mx-auto px-4 space-y-10 py-8">

        {/* SECTION: WHERE WE AT */}
        <section>
          <div className="flex items-center gap-3 mb-5">
            <span className="font-black tracking-widest uppercase text-xs text-[#007AFF]">01</span>
            <h2 className="font-black tracking-widest uppercase text-base text-[#1A1A1A]">Where We At</h2>
            <div className="flex-1 h-[2px] bg-[#1A1A1A]" />
          </div>

          {/* Horizontal scroll snap */}
          <div className="flex gap-3 overflow-x-auto pb-3 snap-x snap-mandatory -mx-4 px-4 scrollbar-hide">
            {scheduleArray.map((sched, idx) => (
              <div
                key={idx}
                className="snap-start shrink-0 w-48 border-2 border-[#1A1A1A] bg-[#FBFBF9] flex flex-col"
                data-testid={`schedule-card-${idx}`}
              >
                <div className="bg-[#1A1A1A] px-3 pt-3 pb-1">
                  <div style={{ fontFamily: "'Permanent Marker', cursive" }} className="text-[#FBFBF9] text-sm leading-none">
                    {sched.day}
                  </div>
                  <div className="text-[#007AFF] font-black leading-none mt-0.5" style={{ fontSize: "4.5rem", fontFamily: "'Bebas Neue', sans-serif" }}>
                    {sched.date}
                  </div>
                </div>
                <div className="p-3 flex flex-col gap-1 flex-1">
                  <div className="font-black text-xs tracking-widest uppercase">{sched.subtitle}</div>
                  <div className="font-bold text-xs text-[#1A1A1A]/60 uppercase tracking-wide">{sched.hours}</div>
                  <div className="mt-auto pt-2 border-t border-[#1A1A1A]/20">
                    <div className="font-bold text-xs leading-tight">{sched.venue}</div>
                  </div>
                </div>
              </div>
            ))}
            {/* Scroll hint */}
            <div className="snap-start shrink-0 w-12 flex items-center justify-center opacity-30">
              <span className="text-2xl font-black">›</span>
            </div>
          </div>
        </section>

        {/* SECTION: ORDER UP */}
        <section>
          <div className="flex items-center gap-3 mb-5">
            <span className="font-black tracking-widest uppercase text-xs text-[#007AFF]">02</span>
            <h2 className="font-black tracking-widest uppercase text-base text-[#1A1A1A]">Order Up</h2>
            <div className="flex-1 h-[2px] bg-[#1A1A1A]" />
          </div>

          <div className="space-y-3">
            {Object.entries(menuPricingObject).map(([item, info]) => (
              <div
                key={item}
                className="border-2 border-[#1A1A1A] bg-[#FBFBF9] flex overflow-hidden"
                data-testid={`menu-item-${item}`}
                style={{ transition: "transform 0.1s" }}
              >
                {/* Image */}
                <div className="w-28 shrink-0 relative overflow-hidden border-r-2 border-[#1A1A1A]">
                  <img
                    src={info.image}
                    alt={item}
                    className="w-full h-full object-cover"
                    style={{ minHeight: "112px" }}
                  />
                  {quantities[item] > 0 && (
                    <div className="absolute inset-0 bg-[#007AFF] flex items-center justify-center"
                      style={{ opacity: 0.92 }}>
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
                        className="w-9 h-9 border-2 border-[#1A1A1A] font-black text-lg flex items-center justify-center transition-all active:scale-90"
                        style={{
                          background: pressedItem === item + (-1) ? "#1A1A1A" : "#FBFBF9",
                          color: pressedItem === item + (-1) ? "#FBFBF9" : "#1A1A1A",
                        }}
                      >
                        −
                      </button>
                      <span className="font-black text-base w-6 text-center tabular-nums">{quantities[item]}</span>
                      <button
                        data-testid={`btn-increase-${item}`}
                        onClick={() => updateQuantity(item, 1)}
                        className="w-9 h-9 border-2 border-[#007AFF] bg-[#007AFF] text-white font-black text-lg flex items-center justify-center transition-all active:scale-90"
                        style={{
                          background: pressedItem === item + 1 ? "#005fcc" : "#007AFF",
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

          {/* TOTAL BAR */}
          <div className="mt-4 border-2 border-[#1A1A1A] bg-[#1A1A1A] text-[#FBFBF9] p-4 flex items-center justify-between">
            <span className="font-black tracking-widest text-sm uppercase">
              {itemCount > 0 ? `${itemCount} item${itemCount !== 1 ? "s" : ""}` : "Your order"}
            </span>
            <span className="font-black text-2xl" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>
              R{displayTotal}
            </span>
          </div>
        </section>

        {/* SECTION: YOUR DETAILS */}
        <section>
          <div className="flex items-center gap-3 mb-5">
            <span className="font-black tracking-widest uppercase text-xs text-[#007AFF]">03</span>
            <h2 className="font-black tracking-widest uppercase text-base text-[#1A1A1A]">Your Details</h2>
            <div className="flex-1 h-[2px] bg-[#1A1A1A]" />
          </div>

          <div className="border-2 border-[#1A1A1A] divide-y-2 divide-[#1A1A1A]">
            <div className="flex flex-col">
              <label className="font-black text-[10px] tracking-widest uppercase px-4 pt-3 pb-1 text-[#1A1A1A]/50">
                Name
              </label>
              <input
                data-testid="input-name"
                type="text"
                placeholder="Your name"
                value={name}
                onChange={e => setName(e.target.value)}
                className="px-4 pb-3 bg-transparent font-bold text-base outline-none placeholder:text-[#1A1A1A]/30"
              />
            </div>
            <div className="flex flex-col">
              <label className="font-black text-[10px] tracking-widest uppercase px-4 pt-3 pb-1 text-[#1A1A1A]/50">
                Phone
              </label>
              <input
                data-testid="input-phone"
                type="tel"
                placeholder="082 123 4567"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                className="px-4 pb-3 bg-transparent font-bold text-base outline-none placeholder:text-[#1A1A1A]/30"
              />
            </div>
            <div className="flex flex-col">
              <label className="font-black text-[10px] tracking-widest uppercase px-4 pt-3 pb-1 text-[#1A1A1A]/50">
                Pickup Location
              </label>
              <select
                data-testid="select-venue"
                value={venue}
                onChange={e => setVenue(e.target.value)}
                className="px-4 pb-3 bg-transparent font-bold text-base outline-none appearance-none"
              >
                {uniqueVenues.map(v => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col">
              <label className="font-black text-[10px] tracking-widest uppercase px-4 pt-3 pb-1 text-[#1A1A1A]/50">
                Notes
              </label>
              <textarea
                data-testid="textarea-notes"
                placeholder="Any special requests?"
                rows={2}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="px-4 pb-3 bg-transparent font-bold text-base outline-none resize-none placeholder:text-[#1A1A1A]/30"
              />
            </div>
          </div>

          <p className="text-xs font-medium mt-3 text-[#1A1A1A]/50 leading-relaxed px-1">
            No payment online. Swipe your card (Yoco) or pay cash at the truck upon collection.
          </p>

          <button
            data-testid="btn-place-order"
            onClick={() => setShowModal(true)}
            className="mt-4 w-full bg-[#007AFF] text-white border-2 border-[#007AFF] p-4 font-black text-base uppercase tracking-widest active:scale-[0.98] transition-transform"
            style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "1.25rem", letterSpacing: "0.15em" }}
          >
            Place WhatsApp Order
            {total > 0 && (
              <span className="ml-3 text-white/70 text-sm font-black">· R{total}</span>
            )}
          </button>
        </section>

        {/* SECTION: FAQ */}
        <section>
          <div className="flex items-center gap-3 mb-5">
            <span className="font-black tracking-widest uppercase text-xs text-[#007AFF]">04</span>
            <h2 className="font-black tracking-widest uppercase text-base text-[#1A1A1A]">Got Questions?</h2>
            <div className="flex-1 h-[2px] bg-[#1A1A1A]" />
          </div>

          <Accordion type="single" collapsible className="w-full">
            {[
              {
                q: "Where exactly do I collect my order?",
                a: "At the venue listed on your pickup date. Look for the STUFF'D truck — you won't miss it!"
              },
              {
                q: "How do I pay if there is no checkout?",
                a: "Pay at the truck with Yoco (card tap) or cash. No online payment needed, ever."
              },
              {
                q: "Can I book STUFF'D for private catering or pop-ups?",
                a: "Absolutely! Drop us a WhatsApp and we'll sort you out with a custom quote for your event."
              },
            ].map((faq, i) => (
              <AccordionItem
                key={i}
                value={`item-${i}`}
                className="border-2 border-[#1A1A1A] mb-2 rounded-none"
              >
                <AccordionTrigger className="font-black uppercase tracking-wide text-sm px-4 hover:no-underline text-left [&>svg]:hidden">
                  <span className="flex items-center gap-3 w-full">
                    <span className="text-[#007AFF] font-black text-xs tabular-nums">{String(i + 1).padStart(2, "0")}</span>
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
          <div className="font-black tracking-widest text-sm uppercase" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "1.1rem" }}>
            Stuff'd Bagels
          </div>
          <div className="text-[#FBFBF9]/40 text-xs tracking-widest uppercase mt-1 font-medium">
            Cape Town, South Africa 🇿🇦
          </div>
          <div className="mt-3 flex justify-center gap-2">
            <div className="w-2 h-2 bg-[#007AFF]" />
            <div className="w-2 h-2 bg-[#FBFBF9]/30" />
            <div className="w-2 h-2 bg-[#FBFBF9]/30" />
          </div>
        </footer>

      </div>

      {/* MODAL */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="border-2 border-[#1A1A1A] rounded-none bg-[#FBFBF9] max-w-[92vw] w-[400px] p-0 overflow-hidden">
          <div className="bg-[#1A1A1A] p-5">
            <DialogHeader>
              <DialogTitle className="font-black uppercase tracking-wide text-[#FBFBF9] text-lg leading-tight" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "1.5rem" }}>
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
              className="mt-4 w-full bg-[#007AFF] text-white border-2 border-[#007AFF] p-4 font-black uppercase tracking-widest active:scale-[0.98] transition-transform"
              style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "1.1rem" }}
            >
              Open WhatsApp & Send
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
