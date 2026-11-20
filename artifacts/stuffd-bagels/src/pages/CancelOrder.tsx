// "Cancel my order": where the signed link in the confirmation email lands (/order/cancel#<token>). Automatic refunds, founder 2026-11-19.
// Opening this page only READS: it asks the Worker what state the order is in and changes nothing, so an email scanner or a curious
// click can't cancel anything. Cancelling is a button press (a POST with a Turnstile token) and the Worker re-checks the cut-off itself.
// The token sits after the # so it is never sent to a server in a URL or a Referer; the page sends it in a POST body.
// The amount shown comes from the Worker. The browser never sends an amount.
import { useCallback, useEffect, useState } from "react";
import { CANCELLATION_POLICY, niceDay } from "@/collection";
import { ResultShell, resultBtn, shopMail } from "@/components/result-shell";
import { TURNSTILE_WAIT_MESSAGE, TurnstileBox, useTurnstile } from "@/components/turnstile";

const TOKEN = /^SB-[A-Z2-9]{6}\.\d{9,12}\.[A-Za-z0-9_-]{43}$/;

type Phase = "loading" | "invalid" | "open" | "working" | "refunded" | "pending" | "failed" | "busy" | "closed" | "unknown" | "limited" | "error";
interface Info {
  ref: string;
  total: number | null;
  pickupDate: string | null;
  cancelBy: string | null;
  retry: boolean;
}

const money = (n: number | null) => (n === null ? "" : `R${n}`);

