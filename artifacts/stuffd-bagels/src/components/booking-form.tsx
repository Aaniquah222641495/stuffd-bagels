// "Bring the cart to your event": the booking enquiry form. Posts to /api/booking, which emails
// the owner (label "Bookings") and sends the customer an automatic reply. Enquiries are not paid.
import { useEffect, useState } from "react";
import {
  FieldRow,
  Honeypot,
  PrivacyNote,
  failureMessage,
  inputClass,
  looksLikeEmail,
  looksLikePhone,
  postForm,
  type Status,
} from "@/components/order-forms";

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const prettyDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

export function BookingForm() {
  const [f, setF] = useState({ name: "", phone: "", email: "", eventDate: "", venue: "", guests: "", details: "", website: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Status>("idle");
  const [problem, setProblem] = useState("");
  const [focusTick, setFocusTick] = useState(0);
  const [ref, setRef] = useState("");
  const set = (k: keyof typeof f) => (v: string) => {
    setF((p) => ({ ...p, [k]: v }));
    // Editing a field clears its own error straight away.
    setErrors((p) => {
      if (!p[k]) return p;
      const { [k]: _gone, ...rest } = p;
      return rest;
    });
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!f.name.trim()) e.name = "Please add your name.";
    if (!looksLikePhone(f.phone)) e.phone = "Add a phone number we can call, like 082 123 4567.";
    if (!looksLikeEmail(f.email)) e.email = "Add an email address so we can reply.";
    if (!f.eventDate || f.eventDate < todayIso()) e.eventDate = "Choose the date of your event (today or later).";
    if (!f.venue.trim()) e.venue = "Tell us the venue or area.";
    const g = Number(f.guests);
    if (!Number.isInteger(g) || g < 1 || g > 5000) e.guests = "Roughly how many guests? A whole number, 1 to 5000.";
    return e;
  };

  useEffect(() => {
    if (focusTick === 0) return;
    document.getElementById("booking-form")?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
  }, [focusTick]);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (status === "sending") return;
    const e = validate();
    setErrors(e);
    setProblem("");
    if (Object.keys(e).length) {
      setFocusTick((n) => n + 1); // the effect above focuses the first error once it is on screen
      return;
    }
    setStatus("sending");
    const r = await postForm("/api/booking", { ...f, guests: Number(f.guests) });
    if (r.ok) {
      setRef(r.data?.ref ?? "");
      setStatus("sent");
    } else {
      setProblem(failureMessage(r));
      setStatus("idle");
    }
  };

  if (status === "sent") {
    return (
      <div
        ref={(el) => el?.focus()}
        tabIndex={-1}
        role="status"
        data-testid="booking-sent"
        className="rounded-[22px] bg-photo text-ink p-7 sm:p-9 shadow-soft outline-none"
      >
        <p className="eyebrow m-0 text-blue">Enquiry sent</p>
        <h3 className="font-bubble text-4xl leading-none m-0 mt-3">Thanks, {f.name.trim().split(" ")[0]}!</h3>
        <p className="text-lg leading-relaxed mt-4 mb-0">
          We've got your event enquiry for <strong>{prettyDate(f.eventDate)}</strong>. We'll look at it and come back to you
          with a quote. Nothing is booked until we confirm.
        </p>
        <p className="text-sm text-ink/75 leading-relaxed mt-4 mb-0">
          We've emailed a copy to <strong>{f.email.trim()}</strong>. If you can't see it, check your spam folder.
          {ref && <> Your reference is <strong>{ref}</strong>.</>}
        </p>
      </div>
    );
  }

  return (
    <form id="booking-form" onSubmit={submit} noValidate aria-label="Event booking enquiry" data-testid="booking-form">
      <div className="relative rounded-[22px] bg-photo text-ink shadow-soft divide-y divide-ink/10 overflow-hidden">
        <Honeypot value={f.website} onChange={set("website")} />
        <FieldRow label="Your name" error={errors.name}>
          {(p) => (
            <input id={p.id} name="name" autoComplete="name" aria-invalid={p.invalid} aria-describedby={p.describedBy} maxLength={60}
              value={f.name} onChange={(e) => set("name")(e.target.value)} placeholder="Your name" className={inputClass} data-testid="booking-name" />
          )}
        </FieldRow>
        <FieldRow label="Phone" error={errors.phone}>
          {(p) => (
            <input id={p.id} name="tel" type="tel" autoComplete="tel" aria-invalid={p.invalid} aria-describedby={p.describedBy} maxLength={20}
              value={f.phone} onChange={(e) => set("phone")(e.target.value)} placeholder="082 123 4567" className={inputClass} data-testid="booking-phone" />
          )}
        </FieldRow>
        <FieldRow label="Email" error={errors.email}>
          {(p) => (
            <input id={p.id} name="email" type="email" autoComplete="email" aria-invalid={p.invalid} aria-describedby={p.describedBy} maxLength={254}
              value={f.email} onChange={(e) => set("email")(e.target.value)} placeholder="you@example.com" className={inputClass} data-testid="booking-email" />
          )}
        </FieldRow>
        <FieldRow label="Event date" error={errors.eventDate}>
          {(p) => (
            <input id={p.id} name="eventDate" type="date" min={todayIso()} aria-invalid={p.invalid} aria-describedby={p.describedBy}
              value={f.eventDate} onChange={(e) => set("eventDate")(e.target.value)} className={inputClass} data-testid="booking-date" />
          )}
        </FieldRow>
        <FieldRow label="Venue or area" error={errors.venue}>
          {(p) => (
            <input id={p.id} name="venue" aria-invalid={p.invalid} aria-describedby={p.describedBy} maxLength={120}
              value={f.venue} onChange={(e) => set("venue")(e.target.value)} placeholder="Where is it?" className={inputClass} data-testid="booking-venue" />
          )}
        </FieldRow>
        <FieldRow label="Roughly how many guests" error={errors.guests}>
          {(p) => (
            <input id={p.id} name="guests" type="number" inputMode="numeric" min={1} max={5000} aria-invalid={p.invalid} aria-describedby={p.describedBy}
              value={f.guests} onChange={(e) => set("guests")(e.target.value)} placeholder="e.g. 80" className={inputClass} data-testid="booking-guests" />
          )}
        </FieldRow>
        <FieldRow label="Anything else? (optional)">
          {(p) => (
            <textarea id={p.id} name="details" rows={3} maxLength={1000} value={f.details} onChange={(e) => set("details")(e.target.value)}
              placeholder="Type of event, start and end time, anything we should know." className={`${inputClass} resize-none`} data-testid="booking-details" />
          )}
        </FieldRow>
      </div>

      <PrivacyNote onDark what="We use your name, phone and email only to reply to this enquiry." />

      {problem && (
        <p role="alert" className="mt-4 rounded-2xl px-4 py-3 text-sm font-bold bg-white text-error m-0">
          {problem}
        </p>
      )}
      <button
        type="submit"
        disabled={status === "sending"}
        data-testid="booking-submit"
        className="mt-5 w-full sm:w-auto rounded-full border-2 border-white bg-photo text-blue px-10 py-3.5 font-black uppercase tracking-widest text-sm transition-transform duration-200 hover:-translate-y-0.5 active:translate-y-0.5 disabled:opacity-70 disabled:cursor-wait"
        style={{ boxShadow: "0 5px 0 var(--sb-blue)" }}
      >
        {status === "sending" ? "Sending..." : "Send enquiry"}
      </button>
    </form>
  );
}
