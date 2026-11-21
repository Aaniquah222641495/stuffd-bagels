import { useState, useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { BookingForm } from "@/components/booking-form";
import { TURNSTILE_WAIT_MESSAGE, TurnstileBox, useTurnstile } from "@/components/turnstile";
import { DEFAULT_CUTOFF, availableSaturdays, cutoffDay, hoursCaveat, hoursLabel, niceDay, openingNote, pickupHours, timeSlots } from "@/collection";
import {
  DRAFT_KEY,
  FieldRow,
  FixedRow,
  Honeypot,
  TimeChips,
  failureMessage,
  inputClass,
  looksLikeEmail,
  looksLikePhone,
  newAttemptId,
  postForm,
  readDraft,
  type Status,
} from "@/components/order-forms";
import {
  menuPricingObject,
  FAQ,
  pricedToppings,
  EVENTS,
  upcomingEvents,
  type MarketEvent,
} from "@/content";

/** Toppings with a confirmed price (content.ts). Empty until the client confirms them, and then there is no Extras block. */
const TOPPINGS = pricedToppings();


const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseDay(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function eventToCard(e: MarketEvent) {
  const s = parseDay(e.start);
  const en = parseDay(e.end);
  const sameDay = e.start === e.end;
  const sameMonth = s.getMonth() === en.getMonth();
  const weekday = (d: Date) => d.toLocaleDateString("en-ZA", { weekday: "short" });
  return {
    id: e.id,
    start: e.start,
    end: e.end,
    // "31-1" with "Oct / Nov" underneath reads cleaner than a long range.
    days: sameDay ? `${s.getDate()}` : `${s.getDate()}-${en.getDate()}`,
    month: sameMonth ? MONTHS[s.getMonth()] : `${MONTHS[s.getMonth()]} / ${MONTHS[en.getMonth()]}`,
    when: sameDay ? s.toLocaleDateString("en-ZA", { weekday: "long" }) : `${weekday(s)} to ${weekday(en)}`,
    name: e.name,
    venue: e.venue,
  };
}

const ymd = (d: Date) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;

/** Google Maps search for the venue. None while the venue is still to be announced. */
function mapsUrl(venue: string) {
  if (/announced|tba/i.test(venue)) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${venue}, Cape Town`)}`;
}

/** Google Calendar "add event" link. All-day, so the end date is the day after the last day. */
function calendarUrl(e: { name: string; venue: string; start: string; end: string }) {
  const end = parseDay(e.end);
  end.setDate(end.getDate() + 1);
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: `STUFF'D Bagels at ${e.name}`,
    dates: `${ymd(parseDay(e.start))}/${ymd(end)}`,
    location: e.venue,
    details: "Find the blue STUFF'D cart. No order needed, come and buy at the cart.",
  });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

const isoOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** A pickup point from the owner's list (/api/pickups: active points only). Online orders collect only here. */
interface Pickup {
  id: string;
  name: string;
  area: string;
  days: string;
  opens?: string;
  closes?: string;
}

const BUSINESS_EMAIL = "stuffd.bagels@gmail.com";

const FEED = [
  { src: "/ig/feed/ig-12.jpg", alt: "" },
  { src: "/ig/feed/ig-09.jpg", alt: "" },
  { src: "/ig/feed/ig-06.jpg", alt: "" },
  { src: "/ig/feed/ig-10.jpg", alt: "" },
  { src: "/ig/feed/ig-04.jpg", alt: "" },
];

const TICKER_TEXT =
  "STUFF'D BAGELS  ·  CAPE TOWN'S FIRST STUFFED BAGEL  ·  EVERY BITE PACKED RIGHT  ·  MORE MARKETS, MORE BAGELS  ·  ";

/** Bagel cut-out: small AVIF first, transparent PNG fallback for older browsers. */
function BagelImg({ src, avif, className, ...rest }: React.ImgHTMLAttributes<HTMLImageElement> & { src: string; avif?: string }) {
  const img = <img src={src} loading="lazy" decoding="async" className={className} {...rest} />;
  // Explicit avif wins. Without one, a .png has a same-named .avif beside it; a .jpeg has none.
  const smaller = avif ?? (src.endsWith(".png") ? src.replace(/\.png$/, ".avif") : undefined);
  if (!smaller) return img;
  return (
    <picture className="contents">
      <source srcSet={smaller} type="image/avif" />
      {img}
    </picture>
  );
}

/** Round bagel photos for the moving strip under the hero. */
const BELT: { src: string; avif?: string; word: string }[] = [
  { src: "/pizza-bagel.png", word: "Pizza" },
  { src: "/jalapeno-bagel.png", word: "Jalapeno" },
  { src: "/cheesy-bagel.png", word: "Cheesy" },
  { src: "/plain-bagel.png", word: "Classic" },
  { src: "/steakd-bagel.png", word: "Steak'd" }, // cut out of the client's 2026-11-16 box photo (Vision subject lift), same style as the others
  { src: "/hero-bagel.jpeg", word: "Packed right" },
];

const ABOUT_PHOTOS = [
  { src: "/ig/cart.jpg", alt: "The STUFF'D Bagels cart at a market, blue counter and cloud sign", caption: "find the cart", width: 506, height: 900, position: "50% 85%" },
  { src: "/bite-mountains.jpeg", avif: "/bite-mountains.avif", alt: "A woman biting into a STUFF'D jalapeno bagel with the Cape mountains behind her", caption: "jalapeno, mid-bite", width: 760, height: 1013, aspect: "3/4", position: "50% 30%" },
  { src: "/ig/made-fresh.jpg", alt: "Bagels being stuffed by hand at the STUFF'D cart", caption: "made fresh", width: 506, height: 900, position: "50% 60%" },
  { src: "/ig/table.jpg", alt: "Two STUFF'D pizza bagels in takeaway boxes on a white garden table, with iced matcha drinks", caption: "market day", width: 623, height: 900, position: "50% 60%" },
  { src: "/ig/box-of-four.jpg", alt: "A box of five stuffed bagels: four cheesy garlic and one pizza", caption: "box of five", width: 675, height: 900 },
  { src: "/ig/unboxing.jpg", alt: "Opening a STUFF'D takeaway box", caption: "the unboxing", width: 450, height: 800, position: "50% 35%" },
  { src: "/ig/merch.jpg", alt: "A STUFF'D team member holding a fresh pizza bagel", caption: "hot off the cart", width: 675, height: 900, position: "50% 70%" },
  { src: "/ig/friends.jpg", alt: "Friends sharing STUFF'D bagels on a couch", caption: "bring the crew", width: 720, height: 405, aspect: "4/3", position: "50% 50%" },
  { src: "/ig/jalapeno-poster.jpg", alt: "Holding a jalapeno stuffed bagel, blue duotone photo", caption: "the jalapeno", width: 719, height: 900, aspect: "4/5", position: "50% 50%" },
];

/** Taped polaroid, like the scrapbook posters on their Instagram. `tilt` is the resting angle. */
function Polaroid({
  src,
  avif,
  alt,
  caption,
  tilt = 0,
  width,
  height,
  aspect = "4/5",
  position = "50% 50%",
}: {
  src: string;
  avif?: string;
  alt: string;
  caption: string;
  tilt?: number;
  width: number;
  height: number;
  aspect?: string;
  position?: string;
}) {
  return (
    <figure
      className="polaroid tape lift m-0"
      style={{ "--tilt": `${tilt}deg`, "--tape-tilt": `${tilt > 0 ? -5 : 4}deg` } as CSSProperties}
    >
      <picture className="contents">
        {avif && <source srcSet={avif} type="image/avif" />}
        <img
          src={src}
          alt={alt}
          width={width}
          height={height}
          loading="lazy"
          decoding="async"
          style={{ aspectRatio: aspect, objectPosition: position }}
        />
      </picture>
      <figcaption className="font-bubble text-ink text-base sm:text-lg text-center pt-2.5 leading-tight">
        {caption}
      </figcaption>
    </figure>
  );
}

/** Directions and add-to-calendar links under a market on the trail. */
function TrailLinks({
  sched,
  center = false,
}: {
  sched: { name: string; venue: string; start: string; end: string };
  center?: boolean;
}) {
  const map = mapsUrl(sched.venue);
  const cls =
    "inline-flex items-center min-h-11 text-sm font-bold text-blue underline underline-offset-4 decoration-1 decoration-blue/40 hover:decoration-blue";
  return (
    <div className={`flex flex-wrap gap-x-5 mt-1 ${center ? "justify-center" : ""}`}>
      {map && (
        <a href={map} target="_blank" rel="noopener noreferrer" className={cls} aria-label={`Directions to ${sched.venue}`}>
          Directions
        </a>
      )}
      <a
        href={calendarUrl(sched)}
        target="_blank"
        rel="noopener noreferrer"
        className={cls}
        aria-label={`Add to calendar: ${sched.name}`}
      >
        Add to calendar
      </a>
    </div>
  );
}

/** A bagel on the market trail. The next market gets a cobalt ring. */
function TrailPin({ next, turn, small = false }: { next: boolean; turn: number; small?: boolean }) {
  const size = small ? 70 : 92;
  return (
    <div
      className={`relative z-10 shrink-0 rounded-full bg-paper ${next ? "ring-4 ring-blue ring-offset-4 ring-offset-paper" : ""}`}
      style={{ width: size, height: size }}
    >
      <img
        src="/bagel-cutout.webp"
        alt=""
        width={440}
        height={440}
        loading="lazy"
        decoding="async"
        className="w-full h-full object-contain"
        style={{ rotate: `${turn}deg`, filter: "drop-shadow(0 8px 10px rgba(10, 20, 70, 0.25))" }}
      />
    </div>
  );
}

function SectionHead({
  index,
  label,
  title,
  note,
  id,
  tone = "light",
}: {
  index: string;
  label: string;
  title: string;
  note?: string;
  id?: string;
  tone?: "light" | "blue";
}) {
  const onBlue = tone === "blue";
  return (
    <div className="reveal mb-10 lg:mb-14 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
      <div>
        <p className={`eyebrow m-0 mb-3 ${onBlue ? "text-white/90" : "text-blue"}`}>
          {index} · {label}
        </p>
        <h2
          id={id}
          className={`font-bubble text-[2.6rem] sm:text-6xl leading-[0.95] m-0 text-balance ${onBlue ? "text-white" : "text-ink"}`}
        >
          {title}
        </h2>
      </div>
      {note && (
        <p className={`m-0 max-w-[34ch] text-base leading-relaxed lg:text-right ${onBlue ? "text-white/90" : "text-ink/75"}`}>
          {note}
        </p>
      )}
    </div>
  );
}

function Stepper({
  label,
  qty,
  onDec,
  onInc,
  testid,
}: {
  label: string;
  qty: number;
  onDec: () => void;
  onInc: () => void;
  testid: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <button
        data-testid={`btn-decrease-${testid}`}
        onClick={onDec}
        aria-label={`Remove one ${label}`}
        className="w-11 h-11 rounded-full border border-ink/25 bg-photo text-ink text-xl leading-none flex items-center justify-center transition-colors duration-200 hover:border-ink active:scale-95"
      >
        −
      </button>
      <span className="font-bold text-base w-6 text-center tabular-nums" aria-live="polite">
        {qty}
      </span>
      <button
        data-testid={`btn-increase-${testid}`}
        onClick={onInc}
        aria-label={`Add one ${label}`}
        className="w-11 h-11 rounded-full bg-blue text-white text-xl leading-none flex items-center justify-center transition-colors duration-200 hover:bg-blue-dk active:scale-95"
      >
        +
      </button>
    </div>
  );
}

/** Scroll reveal for `.reveal` elements. Skipped entirely when reduced motion is on. */
function useScrollReveal() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!("IntersectionObserver" in window)) return;
    const els = Array.from(document.querySelectorAll<HTMLElement>(".reveal"));
    // Anything already on screen stays visible, so nothing flickers on load.
    els.forEach((el) => {
      if (el.getBoundingClientRect().top < window.innerHeight) el.classList.add("is-in");
    });
    document.documentElement.classList.add("motion-ok");
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) {
            en.target.classList.add("is-in");
            io.unobserve(en.target);
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );
    els.forEach((el) => !el.classList.contains("is-in") && io.observe(el));
    return () => {
      io.disconnect();
      document.documentElement.classList.remove("motion-ok");
    };
  }, []);
}

