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
    image: "/card-classic.jpg", // straightened 2026-11-16 (the box was shot about 4 degrees off level)
    avif: "/card-classic.avif",
    desc: "Cream Cheese",
  },
  "Jalapeno Bagel": {
    price: 75,
    image: "/card-jalapeno.jpg", // client box photo 2026-11-16, right box (founder 2026-11-21: use it), cut 675x900 (3:4 like the others), bagel about 88% of the width, blue backdrop recoloured to the light card surface
    avif: "/card-jalapeno.avif",
    desc: "Jalapeno Cream Cheese · Jalapenos",
  },
  "Cheesy Bagel": {
    price: 85,
    image: "/card-cheesy.jpg", // 675x900, about 10% tighter crop 2026-11-18 so the bagel fills the card like the others
    avif: "/card-cheesy.avif",
    desc: "Cream Cheese · Cheese",
  },
  "Pizza Bagel": {
    price: 95,
    image: "/pizza-box.jpeg", // client photo 2026-11-16, left box: rotated -1.5 degrees (box bottom edge level), cut 675x900 (3:4 like card-*.jpg) with the bagel about 88% of the width, blue backdrop recoloured to the light card surface 2026-11-18
    avif: "/pizza-box.avif",
    desc: "Pepperoni · Cream Cheese · Cheese",
  },
  "Steak'd Bagel": {
    price: 115,
    image: "/steakd-box.jpeg", // client photo 2026-11-16, right box: rotated +7.5 degrees (box bottom edge level), cut 675x900 (3:4 like card-*.jpg), bagel about 88% of the width, blue backdrop recoloured to the light card surface 2026-11-18
    avif: "/steakd-box.avif",
    desc: "Birria (Halal Beef) · Cream Cheese · Cheese",
  },
};

// Extra toppings. Client confirmed on the go-live checklist, 2026-11-18: Jalapeno +R5. She named no other topping,
// so Extra Cheese stays null (the old boards once said cheese +R5, but that was never reconfirmed).
// price: null = not confirmed yet. A topping with a null price is HIDDEN from the order builder and refused by the
// Worker, so no old price is ever shown or charged. To switch one on, set its price (rand) here: the browser and
// the Worker both read this list, nothing else needs changing.
export const TOPPINGS: Record<string, number | null> = {
  "Extra Cheese": null,
  "Extra Jalapeno": 5, // confirmed by client 2026-11-18
};

/** Only the toppings that have a confirmed price: what the order builder shows and the Worker accepts. */
export function pricedToppings(): Record<string, number> {
  return Object.fromEntries(Object.entries(TOPPINGS).filter((e): e is [string, number] => typeof e[1] === "number"));
}

export const FAQ = [
  {
    q: "Where and when do I collect my order?",
    a: "Online orders are collected on a Saturday at one of our pickup points 📍 Order by Wednesday, collect on Saturday. For now that is the last Saturday of each month, and orders for it open on the 15th. At a market? No order needed, just come and buy at the cart!",
    time: "10:42",
  },
  {
    q: "How do I pay for my order? 🤔",
    a: "You pay on Yoco's secure page when you place your order. It's confirmed once it's paid, and we email you the confirmation 🙌",
    time: "10:44",
  },
  {
    q: "What if I cancel or can't collect my order?",
    a: "If you cancel before the Wednesday cut-off, you can choose a refund or credit. If you cancel after the cut-off, or you pay and don't collect, your order becomes credit for another collection Saturday or one of our markets, valid for 6 months from your original collection Saturday. Credit is not paid out as cash.",
    time: "10:45",
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
  { id: "summer-social-26", name: "Summer Social '26", venue: "Whitebox by Limitless, 30A Plantation Road, Wetton", start: "2026-12-05", end: "2026-12-05" },
  { id: "mgm-26", name: "MGM '26", venue: "Venue to be announced", start: "2026-12-16", end: "2026-12-20" },
];

export function upcomingEvents(list: MarketEvent[] = EVENTS, today = new Date()): MarketEvent[] {
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  const iso = `${y}-${m}-${d}`;
  return list.filter((e) => e.end >= iso);
}
