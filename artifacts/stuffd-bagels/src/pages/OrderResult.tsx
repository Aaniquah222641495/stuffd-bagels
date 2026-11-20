// Where Yoco sends the customer back to (/order/result?r=success|cancel|failure&ref=SB-XXXXXX). ADR-0041.
// Never says "confirmed" because of the redirect alone: only the server's status (set by Yoco's signed webhook) does.
import { useEffect, useState } from "react";
import { DRAFT_KEY } from "@/components/order-forms";
import { ResultShell, resultBtn, shopMail } from "@/components/result-shell";

const REF = /^SB-[A-Z2-9]{6}$/;
const POLL_MS = 2000;
const POLL_FOR_MS = 30000;

type Kind = "success" | "cancel" | "failure" | "unknown";
type Phase = "loading" | "confirming" | "confirmed" | "slow" | "expired" | "notfound";

const Shell = ResultShell;
const btn = resultBtn;
const mail = shopMail;

export default function OrderResult() {
  const [kind, setKind] = useState<Kind | null>(null); // null until the page is running in the browser (the prerendered HTML has no query string)
  const [ref, setRef] = useState("");
  const [phase, setPhase] = useState<Phase>("loading");

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const r = q.get("r");
    setKind(r === "success" || r === "cancel" || r === "failure" ? r : "unknown");
    const given = q.get("ref") ?? "";
    setRef(REF.test(given) ? given : "");
  }, []);

  // success: ask the server every 2 s for up to 30 s whether Yoco's notice has arrived.
  useEffect(() => {
    if (kind !== "success") return;
    if (!ref) {
      setPhase("notfound");
      return;
    }
    setPhase("confirming");
    let stop = false;
    const started = Date.now();
    const tick = async () => {
      if (stop) return;
      let status = "pending";
      try {
        const res = await fetch(`/api/order/status?ref=${encodeURIComponent(ref)}`, { cache: "no-store" });
        if (res.ok) status = (await res.json()).status;
        else status = "slow"; // 429 / 503: stop asking, say it is still being confirmed
      } catch {
        status = "slow";
      }
      if (stop) return;
      if (status === "paid") {
        try {
          sessionStorage.removeItem(DRAFT_KEY);
        } catch {
          /* ignore */
        }
        setPhase("confirmed");
      } else if (status === "expired") setPhase("expired");
      else if (status === "unknown") setPhase("notfound");
      else if (status === "slow" || Date.now() - started >= POLL_FOR_MS) setPhase("slow");
      else setTimeout(tick, POLL_MS);
    };
    const first = setTimeout(tick, 600);
    return () => {
      stop = true;
      clearTimeout(first);
    };
  }, [kind, ref]);

  if (kind === null) {
    return (
      <Shell testId="loading">
        <p className="m-0 text-base">Checking your order...</p>
      </Shell>
    );
  }

  if (kind === "cancel" || kind === "failure") {
    return (
      <Shell testId={kind}>
        <p className="eyebrow m-0 text-blue">{kind === "cancel" ? "Payment cancelled" : "Payment didn't go through"}</p>
        <h2 className="font-bubble text-4xl leading-none m-0 mt-3">{kind === "cancel" ? "No payment taken" : "Let's try again"}</h2>
        <p className="text-base leading-relaxed mt-4 mb-0">
          {kind === "cancel"
            ? "Payment cancelled. Your order isn't placed and you haven't paid."
            : "Your payment didn't go through, so your order isn't placed. Try again or use another card."}
        </p>
        {kind === "failure" && (
          <p className="text-sm text-ink/75 leading-relaxed mt-3 mb-0">
            If your bank shows a charge, email {mail(ref)}{ref ? <> with reference <strong>{ref}</strong></> : null}.
          </p>
        )}
        <a href="/#order" className={btn} data-testid="back-to-order">Back to my order</a>
      </Shell>
    );
  }

  if (kind === "unknown") {
    return (
      <Shell testId="unknown">
        <p className="eyebrow m-0 text-blue">Your order</p>
        <p className="text-base leading-relaxed mt-3 mb-0">We can't tell which order this is. If you paid and haven't had an email, write to {mail(ref)}.</p>
        <a href="/" className={btn}>Back to the menu</a>
      </Shell>
    );
  }

  // success
  if (phase === "confirmed") {
    return (
      <Shell testId="confirmed">
        <p className="eyebrow m-0 text-blue">Order confirmed</p>
        <h2 className="font-bubble text-4xl leading-none m-0 mt-3">We've got it!</h2>
        <p className="text-base leading-relaxed mt-4 mb-0">Order confirmed. Your confirmation email is on its way.</p>
        <p className="text-sm text-ink/75 leading-relaxed mt-3 mb-0">Your reference is <strong>{ref}</strong>. Check your spam folder if you can't see the email.</p>
        <a href="/" className={btn}>Back to the menu</a>
      </Shell>
    );
  }
  if (phase === "slow") {
    return (
      <Shell testId="slow">
        <p className="eyebrow m-0 text-blue">Still confirming</p>
        <h2 className="font-bubble text-4xl leading-none m-0 mt-3">Thanks!</h2>
        <p className="text-base leading-relaxed mt-4 mb-0">
          Your payment is still being confirmed. You'll get an email when it is. Nothing in 15 minutes? Email {mail(ref)} with reference <strong>{ref}</strong>.
        </p>
        <a href="/" className={btn}>Back to the menu</a>
      </Shell>
    );
  }
  if (phase === "expired") {
    return (
      <Shell testId="expired">
        <p className="eyebrow m-0 text-blue">Not paid in time</p>
        <p className="text-base leading-relaxed mt-3 mb-0">This order wasn't paid in time, so it isn't placed. If you did pay, email {mail(ref)} with reference <strong>{ref}</strong>.</p>
        <a href="/#order" className={btn}>Start again</a>
      </Shell>
    );
  }
  if (phase === "notfound") {
    return (
      <Shell testId="notfound">
        <p className="eyebrow m-0 text-blue">Your order</p>
        <p className="text-base leading-relaxed mt-3 mb-0">We can't find that order. If you paid, email {mail(ref)}{ref ? <> with reference <strong>{ref}</strong></> : null}.</p>
        <a href="/" className={btn}>Back to the menu</a>
      </Shell>
    );
  }
  return (
    <Shell testId="confirming">
      <p className="eyebrow m-0 text-blue">Payment received?</p>
      <h2 className="font-bubble text-4xl leading-none m-0 mt-3">Thanks!</h2>
      <p className="text-base leading-relaxed mt-4 mb-0">We're confirming your payment. This usually takes a few seconds.</p>
    </Shell>
  );
}
