// Terms and conditions for online orders. DRAFT for dp-counsel and the client to confirm (CPA s17 and s49, ECT Act s43):
// see ops/inbox.md. Plain words on purpose. Founder 2026-11-19: the long paragraphs under the order form moved here.
import { CANCELLATION_POLICY, DEFAULT_CUTOFF } from "@/collection";

const EMAIL = "stuffd.bagels@gmail.com";

export default function Terms() {
  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="bg-blue text-white">
        <div className="max-w-3xl mx-auto px-5 sm:px-8 py-10">
          <a href="/" className="eyebrow text-white underline underline-offset-4">Back to the menu</a>
          <h1 className="font-bubble text-5xl sm:text-6xl leading-[0.95] m-0 mt-5">Terms and conditions</h1>
          <p className="m-0 mt-4 text-white/90 text-lg">The short version of how ordering from STUFF'D Bagels works.</p>
        </div>
      </div>
      <div className="max-w-3xl mx-auto px-5 sm:px-8 py-12 leading-relaxed text-base [&_h2]:font-bubble [&_h2]:text-3xl [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:leading-none [&_ul]:pl-5 [&_li]:mt-1.5 [&_a]:font-bold [&_a]:text-blue [&_a]:underline [&_a]:underline-offset-4">
        <p className="m-0">Last updated 19 November 2026.</p>

        <h2>Ordering</h2>
        <ul className="m-0">
          <li>We bake for one collection Saturday a month. Orders for it open on the 15th of the month.</li>
          <li>Order by Wednesday {DEFAULT_CUTOFF} before that Saturday. After that, orders for that Saturday close.</li>
          <li>Prices are in rand and are the prices shown on the site when you order.</li>
        </ul>

        <h2>Paying</h2>
        <ul className="m-0">
          <li>You pay online with Yoco when you place your order. Your card details go to Yoco, never to us.</li>
          <li>Once you press the pay button you have 30 minutes to pay. An unpaid order isn't kept.</li>
          <li>Your order is confirmed as soon as it's paid, and we email you a confirmation.</li>
        </ul>

        <h2>Collecting</h2>
        <ul className="m-0">
          <li>Collect your order at the pickup point, on the Saturday and within the hours shown when you ordered.</li>
          <li>Your preferred time helps us plan, but it isn't a fixed appointment.</li>
        </ul>

        <h2>Cancelling and missed collections</h2>
        <p className="m-0">{CANCELLATION_POLICY}</p>
        <p className="m-0 mt-3">To cancel or use your credit, email <a href={`mailto:${EMAIL}`}>{EMAIL}</a> with your order reference.</p>

        <h2>Your details</h2>
        <p className="m-0">How we use your name, phone and email is in our <a href="/privacy">Privacy notice</a>.</p>

        <h2>Questions</h2>
        <p className="m-0">STUFF'D Bagels, Cape Town. Email <a href={`mailto:${EMAIL}`}>{EMAIL}</a>.</p>
      </div>
    </main>
  );
}
