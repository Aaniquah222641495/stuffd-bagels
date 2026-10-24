// Menu and FAQ, shared by the page (Home.tsx) and the search-engine data (seo.ts),
// so prices and answers in structured data always match what visitors see.

export const menuPricingObject: Record<
  string,
  { price: number; image: string; desc: string }
> = {
  "Pizza Bagel": {
    price: 75,
    image: "/pizza-bagel.jpeg",
    desc: "Tomato · Mozz · Basil",
  },
  "Jalapeno Bagel": {
    price: 70,
    image: "/jalapeno-bagel.jpeg",
    desc: "Spicy · Cream Cheese · Pickled",
  },
  "Cheesy Bagel": {
    price: 65,
    image: "/cheesy-bagel.jpeg",
    desc: "Triple Cheese · Chive",
  },
  "Plain Bagel": {
    price: 45,
    image: "/plain-bagel.jpeg",
    desc: "Classic · Butter · Sea Salt",
  },
};

export const FAQ = [
  {
    q: "Where do I collect my order?",
    a: "At the venue on your pickup date 📍 Look for the STUFF'D setup — you won't miss us!",
    time: "10:42",
  },
  {
    q: "How do I pay? There's no checkout here 🤔",
    a: "Pay at the truck with Yoco (tap your card) or cash. No online payment ever needed 🙌",
    time: "10:44",
  },
  {
    q: "Can I book you guys for a private event?",
    a: "Absolutely! Drop us a WhatsApp below and we'll put together a custom quote for you 🥯",
    time: "10:47",
  },
];
