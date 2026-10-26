// One source of truth for the page title, description and structured data (JSON-LD).
// scripts/prerender.mjs writes it into the HTML at build time. Only facts that are
// shown on the site go here: no invented address, hours or reviews.
// Update LAST_UPDATED when content changes (it feeds the sitemap).
import { menuPricingObject, FAQ } from "./content";

export const SITE_URL = "https://stuffdbagels.netlify.app";
export const SITE_NAME = "STUFF'D Bagels";
export const LAST_UPDATED = "2026-10-26";
const OG_IMAGE = `${SITE_URL}/opengraph.jpg`;
const PHONE = "+27724111011";
const EMAIL = "stuffd.bagels@gmail.com";

export interface PageMeta {
  path: string;
  title: string;
  description: string;
  noindex?: boolean;
  jsonLd: object[];
}

const BIZ_ID = `${SITE_URL}/#business`;

// Plain-text versions of the FAQ (emoji removed) for structured data; wording otherwise identical.
const plain = (s: string) => s.replace(/\p{Extended_Pictographic}\uFE0F?/gu, "").replace(/\s+/g, " ").trim();

const business = {
  "@type": "FoodEstablishment",
  "@id": BIZ_ID,
  name: SITE_NAME,
  slogan: "Every bite packed right.",
  description:
    "Cape Town's first stuffed bagel. Fresh, handmade stuffed bagels from our cart at markets and festivals across Cape Town. Order via WhatsApp, collect at the venue, pay with card (Yoco) or cash.",
  url: `${SITE_URL}/`,
  image: [OG_IMAGE, `${SITE_URL}/hero-bagel.jpeg`],
  logo: `${SITE_URL}/logo-badge.png`,
  telephone: PHONE,
  email: EMAIL,
  servesCuisine: ["Bagels", "Street food"],
  foundingDate: "2026",
  currenciesAccepted: "ZAR",
  paymentAccepted: "Cash, Credit Card",
  acceptsReservations: false,
  priceRange: "R65 - R85",
  address: { "@type": "PostalAddress", addressLocality: "Cape Town", addressRegion: "Western Cape", addressCountry: "ZA" },
  areaServed: { "@type": "City", name: "Cape Town" },
  sameAs: ["https://instagram.com/stuffd.bagels", "https://tiktok.com/@stuffd.bagels"],
  hasMenu: {
    "@type": "Menu",
    name: "STUFF'D Bagels menu",
    hasMenuSection: {
      "@type": "MenuSection",
      name: "Stuffed bagels",
      hasMenuItem: Object.entries(menuPricingObject).map(([name, item]) => ({
        "@type": "MenuItem",
        name,
        description: item.desc.replace(/ · /g, ", "),
        image: `${SITE_URL}${item.image}`,
        offers: { "@type": "Offer", price: item.price, priceCurrency: "ZAR" },
      })),
    },
  },
};

export const PAGES: PageMeta[] = [
  {
    path: "/",
    title: "STUFF'D Bagels | Stuffed Bagels in Cape Town",
    description:
      "Cape Town's first stuffed bagel. Fresh, handmade stuffed bagels at markets and events across Cape Town. Order via WhatsApp.",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@graph": [
          { "@type": "WebSite", "@id": `${SITE_URL}/#website`, url: `${SITE_URL}/`, name: SITE_NAME, publisher: { "@id": BIZ_ID }, inLanguage: "en-ZA" },
          business,
          {
            "@type": "FAQPage",
            mainEntity: FAQ.map((f) => ({ "@type": "Question", name: plain(f.q), acceptedAnswer: { "@type": "Answer", text: plain(f.a) } })),
          },
        ],
      },
    ],
  },
];

export const NOT_FOUND: PageMeta = {
  path: "/404",
  title: "Page not found | STUFF'D Bagels",
  description: "This page doesn't exist. Head back to the menu to order your STUFF'D bagel.",
  noindex: true,
  jsonLd: [],
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The <head> tags for one page, as HTML. Used by the prerender script. */
export function headHtml(m: PageMeta): string {
  const url = m.noindex ? undefined : `${SITE_URL}${m.path}`;
  return [
    `<title>${esc(m.title)}</title>`,
    `<meta name="description" content="${esc(m.description)}" />`,
    `<meta name="robots" content="${m.noindex ? "noindex, follow" : "index, follow, max-image-preview:large"}" />`,
    url ? `<link rel="canonical" href="${url}" />` : "",
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${esc(SITE_NAME)}" />`,
    `<meta property="og:locale" content="en_ZA" />`,
    `<meta property="og:title" content="${esc(m.title)}" />`,
    `<meta property="og:description" content="${esc(m.description)}" />`,
    url ? `<meta property="og:url" content="${url}" />` : "",
    `<meta property="og:image" content="${OG_IMAGE}" />`,
    `<meta property="og:image:width" content="1280" />`,
    `<meta property="og:image:height" content="720" />`,
    `<meta property="og:image:alt" content="STUFF'D Bagels: stuffed bagels in Cape Town" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(m.title)}" />`,
    `<meta name="twitter:description" content="${esc(m.description)}" />`,
    `<meta name="twitter:image" content="${OG_IMAGE}" />`,
    ...m.jsonLd.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, "\\u003c")}</script>`),
  ]
    .filter(Boolean)
    .join("\n    ");
}
