import { useState } from "react";
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
  { day: "Saturday", date: "14", subtitle: "JUNE 14TH-15TH", hours: "10AM - 9PM", venue: "Newlands Cricket Ground" },
  { day: "Sunday",   date: "15", subtitle: "JUNE 15TH",      hours: "11AM - 7PM", venue: "Newlands Cricket Ground" },
  { day: "Saturday", date: "21", subtitle: "JUNE 21ST-22ND", hours: "10AM - 9PM", venue: "Green Point Urban Park" },
];

const menuPricingObject: Record<string, { price: number; image: string }> = {
  "Pizza Bagel":    { price: 75, image: "https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=400&q=80" },
  "Jalapeno Bagel": { price: 70, image: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400&q=80" },
  "Cheesy Bagel":   { price: 65, image: "https://images.unsplash.com/photo-1550547660-d9450f859349?w=400&q=80" },
  "Plain Bagel":    { price: 45, image: "https://images.unsplash.com/photo-1509440159596-0249088772ff?w=400&q=80" },
};

export default function Home() {
  const uniqueVenues = Array.from(new Set(scheduleArray.map(s => s.venue)));
  
  const [quantities, setQuantities] = useState<Record<string, number>>(() => 
    Object.fromEntries(Object.keys(menuPricingObject).map(k => [k, 0]))
  );
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [venue, setVenue] = useState(uniqueVenues[0] || '');
  const [notes, setNotes] = useState('');
  const [showModal, setShowModal] = useState(false);

  const total = Object.entries(quantities).reduce((sum, [item, qty]) => sum + qty * menuPricingObject[item].price, 0);

  const handleWhatsAppRedirect = () => {
    let orderLines = "";
    Object.entries(quantities).forEach(([item, qty]) => {
      if (qty > 0) {
        orderLines += `${item} x${qty} — R${qty * menuPricingObject[item].price}\n`;
      }
    });

    const message = `NEW ORDER — STUFFD BAGELS\n\nPickup: ${venue}\nName: ${name}\nPhone: ${phone}\n\nOrder:\n${orderLines}\nTotal: R${total}\n\nNotes: ${notes || "None"}\n\nSent via stuffdbagels.co.za`;
    
    const whatsappUrl = `https://wa.me/${BUSINESS_PHONE}?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, '_blank');
    setShowModal(false);
  };

  const updateQuantity = (item: string, delta: number) => {
    setQuantities(prev => ({
      ...prev,
      [item]: Math.max(0, prev[item] + delta)
    }));
  };

  return (
    <div className="bg-[#FBFBF9] min-h-screen text-[#1A1A1A] font-sans pb-10 selection:bg-[#007AFF] selection:text-white">
      {/* 1. STICKY AD BANNER */}
      <div className="sticky top-0 z-50 bg-[#007AFF] text-white border-b-2 border-black p-3 text-center font-bold text-sm tracking-wide shadow-none uppercase">
        This is the bagel place I was telling you about. Get Stuff'd — Cape Town's first stuffed bagel!
      </div>

      <div className="max-w-md mx-auto px-4 pt-6 space-y-8">
        
        {/* 2. HEADER */}
        <header className="border-2 border-black p-8 text-center bg-[#FBFBF9]">
          <h1 className="font-['Bebas_Neue'] text-7xl leading-none tracking-tighter m-0">STUFF'D</h1>
          <h2 className="font-black tracking-widest text-xl mt-1">BAGELS</h2>
          <p className="tracking-widest text-sm uppercase mt-4 font-bold">EVERY BITE PACKED RIGHT.</p>
        </header>

        {/* 3. WEEKLY SCHEDULE */}
        <section>
          <h3 className="font-black tracking-widest uppercase mb-4 text-[#1A1A1A]">WHERE WE AT</h3>
          <div className="space-y-4">
            {scheduleArray.map((sched, idx) => (
              <div key={idx} className="border-2 border-black p-4 bg-[#FBFBF9]">
                <div style={{ fontFamily: "'Permanent Marker', cursive" }} className="text-base text-[#1A1A1A]">{sched.day}</div>
                <div className="text-8xl font-black leading-none text-[#1A1A1A] my-2">{sched.date}</div>
                <div className="font-bold uppercase tracking-wider">{sched.subtitle}</div>
                <div className="font-medium">{sched.hours}</div>
                <div className="font-medium">{sched.venue}</div>
              </div>
            ))}
          </div>
        </section>

        {/* 4. MENU MATRIX */}
        <section>
          <h3 className="font-black tracking-widest uppercase mb-4 text-[#1A1A1A]">ORDER UP</h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            {Object.entries(menuPricingObject).map(([item, info]) => (
              <div key={item} className="border-2 border-black bg-[#FBFBF9] flex flex-col">
                <img src={info.image} alt={item} className="w-full h-40 object-cover border-b-2 border-black" />
                <div className="p-3 flex-grow flex flex-col justify-between">
                  <div>
                    <div className="font-bold text-lg uppercase leading-tight">{item}</div>
                    <div className="font-black text-xl mt-1">R{info.price}</div>
                  </div>
                  <div className="flex items-center justify-between mt-4">
                    <button 
                      data-testid={`btn-decrease-${item}`}
                      onClick={() => updateQuantity(item, -1)}
                      className="border-2 border-black w-10 h-10 flex items-center justify-center font-bold text-xl hover:bg-[#007AFF] hover:text-white hover:border-[#007AFF] transition-colors"
                    >
                      -
                    </button>
                    <span className="font-black text-xl w-8 text-center">{quantities[item]}</span>
                    <button 
                      data-testid={`btn-increase-${item}`}
                      onClick={() => updateQuantity(item, 1)}
                      className="border-2 border-black w-10 h-10 flex items-center justify-center font-bold text-xl hover:bg-[#007AFF] hover:text-white hover:border-[#007AFF] transition-colors"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="border-2 border-black p-4 text-center bg-[#FBFBF9]">
            <div className="font-black text-2xl tracking-widest uppercase">TOTAL: R{total}</div>
          </div>
        </section>

        {/* 5. ORDER FORM */}
        <section>
          <h3 className="font-black tracking-widest uppercase mb-4 text-[#1A1A1A]">YOUR DETAILS</h3>
          <div className="border-2 border-black p-4 bg-[#FBFBF9] space-y-4">
            <div>
              <label className="block font-bold uppercase tracking-wider text-sm mb-1">Customer Name</label>
              <input 
                data-testid="input-name"
                type="text" 
                placeholder="Your name" 
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="border-2 border-black p-3 w-full bg-[#FBFBF9] font-medium outline-none focus:border-[#007AFF]" 
              />
            </div>
            <div>
              <label className="block font-bold uppercase tracking-wider text-sm mb-1">Phone Number</label>
              <input 
                data-testid="input-phone"
                type="tel" 
                placeholder="e.g. 082 123 4567" 
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="border-2 border-black p-3 w-full bg-[#FBFBF9] font-medium outline-none focus:border-[#007AFF]" 
              />
            </div>
            <div>
              <label className="block font-bold uppercase tracking-wider text-sm mb-1">Pickup Location</label>
              <select 
                data-testid="select-venue"
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                className="border-2 border-black p-3 w-full bg-[#FBFBF9] font-medium outline-none focus:border-[#007AFF] appearance-none rounded-none"
              >
                {uniqueVenues.map(v => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-bold uppercase tracking-wider text-sm mb-1">Custom Notes</label>
              <textarea 
                data-testid="textarea-notes"
                placeholder="Any special requests?" 
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="border-2 border-black p-3 w-full bg-[#FBFBF9] font-medium outline-none focus:border-[#007AFF] resize-none"
              />
            </div>
            
            <p className="text-sm font-medium mt-2 leading-snug">
              No payment online. Securely swipe your card (Yoco) or pay cash at the truck upon collection.
            </p>

            <button 
              data-testid="btn-place-order"
              onClick={() => setShowModal(true)}
              className="w-full bg-[#007AFF] text-white border-2 border-[#007AFF] p-4 font-black text-lg uppercase tracking-widest hover:bg-blue-700 transition-colors mt-4"
            >
              PLACE WHATSAPP ORDER
            </button>
          </div>
        </section>

        {/* 6. FAQ ACCORDION */}
        <section>
          <h3 className="font-black tracking-widest uppercase mb-4 text-[#1A1A1A]">GOT QUESTIONS?</h3>
          <div className="bg-[#FBFBF9]">
            <Accordion type="single" collapsible className="w-full space-y-2">
              <AccordionItem value="item-1" className="border-2 border-black border-b-2 px-4 rounded-none bg-[#FBFBF9]">
                <AccordionTrigger className="font-black uppercase tracking-wide hover:no-underline text-left">Where exactly do I collect my order?</AccordionTrigger>
                <AccordionContent className="font-medium text-base pb-4">
                  At the venue listed on your pickup date. Look for the STUFF'D truck!
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-2" className="border-2 border-black border-b-2 px-4 rounded-none bg-[#FBFBF9]">
                <AccordionTrigger className="font-black uppercase tracking-wide hover:no-underline text-left">How do I pay if there is no checkout here?</AccordionTrigger>
                <AccordionContent className="font-medium text-base pb-4">
                  Pay at the truck with Yoco (card tap) or cash. No online payment needed, ever.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-3" className="border-2 border-black border-b-2 px-4 rounded-none bg-[#FBFBF9]">
                <AccordionTrigger className="font-black uppercase tracking-wide hover:no-underline text-left">Can I book STUFF'D for private catering or pop-ups?</AccordionTrigger>
                <AccordionContent className="font-medium text-base pb-4">
                  Absolutely! Drop us a WhatsApp and we will sort you out with a custom quote.
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        </section>

        {/* 7. FOOTER */}
        <footer className="border-2 border-black p-4 text-center font-black text-sm tracking-widest uppercase bg-[#FBFBF9]">
          STUFFD BAGELS — CAPE TOWN ZA 🇿🇦
        </footer>

      </div>

      {/* MODAL */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="border-2 border-black rounded-none bg-[#FBFBF9] max-w-[90vw] w-[400px]">
          <DialogHeader>
            <DialogTitle className="font-black uppercase tracking-widest text-xl">Awesome! Handing over to WhatsApp...</DialogTitle>
            <DialogDescription className="font-medium text-base text-[#1A1A1A] pt-4">
              We have built your order message for you. When WhatsApp opens up on your device, please make sure to hit Send in the chat window to officially log your order with our kitchen!
            </DialogDescription>
          </DialogHeader>
          <div className="pt-4">
            <button 
              data-testid="btn-whatsapp-send"
              onClick={handleWhatsAppRedirect}
              className="w-full bg-[#007AFF] text-white border-2 border-[#007AFF] p-4 font-black text-lg uppercase tracking-widest hover:bg-blue-700 transition-colors"
            >
              OPEN WHATSAPP & SEND
            </button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