export default function CancelOrder() {
  const [token, setToken] = useState<string | null>(null); // null until the page is running in the browser (the prerendered HTML has no hash)
  const [phase, setPhase] = useState<Phase>("loading");
  const [info, setInfo] = useState<Info>({ ref: "", total: null, pickupDate: null, cancelBy: null, retry: false });
  const [problem, setProblem] = useState("");
  const ts = useTurnstile("cancel", phase === "open" || phase === "working" || phase === "failed");

  // Read the link once the page runs in the browser, and again if only the # part changes (someone pastes a different link into the same tab).
  useEffect(() => {
    const read = () => {
      const raw = window.location.hash.replace(/^#/, "");
      const good = TOKEN.test(raw);
      setProblem("");
      setPhase(good ? "loading" : "invalid");
      setToken(good ? raw : "");
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  const post = useCallback(async (path: string, body: Record<string, unknown>) => {
    try {
      const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      return { status: res.status, data: data as Record<string, unknown> };
    } catch {
      return { status: 0, data: {} as Record<string, unknown> };
    }
  }, []);

  const apply = useCallback((data: Record<string, unknown>) => {
    const state = typeof data.state === "string" ? data.state : "";
    setInfo((i) => ({
      ref: typeof data.ref === "string" ? data.ref : i.ref,
      total: typeof data.total === "number" ? data.total : i.total,
      pickupDate: typeof data.pickupDate === "string" ? data.pickupDate : i.pickupDate,
      cancelBy: typeof data.cancelBy === "string" ? data.cancelBy : i.cancelBy,
      retry: data.retry === true,
    }));
    const known: Phase[] = ["open", "refunded", "pending", "failed", "busy", "closed", "unknown"];
    setPhase((known as string[]).includes(state) ? (state as Phase) : "error");
  }, []);

  // Ask what state the order is in (read only).
  useEffect(() => {
    if (!token) return; // null: not read yet; "": no valid link (read() has already said so)
    let stop = false;
    (async () => {
      const r = await post("/api/order/cancel/check", { token });
      if (stop) return;
      if (r.status === 400 || r.status === 403) setPhase("invalid");
      else if (r.status === 429) setPhase("limited");
      else if (r.status === 200) apply(r.data);
      else setPhase("error");
    })();
    return () => {
      stop = true;
    };
  }, [token, post, apply]);

  const cancel = async () => {
    if (!token || phase === "working") return;
    setProblem("");
    setPhase("working");
    const turnstileToken = await ts.getToken();
    if (!turnstileToken) {
      setProblem(TURNSTILE_WAIT_MESSAGE);
      setPhase(info.retry ? "failed" : "open");
      return;
    }
    const r = await post("/api/order/cancel", { token, turnstileToken });
    ts.reset(); // a Turnstile token works once
    if (r.status === 200) return apply(r.data);
    if (r.status === 429) setProblem("That's a few too many tries. Please wait a little and try again.");
    else if (r.status === 403) setProblem("We couldn't confirm the security check. Please try again.");
    else if (r.status === 400) return setPhase("invalid");
    else setProblem(typeof r.data.error === "string" ? r.data.error : "Something went wrong. Nothing has been refunded yet. Please try again, or email us.");
    setPhase(info.retry ? "failed" : "open");
  };

  const ref = info.ref;
  const refLine = ref ? <> Your reference is <strong>{ref}</strong>.</> : null;
  const home = <a href="/" className={resultBtn}>Back to the menu</a>;
  const T = "Cancel my order";

  if (token === null || phase === "loading") {
    return (
      <ResultShell testId="loading" title={T}>
        <p className="m-0 text-base">Checking your order...</p>
      </ResultShell>
    );
  }

  if (phase === "invalid") {
    return (
      <ResultShell testId="invalid" title={T}>
        <p className="eyebrow m-0 text-blue">Link not valid</p>
        <p className="text-base leading-relaxed mt-3 mb-0">This link isn't valid. Please use the link in your confirmation email, or email {shopMail("")} with your order reference and we'll help.</p>
        {home}
      </ResultShell>
    );
  }

  if (phase === "closed") {
    return (
      <ResultShell testId="closed" title={T}>
        <p className="eyebrow m-0 text-blue">Cut-off passed</p>
        <h2 className="font-bubble text-4xl leading-none m-0 mt-3">We can't refund this one</h2>
        <p className="text-base leading-relaxed mt-4 mb-0">The Wednesday cut-off for your order has passed, so we can't refund it.{refLine}</p>
        <p className="text-base leading-relaxed mt-3 mb-0" data-testid="cancel-policy">{CANCELLATION_POLICY}</p>
        <p className="text-base leading-relaxed mt-3 mb-0">
          To use your credit, email {shopMail(ref)} with your reference and tell us which Saturday or market you would like.
        </p>
        {home}
      </ResultShell>
    );
  }

  if (phase === "refunded" || phase === "pending") {
    const done = phase === "refunded";
    return (
      <ResultShell testId={phase} title={T}>
        <p className="eyebrow m-0 text-blue">Order cancelled</p>
        <h2 className="font-bubble text-4xl leading-none m-0 mt-3">{done ? "Refund processed" : "Refund on its way"}</h2>
        <p className="text-base leading-relaxed mt-4 mb-0">
          {done
            ? `Your order is cancelled and your refund${info.total !== null ? ` of ${money(info.total)}` : ""} has been processed through Yoco, back to the card you paid with.`
            : `Your order is cancelled. Yoco is processing your refund${info.total !== null ? ` of ${money(info.total)}` : ""} to the card you paid with.`}
        </p>
        <p className="text-sm text-ink/75 leading-relaxed mt-3 mb-0">
          We've emailed you a confirmation.{refLine} It can take a few days to show on your statement, depending on your bank.
        </p>
        {home}
      </ResultShell>
    );
  }

  if (phase === "busy") {
    return (
      <ResultShell testId="busy" title={T}>
        <p className="eyebrow m-0 text-blue">Working on it</p>
        <h2 className="font-bubble text-4xl leading-none m-0 mt-3">Your refund is being processed</h2>
        <p className="text-base leading-relaxed mt-4 mb-0">Please don't press anything again. You'll get an email in a few minutes.{refLine}</p>
        {home}
      </ResultShell>
    );
  }

  if (phase === "unknown") {
    return (
      <ResultShell testId="unknown" title={T}>
        <p className="eyebrow m-0 text-blue">Your order</p>
        <p className="text-base leading-relaxed mt-3 mb-0">We can't find that order. Please email {shopMail(ref)} with your reference and we'll sort it out.</p>
        {home}
      </ResultShell>
    );
  }

  if (phase === "limited" || phase === "error") {
    return (
      <ResultShell testId={phase} title={T}>
        <p className="eyebrow m-0 text-blue">Please try again</p>
        <p className="text-base leading-relaxed mt-3 mb-0">
          {phase === "limited" ? "That's a few too many tries. Please wait a little and open the link again." : "We couldn't check your order just now. Please try again in a minute, or email "}
          {phase === "error" ? shopMail(ref) : null}
        </p>
        {home}
      </ResultShell>
    );
  }

  // open, working, failed: the confirm page
  const failed = phase === "failed";
  return (
    <ResultShell testId={failed ? "failed" : "open"} title={T}>
      {failed ? (
        <>
          <p className="eyebrow m-0 text-blue">We've got your cancellation</p>
          <h2 className="font-bubble text-4xl leading-none m-0 mt-3">Refund not finished yet</h2>
          <p className="text-base leading-relaxed mt-4 mb-0">
            Your order is cancelled, but we couldn't finish your refund automatically. We've been told and we will sort it out, so you don't need to do anything.{refLine}
          </p>
          <p className="text-sm text-ink/75 leading-relaxed mt-3 mb-0">You can also press the button below to try again. You can't be refunded twice.</p>
        </>
      ) : (
        <>
          <p className="eyebrow m-0 text-blue">Order {ref}</p>
          <h2 className="font-bubble text-4xl leading-none m-0 mt-3">Cancel your order?</h2>
          <p className="text-base leading-relaxed mt-4 mb-0" data-testid="cancel-summary">
            You paid <strong>{money(info.total)}</strong>
            {info.pickupDate ? <> for collection on <strong>{niceDay(info.pickupDate)}</strong></> : null}.
          </p>
          <p className="text-base leading-relaxed mt-3 mb-0">
            You can cancel until <strong>{info.cancelBy}</strong>. We'll refund the full {money(info.total)} to the card you paid with, through Yoco. It can take a few days to show on your statement, depending on your bank.
          </p>
          <p className="text-sm text-ink/75 leading-relaxed mt-3 mb-0">
            Would you rather have credit for another collection Saturday or one of our markets? Don't cancel here. Email {shopMail(ref)} with your reference and tell us which one.
          </p>
        </>
      )}
      <TurnstileBox handle={ts} className="mt-5" />
      {problem && (
        <p role="alert" data-testid="cancel-problem" className="text-sm font-bold text-red-700 leading-relaxed mt-4 mb-0">
          {problem}
        </p>
      )}
      <button
        type="button"
        onClick={cancel}
        disabled={phase === "working"}
        aria-busy={phase === "working"}
        data-testid="cancel-confirm"
        className="mt-5 w-full rounded-full text-white border-2 border-ink bg-blue p-4 uppercase tracking-widest transition-transform duration-200 hover:-translate-y-0.5 active:translate-y-0.5 font-bebas disabled:cursor-wait disabled:opacity-80"
        style={{ fontSize: "1.3rem", letterSpacing: "0.12em", boxShadow: "0 5px 0 var(--sb-ink)" }}
      >
        {phase === "working" ? "Cancelling..." : failed ? "Try again" : `Yes, cancel and refund ${money(info.total)}`}
      </button>
      <p className="text-center mt-4 mb-0">
        <a href="/" data-testid="cancel-keep" className="font-bold text-blue underline underline-offset-4">No, keep my order</a>
      </p>
    </ResultShell>
  );
}
