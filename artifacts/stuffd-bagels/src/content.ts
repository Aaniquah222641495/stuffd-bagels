// Menu and FAQ, shared by the page (Home.tsx) and the search-engine data (seo.ts),
// so prices and answers in structured data always match what visitors see.

// Client's menu board of 2026-11-16 (ops/units/web/projects/stuffd-bagels/client-assets/MENU-CONFIRMED.md).
// Keep in step with pricing.md and llms.txt. This is the ONLY price list: the order Worker
// (worker/forms.ts) works every order total out from it, never from what the browser sends,
// so the Yoco payment amount will come from here too.
// image: null = no photo (the card shows a brand no-photo card). avif is the optional smaller copy of the same photo.
// Halal: the founder confirmed (2026-11-16, from the client) that the WHOLE menu is halal, including the pepperoni.
// Say "halal". Do NOT say "certified" and do not name a certifier: neither is confirmed.
export const menuPricingObject: Record<
  string,
  { price: number; image: string | null; avif?: string; desc: string }
> = {
  "Classic Bagel": {
    price: 65,
    image: "/plain-bagel.jpeg",
    desc: "Cream Cheese",
  },
  "Jalapeno Bagel": {
    price: 75,
    image: "/jalapeno-bagel.jpeg", // the original box photo (founder 2026-11-16: keep the previous jalapeno picture)
    desc: "Jalapeno Cream Cheese · Jalapenos",
  },
  "Cheesy Bagel": {
    price: 85,
    image: "/cheesy-bagel.jpeg",
    desc: "Cream Cheese · Cheese",
  },
  "Pizza Bagel": {
    price: 95,
    image: "/pizza-box.jpeg", // client photo 2026-11-16, left box cropped
    avif: "/pizza-box.avif",
    desc: "Pepperoni · Cream Cheese · Cheese",
  },
  "Steak'd Bagel": {
    price: 115,
    image: "/steakd-box.jpeg", // client photo 2026-11-16, right box cropped
    avif: "/steakd-box.avif",
    desc: "Birria (Halal Beef) · Cream Cheese · Cheese",
  },
};

// Extra toppings. Waiting on the client for which toppings there are and what each costs (founder 2026-11-16:
// the old boards said Jalapeno +R5, and cheese +R5 before that; the 2026-11-16 board does not list them).
// price: null = not confirmed yet. A topping with a null price is HIDDEN from the order builder and refused by the
// Worker, so no old price is ever shown or charged. To switch one on, set its price (rand) here: the browser and
// the Worker both read this list, nothing else needs changing. Names below are the candidates from the old boards.
export const TOPPINGS: Record<string, number | null> = {
  "Extra Cheese": null,
  "Extra Jalapeno": null,
};

/** Only the toppings that have a confirmed price: what the order builder shows and the Worker accepts. */
export function pricedToppings(): Record<string, number> {
  return Object.fromEntries(Object.entries(TOPPINGS).filter((e): e is [string, number] => typeof e[1] === "number"));
}

export const FAQ = [
  {
    q: "Where and when do I collect my order?",
    a: "Online orders are collected on a Saturday at one of our pickup points 📍 Order by Wednesday, collect on Saturday. At a market? No order needed, just come and buy at the cart!",
    time: "10:42",
  },
  {
    q: "How do I pay for my order? 🤔",
    a: "Your order is confirmed once it's paid. After you send it, we'll email you how to pay 🙌",
    time: "10:44",
  },
  {
    q: "Is the food halal?",
    a: "Yes, our whole menu is halal 🥯",
    time: "10:45",
  },
  {
    q: "Can I book you guys for a private event?",
    a: "Absolutely! Fill in the event form on this page and we'll put together a custom quote for you 🥯",
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

export function upcomingEvents(list: MarketEvent[] = EVENTS, today = new Date()): MarketEvent[] {
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  const iso = `${y}-${m}-${d}`;
  return list.filter((e) => e.end >= iso);
}
