// The card layout shared by the pages a customer lands on from outside the site: /order/result (back from Yoco) and /order/cancel (from the
// confirmation email). Same blue header, same card, so both read as one service.
export const SHOP_EMAIL = "stuffd.bagels@gmail.com";

export function ResultShell({ children, testId, title = "Your order" }: { children: React.ReactNode; testId: string; title?: string }) {
  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="bg-blue text-white">
        <div className="max-w-3xl mx-auto px-5 sm:px-8 py-10">
          <a href="/" className="eyebrow text-white underline underline-offset-4">Back to the menu</a>
          <h1 className="font-bubble text-5xl sm:text-6xl leading-[0.95] m-0 mt-5">{title}</h1>
        </div>
      </div>
      <div className="max-w-3xl mx-auto px-5 sm:px-8 py-12">
        <div role="status" aria-live="polite" data-testid="result-card" data-state={testId} className="rounded-[22px] bg-photo shadow-soft p-7 sm:p-9">
          {children}
        </div>
      </div>
    </main>
  );
}

export const resultBtn =
  "inline-block mt-6 rounded-full border-2 border-ink px-6 py-3 font-black uppercase tracking-widest text-sm text-ink no-underline transition-transform duration-200 hover:-translate-y-0.5 active:translate-y-0.5";

/** A mailto link to the shop, with the order reference in the subject when we have one. */
export const shopMail = (ref: string) => (
  <a className="font-bold text-blue underline underline-offset-4" href={`mailto:${SHOP_EMAIL}${ref ? `?subject=${encodeURIComponent("Order " + ref)}` : ""}`}>{SHOP_EMAIL}</a>
);