function Reveal({
  children,
  className = "",
  delay = 0,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  as?: "div" | "section" | "li";
}) {
  return (
    <Tag className={`reveal ${className}`} style={{ "--d": `${delay}ms` } as CSSProperties}>
      {children}
    </Tag>
  );
}

const WRAP = "max-w-6xl mx-auto px-5 sm:px-8 lg:px-10";

export default function Home() {
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(Object.keys(menuPricingObject).map((k) => [k, 0])),
  );
  const [toppingQty, setToppingQty] = useState<Record<string, number>>(() =>
    Object.fromEntries(Object.keys(TOPPINGS).map((k) => [k, 0])),
  );
  // Start with the full list so the prerendered HTML matches the first client render,
  // then drop past events once the page is running in the browser.
  const [events, setEvents] = useState<MarketEvent[]>(EVENTS);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [pickup, setPickup] = useState(""); // pickup point id
  const [saturday, setSaturday] = useState(""); // collection Saturday, YYYY-MM-DD
  const [pickupTime, setPickupTime] = useState("");
  const [pickups, setPickups] = useState<Pickup[]>([]);
  const [pickupsLoaded, setPickupsLoaded] = useState(false);
  const [notes, setNotes] = useState("");
  const [noteOpen, setNoteOpen] = useState(false); // the notes box stays folded away until asked for
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [honey, setHoney] = useState("");
  const [today, setToday] = useState<string | null>(null);
  const [orderStatus, setOrderStatus] = useState<Status>("idle");
  const [orderErrors, setOrderErrors] = useState<Record<string, string>>({});
  const [orderProblem, setOrderProblem] = useState("");
  const [focusTick, setFocusTick] = useState(0);
  const [displayTotal, setDisplayTotal] = useState(0);
  const [detailsInView, setDetailsInView] = useState(false);
  const detailsRef = useRef<HTMLDivElement>(null);
  const [availability, setAvailability] = useState<{
    ordersEnabled: boolean;
    closedToday: boolean;
    closedMessage: string;
    closedDates?: string[];
    cutoffTime?: string;
    addedSaturdays?: string[];
    removedSaturdays?: string[];
    keptSaturdays?: string[];
    opensOn?: Record<string, string>;
  } | null>(null);

  useScrollReveal();

  const loadAvailability = () =>
    fetch("/api/availability")
      .then((r) => (r.ok ? r.json() : null))
      .then((a) => {
        if (a && typeof a.ordersEnabled === "boolean") setAvailability(a);
      })
      .catch(() => {});

  const loadPickups = () =>
    fetch("/api/pickups")
      .then((r) => (r.ok ? r.json() : null))
      .then((list: unknown) => {
        if (Array.isArray(list)) setPickups(list as Pickup[]);
      })
      .catch(() => {})
      .finally(() => setPickupsLoaded(true));

  useEffect(() => {
    loadPickups();
    // Static list first (works with no API), then the live list from the admin if it answers.
    setToday(isoOf(new Date()));
    const upcoming = upcomingEvents(EVENTS);
    setEvents(upcoming);
    fetch("/api/events")
      .then((r) => (r.ok ? r.json() : null))
      .then((list: unknown) => {
        if (!Array.isArray(list)) return;
        const live = upcomingEvents(list as MarketEvent[]);
        setEvents(live);
      })
      .catch(() => {});
    loadAvailability();
  }, []);

  // Hide the mobile order bar once the details form is on screen.
  useEffect(() => {
    const el = detailsRef.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(([en]) => setDetailsInView(en.isIntersecting), {
      threshold: 0.05,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const total =
    Object.entries(quantities).reduce(
      (sum, [item, qty]) => sum + qty * menuPricingObject[item].price,
      0,
    ) +
    Object.entries(toppingQty).reduce(
      (sum, [t, qty]) => sum + qty * TOPPINGS[t],
      0,
    );

  useEffect(() => {
    const diff = total - displayTotal;
    if (diff === 0) return;
    const step =
      diff > 0
        ? Math.max(5, Math.ceil(diff / 4))
        : Math.min(-5, Math.floor(diff / 4));
    const t = setTimeout(
      () =>
        setDisplayTotal((prev) => {
          const next = prev + step;
          return (step > 0 && next >= total) || (step < 0 && next <= total)
            ? total
            : next;
        }),
      30,
    );
    return () => clearTimeout(t);
  }, [total, displayTotal]);

  // Set the moment the first click lands (state only updates on the next render), cleared when the answer is back.
  const orderInFlight = useRef(false);
  const tsReset = useRef<() => void>(() => {});
  const attemptId = useRef<string | null>(null);

  // Back from Yoco's cancel / failure page ("Back to my order"), or the browser's Back button: put the cart and details back.
  useEffect(() => {
    const d = readDraft();
    if (!d) return;
    const known = (src: Record<string, number> | undefined, allowed: string[]) =>
      Object.fromEntries(allowed.map((k) => [k, Number.isInteger(src?.[k]) && (src as Record<string, number>)[k] > 0 && (src as Record<string, number>)[k] <= 50 ? (src as Record<string, number>)[k] : 0]));
    setQuantities(known(d.quantities, Object.keys(menuPricingObject)));
    setToppingQty(known(d.toppingQty, Object.keys(TOPPINGS)));
    setName(d.name);
    setPhone(d.phone);
    setEmail(d.email);
    setPickup(d.pickup);
    setSaturday(d.saturday);
    setPickupTime(d.pickupTime);
    setNotes(d.notes);
    if (d.notes) setNoteOpen(true);
    try {
      sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
    if (window.location.hash === "#order") setTimeout(() => document.getElementById("order")?.scrollIntoView({ block: "start" }), 300);
  }, []);

  // Coming back to this page from Yoco with the browser's Back button (the page is restored from memory): enable the button again.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        orderInFlight.current = false;
        setOrderStatus("idle");
        tsReset.current(); // the page's old token was used for the order we left behind; a token works once
      }
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  const submitOrder = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (orderStatus === "sending" || orderInFlight.current || orderingHidden) return;
    const errs: Record<string, string> = {};
    if (itemCount < 1) errs.bagels = "Pick at least one bagel above first.";
    if (!name.trim()) errs.name = "Please add your name.";
    if (!looksLikePhone(phone)) errs.phone = "Add a phone number we can reach you on, like 082 123 4567.";
    if (!looksLikeEmail(email)) errs.email = "Add your email so we can send your order details.";
    if (!chosenPoint) errs.pickup = "Choose where you'll collect from.";
    if (!chosenSat) errs.saturday = "Choose a Saturday to collect on.";
    setOrderErrors(errs);
    setOrderProblem("");
    if (Object.keys(errs).length) {
      setFocusTick((n) => n + 1); // the effect below moves focus once the errors are on screen
      return;
    }
    orderInFlight.current = true;
    setOrderStatus("sending");
    // One id per press of Pay. A repeat of the SAME press (double click, flaky network, coming back from Yoco and pressing again
    // with the same cart) gets the same payment page back instead of a second one.
    if (!attemptId.current) attemptId.current = newAttemptId();
    // Turnstile (managed): normally already solved by now. Needed by the Worker before it opens a Yoco checkout.
    const turnstileToken = await ts.getToken();
    if (!turnstileToken) {
      orderInFlight.current = false;
      setOrderProblem(TURNSTILE_WAIT_MESSAGE);
      setOrderStatus("idle");
      ts.reset();
      return;
    }
    const r = await postForm("/api/order", {
      name,
      phone,
      email,
      pickupId: chosenPoint!.id,
      pickupDate: chosenSat,
      pickupTime: chosenTime,
      items: Object.fromEntries(Object.entries(quantities).filter(([, q]) => q > 0)),
      toppings: Object.fromEntries(Object.entries(toppingQty).filter(([, q]) => q > 0)),
      note: notes,
      website: honey,
      attemptId: attemptId.current,
      turnstileToken,
    });
    orderInFlight.current = false;
    const url = r.ok ? r.data?.redirectUrl : undefined;
    if (r.ok && typeof url === "string" && /^https?:\/\//.test(url)) {
      // Keep the cart and the details for "Back to my order" (this tab only). Then go to Yoco from this page, so Yoco sees our address
      // as the referrer (no server redirect, no rel="noreferrer": Yoco checks it for live payments).
      try {
        sessionStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({ v: 1, savedAt: Date.now(), ref: r.data?.ref ?? "", quantities, toppingQty, name, phone, email, pickup: chosenPoint!.id, saturday: chosenSat, pickupTime: chosenTime, notes }),
        );
      } catch {
        /* private mode: the customer just retypes */
      }
      window.location.assign(url);
      return; // the button stays on "Opening Yoco..." until the page leaves
    }
    ts.reset(); // the token is spent whatever the answer was: get a fresh one for the next press
    // Only an unanswered request (status 0) may be retried under the same id; any answer ends that press.
    if (r.status !== 0) attemptId.current = null;
    setOrderProblem(r.ok ? "The payment page didn't open. Please try again." : failureMessage(r));
    setOrderStatus("idle");
    if (r.status === 409) {
      // A point may have been switched off, or the cut-off passed, since the page loaded: refresh both.
      loadPickups();
      loadAvailability();
    }
  };

  // "Add a note" opens the box and puts the cursor in it.
  const [noteAsked, setNoteAsked] = useState(false);
  const openNote = () => {
    setNoteOpen(true);
    setNoteAsked(true);
  };
  useEffect(() => {
    if (noteAsked) noteRef.current?.focus();
  }, [noteAsked]);

  // After a failed submit, move focus to the first field with an error (or back up to the menu).
  useEffect(() => {
    if (focusTick === 0) return;
    const first = detailsRef.current?.querySelector<HTMLElement>("[aria-invalid='true']");
    if (first) first.focus();
    else document.getElementById("order")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focusTick]);

  /** Editing a field clears its own error straight away. */
  const clearError = (k: string) =>
    setOrderErrors((p) => {
      if (!p[k]) return p;
      const { [k]: _gone, ...rest } = p;
      return rest;
    });

  const updateQuantity = (item: string, delta: number) => {
    setQuantities((prev) => ({
      ...prev,
      [item]: Math.max(0, prev[item] + delta),
    }));
  };

  const updateTopping = (t: string, delta: number) => {
    setToppingQty((prev) => ({ ...prev, [t]: Math.max(0, prev[t] + delta) }));
  };

  const itemCount = Object.values(quantities).reduce((a, b) => a + b, 0);
  const scheduleCards = events.map(eventToCard);
  const nextUp = scheduleCards[0];
  // Market pre-order line: PREVIEW ONLY until SB-20 ships (founder 2026-11-22). Production never shows it from this build;
  // SB-20 replaces this with the per-market "Take pre-orders" toggle and a link that preselects the market.
  const [showPreorderLine, setShowPreorderLine] = useState(false);
  useEffect(() => {
    setShowPreorderLine(window.location.hostname.startsWith("stuffdbagels-preview."));
  }, []);

  const ordersOffRaw =
    availability !== null &&
    (!availability.ordersEnabled || availability.closedToday);
  // Collection: owner pickup points only, on a Saturday that is still open (rules in src/collection.ts, also enforced by the Worker).
  const rules = {
    cutoffTime: availability?.cutoffTime ?? DEFAULT_CUTOFF,
    closedDates: availability?.closedDates ?? [],
    addedSaturdays: availability?.addedSaturdays ?? [],
    removedSaturdays: availability?.removedSaturdays ?? [],
    keptSaturdays: availability?.keptSaturdays ?? [],
    events,
    opensOn: availability?.opensOn ?? {},
  };
  const nowMs = today ? Date.now() : 0; // only after mount, so the prerendered HTML matches the first render
  const saturdays = today ? availableSaturdays(nowMs, rules) : [];
  const chosenSat = saturdays.includes(saturday) ? saturday : saturdays[0];
  const chosenPoint = pickups.find((p) => p.id === pickup) ?? pickups[0];
  // Preferred time: one-hour chips from the point's collection hours (none when the hours are not known). A time that
  // belongs to another point's hours is dropped, so the payload only ever carries a slot of the point being collected from.
  const slots = chosenPoint ? timeSlots(chosenPoint) : [];
  const chosenTime = slots.includes(pickupTime) ? pickupTime : "";
  const hours = chosenPoint ? pickupHours(chosenPoint) : null;
  const caveat = hoursCaveat(chosenPoint?.days);
  const onePoint = pickups.length === 1;
  const oneSat = saturdays.length === 1;
  const satNote = today ? openingNote(nowMs, rules) : "";
  const cutoffLine = chosenSat ? `Orders for ${niceDay(chosenSat)} close on ${niceDay(cutoffDay(chosenSat))} at ${rules.cutoffTime}.` : "";
  // Ordering is hidden (not just disabled) when it is switched off, today is closed, there is no active
  // pickup point, or no Saturday is open. Markets play no part: at a market people just buy at the cart.
  const hiddenMessage: string | null = ordersOffRaw
    ? availability?.closedMessage || "Orders are closed right now. See you next time."
    : pickupsLoaded && pickups.length === 0
      ? "Online ordering opens soon. We're setting up our pickup points. Questions? Email stuffd.bagels@gmail.com"
      : today !== null && saturdays.length === 0
        ? availability?.closedMessage || satNote || "There's no Saturday open for orders right now. Please check back soon."
        : null;
  const orderingHidden = hiddenMessage !== null;
  const ts = useTurnstile("order", !orderingHidden);
  tsReset.current = ts.reset;

  return (
    <div className="bg-paper min-h-screen text-ink overflow-x-hidden">
      {/* STICKY TICKER: thin and quiet */}
      <div className="sticky top-0 z-40 overflow-hidden bg-ink">
        <div aria-hidden="true" className="ticker-track whitespace-pre py-2 text-white/90 font-bold text-[10px] tracking-[0.3em] uppercase">
          {TICKER_TEXT.repeat(6)}
        </div>
      </div>

      {/* ─── HERO: cobalt panel left, a table of bagels right ─────────── */}
      <header className="relative bg-blue text-white">
        <div className="lg:grid lg:grid-cols-[1.02fr_1fr] lg:min-h-[min(860px,calc(100dvh-32px))]">
          <div className="sesame relative flex flex-col justify-center gap-7 px-5 sm:px-10 pt-12 pb-20 lg:py-20 lg:pr-16 lg:pl-[max(2.5rem,calc((100vw-72rem)/2+2.5rem))]">
            <p className="hero-pop eyebrow text-white/90 m-0">Cape Town's first stuffed bagel</p>
            {/* The client's logo. The alt text is the H1 for search engines and screen readers. */}
            <h1 className="hero-pop m-0 w-full" style={{ "--d": "80ms" } as CSSProperties}>
              <img
                src="/logo-white.svg"
                alt="STUFF'D Bagels"
                width={967}
                height={369}
                className="block w-full max-w-[560px] h-auto"
              />
            </h1>
            <p
              className="hero-pop text-white text-lg lg:text-xl font-medium leading-relaxed max-w-[36ch] m-0 text-balance"
              style={{ "--d": "180ms" } as CSSProperties}
            >
              Korean street-food style bagels, stuffed with cream cheese and bold
              fillings. Order ahead for Saturday pickup, or find the cart at a market.
            </p>
            <div
              className="hero-pop flex flex-wrap items-center gap-x-7 gap-y-4"
              style={{ "--d": "260ms" } as CSSProperties}
            >
              <a
                href="#order"
                className="inline-flex items-center gap-2 rounded-full border-2 border-ink bg-photo text-blue px-8 py-3.5 font-black uppercase tracking-widest text-sm transition-transform duration-200 hover:-translate-y-0.5 active:translate-y-0.5"
                style={{ boxShadow: "0 5px 0 var(--sb-ink)" }}
              >
                get <span className="font-bubble text-lg normal-case tracking-normal">STUFF'D</span>
              </a>
              <a
                href="#where"
                className="font-bold text-sm text-white underline underline-offset-[6px] decoration-1 decoration-white/60 hover:decoration-white"
              >
                Where's the cart this week?
              </a>
            </div>

            {nextUp && (
              <div
                className="hero-pop mt-4 pt-6 border-t border-white/25 flex items-center gap-5 max-w-md"
                style={{ "--d": "340ms" } as CSSProperties}
              >
                <div className="text-center shrink-0">
                  <div className="font-bubble text-4xl leading-none">{nextUp.days}</div>
                  <div className="eyebrow text-white/90 mt-1 tracking-[0.16em]">{nextUp.month}</div>
                </div>
                <div className="min-w-0">
                  <p className="eyebrow text-white/90 m-0">Next market</p>
                  <p className="font-bold text-base m-0 mt-1">{nextUp.name}</p>
                  <p className="text-sm text-white/90 m-0">{nextUp.venue}</p>
                </div>
              </div>
            )}
          </div>

          {/* The food, full bleed. */}
          <div className="relative min-h-[440px] sm:min-h-[560px] lg:min-h-0">
            <div className="absolute inset-0 overflow-hidden">
              {/* Still first (fast paint, and what reduced-motion visitors keep), the muted loop plays over it. */}
              <img
                src="/hero-poster.jpg"
                alt="A woman biting into a STUFF'D jalapeno bagel, with the Cape mountains behind her"
                width={720}
                height={1280}
                fetchPriority="high"
                className="hero-settle absolute inset-0 w-full h-full object-cover"
              />
              <video
                className="hero-video absolute inset-0 w-full h-full object-cover object-[50%_18%]"
                src="/hero-video.mp4"
                poster="/hero-poster.jpg"
                width={720}
                height={1280}
                autoPlay
                muted
                loop
                playsInline
                preload="auto"
                aria-hidden="true"
              />
              <div
                aria-hidden="true"
                className="absolute inset-x-0 bottom-0 h-44"
                style={{ background: "linear-gradient(to top, color-mix(in srgb, var(--sb-ink) 70%, transparent), transparent)" }}
              />
            </div>
            <p className="absolute left-5 bottom-5 sm:left-8 sm:bottom-8 m-0 text-white">
              <span className="eyebrow block text-white/90">On the menu</span>
              <span className="font-bubble text-2xl sm:text-3xl leading-tight">Classic · Jalapeno · Cheesy · Pizza · Steak'd</span>
            </p>
          </div>
        </div>
      </header>

      {/* ─── BAGEL BELT: round bagel photos rolling past. Decorative, the menu below has the details. ── */}
      <div className="belt overflow-hidden border-b border-ink/10 bg-photo py-6" aria-hidden="true">
        <div className="belt-track">
          {[0, 1].map((copy) => (
            <div key={copy} className="flex items-center gap-8 pr-8 sm:gap-12 sm:pr-12">
              {BELT.map((b) => (
                <div key={b.word + copy} className="flex items-center gap-8 sm:gap-12 shrink-0">
                  <BagelImg
                    src={b.src}
                    avif={b.avif}
                    alt=""
                    width={120}
                    height={120}
                    className={
                      b.src.endsWith(".png") || b.src.endsWith(".webp")
                        ? "w-20 h-20 sm:w-28 sm:h-28 rounded-full object-contain bg-sky p-1.5 shadow-soft"
                        : "w-20 h-20 sm:w-28 sm:h-28 rounded-full object-cover shadow-soft"
                    }
                  />
                  <span className="font-bubble text-ink text-3xl sm:text-5xl whitespace-nowrap">{b.word}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <main>
        {/* ─── 01 WHERE WE AT: an editorial list of market dates ── */}
        <section aria-labelledby="where" className={`${WRAP} pt-20 lg:pt-28 scroll-mt-12`}>
          <SectionHead
            index="01"
            label="Markets"
            id="where"
            title="Where we at"
            note="The cart moves around Cape Town."
          />
          {showPreorderLine && nextUp && (
            <p className="-mt-4 mb-10 text-base font-medium max-w-[52ch]">
              Skip the queue: pre-order online and collect at the stall on market day.{" "}
              <a href="#order" className="font-bold text-blue underline underline-offset-4">
                Pre-order for {nextUp.name} →
              </a>
            </p>
          )}

          {scheduleCards.length === 0 && (
            <p className="rounded-[22px] bg-photo shadow-soft px-5 py-5 text-base font-medium">
              New dates coming soon. Follow{" "}
              <a className="underline" href="https://instagram.com/stuffd.bagels" target="_blank" rel="noopener noreferrer">
                @stuffd.bagels
              </a>{" "}
              for the next market.
            </p>
          )}

          {/* The bagel trail: one bagel pin per market, joined by a dashed line that draws in on scroll. */}
          {scheduleCards.length > 0 && (
            <Reveal>
              {/* Desktop: across the page */}
              <ol
                className="hidden lg:grid list-none p-0 m-0 relative"
                style={{ gridTemplateColumns: `repeat(${Math.max(scheduleCards.length, 2)}, minmax(0, 1fr))` }}
              >
                {scheduleCards.length > 1 && (
                  <div
                    aria-hidden="true"
                    className="trail-x absolute top-[46px] h-[3px]"
                    style={{ left: `calc(100% / ${scheduleCards.length * 2})`, right: `calc(100% / ${scheduleCards.length * 2})` }}
                  />
                )}
                {scheduleCards.map((sched, idx) => (
                  <li key={sched.id} data-testid={`schedule-card-${idx}`} className="relative flex flex-col items-center text-center px-4">
                    <TrailPin next={idx === 0} turn={idx * 70} />
                    <div className="mt-5 font-bubble text-5xl leading-none text-blue whitespace-nowrap">{sched.days}</div>
                    <div className="eyebrow text-ink/75 mt-2 tracking-[0.16em]">{sched.month} · {sched.when}</div>
                    {idx === 0 && (
                      <span className="eyebrow bg-blue text-white px-2 py-1 rounded-md mt-4 tracking-[0.16em]">Next up</span>
                    )}
                    <div className="font-bold text-xl leading-snug mt-3">{sched.name}</div>
                    <div className="text-ink/75 text-base mt-1 max-w-[26ch]">{sched.venue}</div>
                    <TrailLinks sched={sched} center />
                  </li>
                ))}
                {/* Only one market listed: the cart fills the empty right-hand side (founder 2026-11-22). Decorative. */}
                {scheduleCards.length === 1 && (
                  <li aria-hidden="true" className="flex items-center justify-center px-4">
                    <img src="/cart.svg" alt="" width={520} height={460} loading="lazy" className="cart-bob w-full max-w-[20rem]" />
                  </li>
                )}
              </ol>

              {/* Phone: down the side */}
              <ol className="lg:hidden list-none p-0 m-0 relative grid gap-9">
                {scheduleCards.length > 1 && (
                  <div aria-hidden="true" className="trail-y absolute left-[34px] top-[40px] bottom-[40px] w-[3px]" />
                )}
                {scheduleCards.map((sched, idx) => (
                  <li key={sched.id} data-testid={`schedule-card-m-${idx}`} className="relative grid grid-cols-[70px_1fr] gap-x-5 items-start">
                    <TrailPin next={idx === 0} turn={idx * 70} small />
                    <div className="min-w-0 pt-1">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="font-bubble text-[2rem] leading-none text-blue whitespace-nowrap">{sched.days}</span>
                        <span className="eyebrow text-ink/75 tracking-[0.16em]">{sched.month}</span>
                        {idx === 0 && (
                          <span className="eyebrow bg-blue text-white px-2 py-1 rounded-md tracking-[0.16em]">Next up</span>
                        )}
                      </div>
                      <div className="font-bold text-lg leading-snug mt-2">{sched.name}</div>
                      <div className="text-ink/75 text-sm">{sched.venue}</div>
                      <div className="text-ink/75 text-sm">{sched.when}</div>
                      <TrailLinks sched={sched} />
                    </div>
                  </li>
                ))}
              </ol>
            </Reveal>
          )}
        </section>

        {/* ─── 02 ORDER UP ──────────────────────────────────── */}
        <div className={`${WRAP} pt-24 lg:pt-32 scroll-mt-12`} id="order">
          <section aria-labelledby="order-heading">
            <SectionHead
              index="02"
              label="Menu"
              id="order-heading"
              title="Order up"
              note="Five bagels, stuffed to the edge. The whole menu is halal."
            />

            <p className="m-0 mb-8">
              <span className="inline-block rounded-full border-2 border-ink bg-photo text-ink px-4 py-1.5 text-xs font-black uppercase tracking-widest">
                Halal menu
              </span>
              <span className="ml-3 text-sm font-bold text-ink" data-testid="collection-rule">
                Order by Wednesday, collect on Saturday.
              </span>
            </p>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-x-4 sm:gap-x-6 gap-y-12">
              {Object.entries(menuPricingObject).map(([item, info], idx, all) => (
                // An odd last card sits centred on its own row on the 2-column layouts, the same width as one column
                // (the grid gap is 1rem, 1.5rem from sm up), so it is not stretched across the row.
                <Reveal key={item} delay={idx * 80} className={idx === all.length - 1 && all.length % 2 === 1 ? "col-span-2 justify-self-center w-[calc(50%-0.5rem)] sm:w-[calc(50%-0.75rem)] lg:col-span-1 lg:w-auto lg:justify-self-stretch" : ""}>
                  <article className="group h-full flex flex-col" data-testid={`menu-item-${item}`}>
                    {/* The real photos in their boxes (founder 2026-10-28: cut-outs looked less appetising here; the belt keeps them) */}
                    <div className="relative overflow-hidden rounded-[22px] shadow-soft bg-ink/5">
                      {info.image ? (
                        <BagelImg
                          src={info.image}
                          avif={info.avif}
                          alt={item}
                          width={900}
                          height={1200}
                          className={`block w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.05] aspect-[4/5]`}
                        />
                      ) : (
                        // No photo yet: a brand card instead of a stock or AI picture. Set `image` in content.ts to replace it.
                        <div className="sesame bg-blue text-white flex flex-col items-center justify-center text-center gap-2 aspect-[4/5] px-4">
                          <span className="eyebrow text-sky">New on the menu</span>
                          <span className="font-bubble text-4xl sm:text-5xl lg:text-4xl leading-none">Steak&apos;d</span>
                          <span className="text-sm font-medium text-white/90">Photo coming soon</span>
                        </div>
                      )}
                      <span className="absolute top-3 right-3 rounded-full bg-photo text-ink font-bebas text-xl leading-none px-3 pt-1.5 pb-1 shadow-soft">
                        R{info.price}
                      </span>
                      {quantities[item] > 0 && (
                        <div
                          className="absolute inset-0 flex items-center justify-center"
                          style={{ background: "color-mix(in srgb, var(--sb-blue) 82%, transparent)" }}
                          aria-hidden="true"
                        >
                          <span className="font-bubble text-white" style={{ fontSize: "4rem", lineHeight: 1 }}>
                            {quantities[item]}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col flex-1 pt-4 gap-3">
                      <div>
                        <h3 className="font-bubble text-2xl sm:text-[1.7rem] lg:text-2xl leading-tight m-0 text-ink">
                          {item.replace(" Bagel", "")}
                        </h3>
                        <p className="text-ink/75 text-sm mt-1 leading-snug m-0">{info.desc}</p>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-auto">
                        <span className="hidden sm:inline text-sm font-medium text-ink/75">
                          {quantities[item] > 0 ? "In your order" : "Add to order"}
                        </span>
                        <Stepper
                          label={item}
                          qty={quantities[item]}
                          testid={item}
                          onDec={() => updateQuantity(item, -1)}
                          onInc={() => updateQuantity(item, 1)}
                        />
                      </div>
                    </div>
                  </article>
                </Reveal>
              ))}
            </div>

            {/* Extras and the running total, as one receipt */}
            <Reveal className="mt-14">
              <div className="rounded-[22px] bg-photo shadow-soft overflow-hidden">
                {Object.keys(TOPPINGS).length > 0 && (
                <div className="px-5 sm:px-7 py-5 grid gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-center sm:gap-x-10">
                  <div>
                    <p className="font-bubble text-2xl text-ink m-0">Extras</p>
                    <p className="text-sm text-ink/75 m-0">Add to any bagel</p>
                  </div>
                  {Object.entries(TOPPINGS).map(([t, price]) => (
                    <div key={t} className="flex items-center justify-between gap-4" data-testid={`topping-${t}`}>
                      <span className="text-sm font-bold">
                        {t} <span className="font-medium text-ink/75 ml-1">+R{price}</span>
                      </span>
                      <Stepper
                        label={t}
                        qty={toppingQty[t]}
                        testid={t}
                        onDec={() => updateTopping(t, -1)}
                        onInc={() => updateTopping(t, 1)}
                      />
                    </div>
                  ))}
                </div>
                )}
                <div className="bg-ink text-paper px-5 sm:px-7 py-5 flex items-center justify-between">
                  <span className="eyebrow">
                    {itemCount > 0
                      ? `${itemCount} bagel${itemCount !== 1 ? "s" : ""} in your order`
                      : "Your order"}
                  </span>
                  <span className="font-bebas text-4xl leading-none tabular-nums">R{displayTotal}</span>
                </div>
              </div>
            </Reveal>
          </section>

          {/* ─── 03 YOUR DETAILS ───────────────────────────── */}
          <div ref={detailsRef} id="details" className="pt-24 lg:pt-32 scroll-mt-12">
            <SectionHead
              index="03"
              label="Checkout"
              title="Your details"
              note="Fill this in and pay. Your order goes to our kitchen once it's paid."
            />

            <div className="grid grid-cols-1 gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16 lg:items-start">
              <Reveal>
                <ol className="list-none p-0 m-0 grid gap-6">
                  {[
                    ["Pick your bagels", "Choose from the menu above."],
                    ["Add your details", "Your name, number and email. Check where and when you collect."],
                    ["Pay with Yoco", "Pay securely on Yoco. Your order is confirmed straight away and we email you a confirmation."],
                  ].map(([t, d], i) => (
                    <li key={t} className="grid grid-cols-[3rem_1fr] gap-4 items-start">
                      <span className="font-bubble text-3xl text-blue leading-none">{i + 1}</span>
                      <div>
                        <p className="font-bold text-lg m-0">{t}</p>
                        <p className="text-ink/75 m-0 mt-1 leading-relaxed">{d}</p>
                      </div>
                    </li>
                  ))}
                </ol>
                {/* Our mascot, chomping: two quick bites, crumbs fly, repeat. CSS only, off for reduced motion. */}
                <div className="mascot-chomp relative block w-48 sm:w-60 lg:w-80 mt-8 lg:mt-12 mx-auto lg:mx-0" aria-hidden="true">
                  <img
                    src="/mascot-bite.webp"
                    alt=""
                    width={640}
                    height={640}
                    loading="lazy"
                    decoding="async"
                    className="mascot-chomp__img block w-full object-contain"
                  />
                  {[0, 1, 2, 3, 4, 5].map((n) => (
                    <span key={n} className={`mascot-chomp__crumb mascot-chomp__crumb--${n}`} />
                  ))}
                </div>
              </Reveal>

              <section aria-label="Your details" className="min-w-0">
                {hiddenMessage ? (
                  <div role="status" data-testid="orders-hidden" className="rounded-[22px] bg-ink text-paper p-7 sm:p-9">
                    <p className="eyebrow m-0 text-sky">Ordering</p>
                    <p className="font-bubble text-2xl sm:text-3xl leading-tight m-0 mt-3 text-balance [overflow-wrap:anywhere]">{hiddenMessage}</p>
                  </div>
                ) : (
                  <form id="order-form" onSubmit={submitOrder} noValidate aria-label="Pay for your order" data-testid="order-form" className="scroll-mt-10">
                    {satNote && (
                      <p role="status" data-testid="saturday-note" className="mb-4 rounded-2xl bg-ink text-paper px-4 py-3 text-sm font-bold leading-snug m-0">
                        {satNote}
                      </p>
                    )}
                    <div className="relative rounded-[22px] bg-photo shadow-soft divide-y divide-ink/10 overflow-hidden">
                      <Honeypot value={honey} onChange={setHoney} />
                      <FieldRow label="Name" error={orderErrors.name}>
                        {(p) => (
                          <input id={p.id} data-testid="input-name" type="text" name="name" autoComplete="name" maxLength={60}
                            aria-invalid={p.invalid} aria-describedby={p.describedBy} placeholder="Your name"
                            value={name} onChange={(e) => { setName(e.target.value); clearError("name"); }} className={inputClass} />
                        )}
                      </FieldRow>
                      <FieldRow label="Phone" error={orderErrors.phone}>
                        {(p) => (
                          <input id={p.id} data-testid="input-phone" type="tel" name="tel" autoComplete="tel" maxLength={20}
                            aria-invalid={p.invalid} aria-describedby={p.describedBy} placeholder="082 123 4567"
                            value={phone} onChange={(e) => { setPhone(e.target.value); clearError("phone"); }} className={inputClass} />
                        )}
                      </FieldRow>
                      <FieldRow label="Email" error={orderErrors.email}>
                        {(p) => (
                          <input id={p.id} data-testid="input-email" type="email" name="email" autoComplete="email" maxLength={254}
                            aria-invalid={p.invalid} aria-describedby={p.describedBy} placeholder="you@example.com"
                            value={email} onChange={(e) => { setEmail(e.target.value); clearError("email"); }} className={inputClass} />
                        )}
                      </FieldRow>
                      {onePoint && oneSat && chosenPoint && chosenSat ? (
                        // One pickup point and one Saturday: nothing to choose, so just say it.
                        <FixedRow
                          label="Collect"
                          testId="collect-summary"
                          // Kept short (founder 2026-11-19: "too much"): place, then day and hours. The cut-off is
                          // already said under the form, so it is not repeated here.
                          value={chosenPoint.area && !chosenPoint.name.toLowerCase().includes(chosenPoint.area.toLowerCase()) ? `${chosenPoint.name}, ${chosenPoint.area}` : chosenPoint.name}
                          hint={[niceDay(chosenSat).replace(/^(\w{3})\w*/, "$1"), hours ? hoursLabel(hours) : chosenPoint.days].filter(Boolean).join(", ")}
                        />
                      ) : (
                        <>
                          {onePoint && chosenPoint ? (
                            <FixedRow
                              label="Pickup point"
                              testId="pickup-fixed"
                              value={`${chosenPoint.name}, ${chosenPoint.area}`}
                              hint={hours ? caveat || undefined : chosenPoint.days ? `Collection times: ${chosenPoint.days}` : undefined}
                            />
                          ) : (
                            <FieldRow label="Pickup point" error={orderErrors.pickup} hint={chosenPoint?.days ? `Collection times: ${chosenPoint.days}` : undefined}>
                              {(p) => (
                                <div className="relative min-w-0">
                                  <select id={p.id} data-testid="select-venue" aria-invalid={p.invalid} aria-describedby={p.describedBy}
                                    value={chosenPoint?.id ?? ""} onChange={(e) => { setPickup(e.target.value); setPickupTime(""); clearError("pickup"); }} disabled={pickups.length === 0}
                                    className="w-full min-w-0 pl-5 pr-12 pb-4 bg-transparent font-semibold text-base outline-none appearance-none focus-visible:bg-sky/30 text-ink">
                                    {pickups.length === 0 && <option value="">Loading...</option>}
                                    {pickups.map((pt) => (
                                      <option key={pt.id} value={pt.id}>{pt.name} · {pt.area}</option>
                                    ))}
                                  </select>
                                  <svg aria-hidden="true" className="pointer-events-none absolute right-5 top-[0.35rem] w-4 h-4 text-ink/75" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 8l5 5 5-5" /></svg>
                                </div>
                              )}
                            </FieldRow>
                          )}
                          {oneSat && chosenSat ? (
                            <FixedRow label="Collection Saturday" testId="saturday-fixed" value={niceDay(chosenSat)} hint={cutoffLine || undefined} />
                          ) : (
                            <FieldRow label="Collection Saturday" error={orderErrors.saturday} hint={cutoffLine || undefined}>
                              {(p) => (
                                <div className="relative min-w-0">
                                  <select id={p.id} data-testid="select-saturday" aria-invalid={p.invalid} aria-describedby={p.describedBy}
                                    value={chosenSat ?? ""} onChange={(e) => { setSaturday(e.target.value); clearError("saturday"); }} disabled={saturdays.length === 0}
                                    className="w-full min-w-0 pl-5 pr-12 pb-4 bg-transparent font-semibold text-base outline-none appearance-none focus-visible:bg-sky/30 text-ink">
                                    {saturdays.length === 0 && <option value="">Loading...</option>}
                                    {saturdays.map((d) => (
                                      <option key={d} value={d}>{niceDay(d)}</option>
                                    ))}
                                  </select>
                                  <svg aria-hidden="true" className="pointer-events-none absolute right-5 top-[0.35rem] w-4 h-4 text-ink/75" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 8l5 5 5-5" /></svg>
                                </div>
                              )}
                            </FieldRow>
                          )}
                        </>
                      )}
                      {slots.length > 0 && (
                        <TimeChips legend="Preferred time (optional)" slots={slots} value={chosenTime} onChange={setPickupTime} />
                      )}
                      {noteOpen ? (
                        <FieldRow label="Note (optional)">
                          {(p) => (
                            <textarea id={p.id} ref={noteRef} data-testid="textarea-notes" placeholder="Any special requests?" rows={2} maxLength={300}
                              value={notes} onChange={(e) => setNotes(e.target.value)}
                              className={`${inputClass} resize-none`} />
                          )}
                        </FieldRow>
                      ) : (
                        <div className="px-5 py-2">
                          <button type="button" data-testid="btn-add-note" aria-expanded={false} onClick={openNote}
                            className="inline-flex min-h-[44px] items-center gap-2 rounded-full pr-3 text-sm font-bold text-ink underline underline-offset-4 decoration-1 hover:text-blue focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ink">
                            <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M10 4v12M4 10h12" /></svg>
                            Add a note
                          </button>
                        </div>
                      )}
                    </div>


                    {orderErrors.bagels && itemCount < 1 && (
                      <p role="alert" className="mt-4 mb-0 text-sm font-bold text-error">{orderErrors.bagels}</p>
                    )}
                    <TurnstileBox handle={ts} className="mt-4" />
                    {orderProblem && (
                      <p role="alert" className="mt-4 mb-0 rounded-2xl border-2 border-error px-4 py-3 text-sm font-bold text-error">
                        {orderProblem}
                      </p>
                    )}
                    <button
                      type="submit"
                      data-testid="btn-place-order"
                      disabled={orderStatus === "sending"}
                      className="mt-5 w-full rounded-full text-white border-2 border-ink bg-blue p-4 uppercase tracking-widest transition-transform duration-200 hover:-translate-y-0.5 active:translate-y-0.5 font-bebas disabled:cursor-wait"
                      style={{ fontSize: "1.4rem", letterSpacing: "0.12em", boxShadow: "0 5px 0 var(--sb-ink)" }}
                    >
                      {orderStatus === "sending" ? "Opening Yoco..." : total > 0 ? `Pay R${total} with Yoco` : "Pay with Yoco"}
                    </button>
                    {/* One short line instead of the long paragraphs (founder 2026-11-19). The cancellation term (dp-counsel 1b) stays visible
                        here, not only behind the link: CPA s49 wants terms that limit the customer's rights drawn to their attention. */}
                    <p className="text-[13px] mt-3 mb-0 text-ink/75 leading-relaxed px-1 text-center" data-testid="pay-note">
                      Secure payment on Yoco. By paying you agree to our <a className="font-bold underline underline-offset-2" href="/terms">Terms and conditions</a>. Cancel before the Wednesday cut-off for a refund or credit; after it, or if you don't collect, you get credit (valid 6 months), not a refund. <a className="font-bold underline underline-offset-2" href="/privacy">Privacy notice</a>.
                    </p>
                  </form>
                )}
              </section>
            </div>
          </div>
        </div>

        {/* ─── 04 ABOUT: full-width cobalt band ── */}
        <section aria-labelledby="about" className="sesame text-white mt-28 lg:mt-36 py-20 lg:py-28">
          <div className={`${WRAP} grid gap-14 lg:grid-cols-[0.85fr_1.15fr] lg:items-center`}>
            <Reveal>
              <p className="eyebrow text-white/90 m-0 mb-3">04 · Our story</p>
              <h2 id="about" className="font-bubble text-[2.6rem] sm:text-6xl leading-[0.95] m-0 text-balance">
                Born on the street. Built different.
              </h2>
              <p className="text-lg leading-relaxed mt-8 mb-0 max-w-[46ch] text-white/90">
                STUFF'D started with one question: why does Cape Town not have
                a proper stuffed bagel? We took our cue from Korean street food,
                packed our bagels with cream cheese and bold fillings, and brought
                them to the streets of the Mother City.
              </p>
              <p className="text-lg leading-relaxed mt-4 mb-0 max-w-[46ch] text-white/90">
                Find the cart at markets and festivals across Cape Town. No
                tables, no reservations. Just fresh bagels, fast.
              </p>
              <p className="font-bubble text-2xl mt-8 mb-0">STUFF'D, served on repeat.</p>
            </Reveal>

            {/* Scrapbook wall: the cart, the people, the boxes. Staggered columns, taped polaroids. */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-7 sm:gap-x-5 sm:gap-y-9 px-1">
              {ABOUT_PHOTOS.map((ph, i) => (
                <Reveal key={ph.src} delay={i * 80} className={i % 3 === 1 ? "sm:translate-y-10" : ""}>
                  <Polaroid {...ph} tilt={[-3, 2.5, -1.5, 3, -2.5, 1.5, 2, -2, 1][i % 9]} />
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ─── 05 EVENTS: book the cart ──── */}
        <section aria-labelledby="events" id="book" className={`${WRAP} pt-24 lg:pt-32 scroll-mt-12`}>
          <Reveal>
            <div className="relative overflow-hidden rounded-[28px] bg-ink text-white px-6 py-12 sm:px-12 lg:px-16 lg:py-16 grid grid-cols-1 gap-10 lg:grid-cols-[1fr_1.05fr] lg:items-start">
              <div className="relative">
                <p className="eyebrow text-sky m-0 mb-3">05 · Events</p>
                <h2 id="events" className="font-bubble text-[2.4rem] sm:text-6xl leading-[0.95] m-0 text-balance">
                  Bring the cart to your event
                </h2>
                <p className="text-lg leading-relaxed text-white/90 mt-6 mb-0 max-w-[44ch]">
                  Private events, parties and festivals. Tell us the date, where
                  it is and roughly how many people, and we'll put together a
                  custom quote.
                </p>
                <img
                  src="/cart.svg"
                  alt="The STUFF'D Bagels cart"
                  width={520}
                  height={460}
                  loading="lazy"
                  className="cart-bob hidden lg:block w-full max-w-[22rem] mt-10"
                />
              </div>
              <div className="relative">
                <BookingForm />
              </div>
            </div>
          </Reveal>
        </section>

        {/* ─── 06 FAQ: chat style ──── */}
        <section aria-labelledby="faq" className={`${WRAP} py-24 lg:py-32`}>
          <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16 lg:items-start">
            <div>
              <SectionHead index="06" label="Questions" id="faq" title="Got questions?" />
              <div className="reveal -mt-4">
                <img
                  src="/mascot-drop.png"
                  alt=""
                  width={600}
                  height={600}
                  loading="lazy"
                  className="hidden lg:block w-72 object-contain"
                />
                <p className="text-ink/75 leading-relaxed mt-6 mb-0">
                  Anything else?{" "}
                  <a
                    className="font-bold text-blue underline underline-offset-4"
                    href={`mailto:${BUSINESS_EMAIL}`}
                  >
                    Email us
                  </a>
                  .
                </p>
              </div>
            </div>

            <Reveal>
              <div className="rounded-[22px] overflow-hidden shadow-soft" style={{ background: "var(--sb-chat-bg)" }}>
                <div className="flex items-center gap-3 px-5 py-3.5 border-b border-ink/10 bg-photo">
                  <div className="relative">
                    <div className="w-9 h-9 rounded-full overflow-hidden flex items-center justify-center bg-blue">
                      <span className="font-bubble text-white text-xs">S'D</span>
                    </div>
                    <div className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-chat-green border border-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm text-ink">STUFF'D Bagels</div>
                    <div className="text-[11px] text-ink/75 font-medium">Quick answers</div>
                  </div>
                </div>

                <div className="px-4 py-5 space-y-5">
                  {FAQ.map((msg, i) => (
                    <div key={i} className="space-y-1.5">
                      <div className="text-center text-[11px] text-ink/75 font-medium">{msg.time}</div>
                      <div className="flex items-end gap-2">
                        <div className="w-6 h-6 rounded-full bg-chat-avatar border border-ink/10 shrink-0 flex items-center justify-center mb-0.5">
                          <span className="text-[8px] font-black text-chat-avatar-ink">YOU</span>
                        </div>
                        <div
                          className="max-w-[78%] px-3 py-2 text-sm font-medium text-ink leading-snug"
                          style={{
                            background: "white",
                            borderRadius: "18px 18px 18px 4px",
                            boxShadow: "0 1px 1px rgba(0,0,0,0.08)",
                          }}
                        >
                          {msg.q}
                        </div>
                      </div>
                      <div className="flex justify-end">
                        <div
                          className="max-w-[78%] px-3 py-2 text-sm font-medium text-white leading-snug bg-blue"
                          style={{ borderRadius: "18px 18px 4px 18px" }}
                        >
                          {msg.a}
                        </div>
                      </div>
                    </div>
                  ))}

                  <div className="flex items-end gap-2">
                    <div className="w-6 h-6 rounded-full shrink-0 overflow-hidden border border-ink/10 flex items-center justify-center bg-blue">
                      <span className="font-bubble text-[7px] text-white">S'D</span>
                    </div>
                    <div
                      className="px-4 py-3 flex gap-1 items-center"
                      style={{
                        background: "white",
                        borderRadius: "18px 18px 18px 4px",
                        boxShadow: "0 1px 1px rgba(0,0,0,0.08)",
                      }}
                    >
                      {[0, 0.2, 0.4].map((delay, i) => (
                        <div
                          key={i}
                          className="typing-dot w-2 h-2 rounded-full bg-chat-gray"
                          style={{ animation: `bounce 1.2s ${delay}s infinite` }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </section>
        {/* ─── INSTAGRAM STRIP: their feed, edge to edge ──── */}
        <section aria-labelledby="insta">
          <div className={`${WRAP} reveal flex flex-wrap items-end justify-between gap-x-8 gap-y-3 mb-8`}>
            <div>
              <p className="eyebrow text-blue m-0 mb-3">On Instagram</p>
              <h2 id="insta" className="font-bubble text-[2.2rem] sm:text-5xl leading-[0.95] m-0 text-ink">
                Tag us @stuffd.bagels
              </h2>
            </div>
            <a
              href="https://instagram.com/stuffd.bagels"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center min-h-11 font-bold text-blue underline underline-offset-4 decoration-1 decoration-blue/40 hover:decoration-blue"
            >
              Follow on Instagram
            </a>
          </div>
          <a
            href="https://instagram.com/stuffd.bagels"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="@stuffd.bagels: see more of STUFF'D Bagels on Instagram"
            className="group grid grid-cols-3 lg:grid-cols-6"
          >
            {FEED.map((f) => (
              <span key={f.src} className="relative block overflow-hidden aspect-square">
                <img
                  src={f.src}
                  alt={f.alt}
                  width={600}
                  height={600}
                  loading="lazy"
                  decoding="async"
                  className="block w-full h-full object-cover transition-transform duration-700 ease-out hover:scale-[1.06]"
                />
              </span>
            ))}
            <span className="sesame relative flex flex-col items-center justify-center gap-2 aspect-square text-white text-center p-3">
              <svg aria-hidden="true" className="w-8 h-8 sm:w-10 sm:h-10" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
              </svg>
              <span className="font-bubble text-lg sm:text-2xl leading-tight">@stuffd.bagels</span>
            </span>
          </a>
        </section>
      </main>

      {/* FOOTER */}
      <footer className="bg-ink text-paper relative overflow-hidden pb-20 lg:pb-0">
        <div className={`${WRAP} py-14 grid grid-cols-1 sm:grid-cols-3 gap-10 items-start`}>
          <div className="flex flex-col items-center sm:items-start gap-2">
            <img
              src="/logo-white.svg"
              alt="STUFF'D Bagels"
              width={967}
              height={369}
              loading="lazy"
              className="w-56 h-auto"
            />
            <p className="font-medium text-sky text-base mt-3 text-center sm:text-left">
              When hunger calls, it&apos;s time to get STUFF&apos;D.
            </p>
          </div>

          <div className="flex flex-col items-center sm:items-start gap-3">
            <div className="eyebrow mb-1 text-sky">Get in touch</div>
            <a href={`mailto:${BUSINESS_EMAIL}`} className="text-paper/90 hover:text-white text-sm transition-colors">
              stuffd.bagels@gmail.com
            </a>
            <div className="text-paper/90 text-sm mt-1">Cape Town, South Africa</div>
          </div>

          <div className="flex flex-col items-center sm:items-start gap-3">
            <div className="eyebrow mb-1 text-sky">Follow us</div>
            <a
              href="https://instagram.com/stuffd.bagels"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-paper/90 hover:text-white text-sm transition-colors"
            >
              <svg aria-hidden="true" className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
              </svg>
              @stuffd.bagels
            </a>
            <a
              href="https://tiktok.com/@stuffd.bagels"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-paper/90 hover:text-white text-sm transition-colors"
            >
              <svg aria-hidden="true" className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.18 8.18 0 004.78 1.52V6.76a4.85 4.85 0 01-1.01-.07z" />
              </svg>
              @stuffd.bagels
            </a>
          </div>
        </div>

        <div className="border-t border-paper/15 py-4 px-6 lg:px-10 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs">
          <div className="text-paper/90 tracking-widest uppercase">
            © 2026 Stuff'd Bagels · Cape Town · <a href="/privacy" className="underline underline-offset-4 hover:text-white">Privacy</a>
          </div>
          <a
            href="https://digitalpantry.co.za"
            target="_blank"
            rel="noopener"
            className="text-paper/90 hover:text-white transition-colors"
          >
            Website by Digital Pantry
          </a>
        </div>
      </footer>

      {/* MOBILE ORDER BAR: shows once something is picked, hides when the form is on screen */}
      {itemCount > 0 && !detailsInView && !orderingHidden && (
        <aside
          aria-label="Your order so far"
          data-testid="order-bar"
          className="order-bar lg:hidden fixed inset-x-3 z-30 mx-auto max-w-md"
          style={{ bottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          <a
            href="#order-form"
            className="flex items-center justify-between rounded-full border-2 border-ink bg-blue text-white pl-5 pr-2 py-2"
            style={{ boxShadow: "0 5px 0 var(--sb-ink)" }}
          >
            <span className="font-black text-sm tracking-widest uppercase">
              {itemCount} bagel{itemCount !== 1 ? "s" : ""} · R{total}
            </span>
            <span className="rounded-full bg-photo text-ink font-black text-sm uppercase tracking-widest px-4 py-2">
              Checkout
            </span>
          </a>
        </aside>
      )}
    </div>
  );
}
