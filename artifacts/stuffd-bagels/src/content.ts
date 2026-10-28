// Menu and FAQ, shared by the page (Home.tsx) and the search-engine data (seo.ts),
// so prices and answers in structured data always match what visitors see.

// Client's confirmed printed menu (received 2026-10-25). Keep in step with pricing.md and llms.txt.
export const menuPricingObject: Record<
  string,
  { price: number; image: string; desc: string }
> = {
  "Pizza Bagel": {
    price: 85,
    image: "/pizza-bagel.jpeg",
    desc: "Pepperoni · Cheese · Cream Cheese",
  },
  "Jalapeno Bagel": {
    price: 70,
    image: "/jalapeno-bagel.jpeg",
    desc: "Jalapeno · Cheese · Cream Cheese",
  },
  "Cheesy Bagel": {
    price: 80,
    image: "/cheesy-bagel.jpeg",
    desc: "Cheese · Cream Cheese",
  },
  "Plain Bagel": {
    price: 65,
    image: "/plain-bagel.jpeg",
    desc: "Cream Cheese",
  },
};

// Add-on toppings from the printed menu: +R5 each, added to any bagel.
export const TOPPINGS: Record<string, number> = {
  "Extra Cheese": 5,
  "Extra Jalapeno": 5,
};

export const FAQ = [
  {
    q: "Where do I collect my order?",
    a: "At the venue on your pickup date 📍 Look for the STUFF'D cart. You won't miss us!",
    time: "10:42",
  },
  {
    q: "How do I pay? There's no checkout here 🤔",
    a: "Pay at the cart with Yoco (tap your card) or cash. No online payment ever needed 🙌",
    time: "10:44",
  },
  {
    q: "Can I book you guys for a private event?",
    a: "Absolutely! Drop us a WhatsApp or email us at stuffd.bagels@gmail.com and we'll put together a custom quote for you 🥯",
    time: "10:47",
  },
];

// Where we'll be. Static list we keep up to date (no admin needed).
// Dates are YYYY-MM-DD. Events drop off the site automatically after their end date.
// Source: @stuffd.bagels Instagram posts (checked 2026-10-24). No times are posted, so none are shown.
export interface MarketEvent {
  id: string;
  name: string;
  venue: string;
  start: string;
  end: string;
}

export const EVENTS: MarketEvent[] = [
  { id: "royal-venue-oct", name: "Market weekend", venue: "Royal Venue, Schaapkraal", start: "2026-10-24", end: "2026-10-25" },
  { id: "luxe-cape-club", name: "Luxe Cape Club", venue: "Sans Souci Grounds, Newlands", start: "2026-10-31", end: "2026-11-01" },
  { id: "spring-lovers", name: "Spring Lovers Pop Up", venue: "18 Schaap Rd, Schaapkraal", start: "2026-11-01", end: "2026-11-01" },
  { id: "mgm-26", name: "MGM '26", venue: "Venue to be announced", start: "2026-12-16", end: "2026-12-20" },
];

export function upcomingEvents(today = new Date()): MarketEvent[] {
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  const iso = `${y}-${m}-${d}`;
  return EVENTS.filter((e) => e.end >= iso);
}
