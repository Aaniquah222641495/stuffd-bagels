// Privacy notice (POPIA section 18). Updated by dp-counsel 2026-11-19 for Yoco payments and the pickup-day reminder; client to confirm.
// Plain words on purpose. Update it whenever the forms collect something new (for example the Yoco payment step).
const EMAIL = "stuffd.bagels@gmail.com";

export default function Privacy() {
  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="bg-blue text-white">
        <div className="max-w-3xl mx-auto px-5 sm:px-8 py-10">
          <a href="/" className="eyebrow text-white underline underline-offset-4">Back to the menu</a>
          <h1 className="font-bubble text-5xl sm:text-6xl leading-[0.95] m-0 mt-5">Privacy notice</h1>
          <p className="m-0 mt-4 text-white/90 text-lg">How STUFF'D Bagels looks after the details you give us.</p>
        </div>
      </div>
      <div className="max-w-3xl mx-auto px-5 sm:px-8 py-12 leading-relaxed text-base [&_h2]:font-bubble [&_h2]:text-3xl [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:leading-none [&_ul]:pl-5 [&_li]:mt-1.5 [&_a]:font-bold [&_a]:text-blue [&_a]:underline [&_a]:underline-offset-4">
        <p className="m-0">Last updated 19 November 2026.</p>

        <h2>Who we are</h2>
        <p className="m-0">STUFF'D Bagels, Cape Town. We are the "responsible party" under the Protection of Personal Information Act (POPIA). Contact us at <a href={`mailto:${EMAIL}`}>{EMAIL}</a>.</p>

        <h2>What we collect, and why</h2>
        <p className="m-0">We only ask for what we need.</p>
        <ul className="m-0 mt-3">
          <li><strong>When you send an order:</strong> your name, phone number, email address, the pickup point and Saturday you'll collect on, an optional preferred time, what you ordered, and an optional note. We use it to take your payment, prepare your order, email you your confirmation and a reminder on the morning of your collection day, and contact you if there's a problem.</li>
          <li><strong>When you send an event enquiry:</strong> your name, phone number, email address, the event date, venue or area, number of guests, and any details you add. We use it to reply with a quote.</li>
        </ul>
        <p className="m-0 mt-3">We don't use your details for marketing, and we don't sell or share them.</p>

        <h2>Who sees it</h2>
        <p className="m-0">Only the people who run STUFF'D Bagels. Your order or enquiry arrives as an email in the STUFF'D Bagels Gmail account, and we send your confirmation from that account. Google provides that email service for us, and it may store data on servers outside South Africa. The website itself runs on Cloudflare. It passes event enquiries straight to that email account and does not keep them. While you pay for an order, the website holds your order details for a short time so it can confirm the order once Yoco tells us the payment went through. Your personal details are deleted from the website as soon as the order emails are sent (and an order that is never paid is deleted within 48 hours). For the collection-day reminder, a small copy of your order (your first name, email address, pickup details and what you ordered) is kept in the STUFF'D Bagels Google account until the morning of your collection, then deleted. To stop spam we keep a short-lived counter linked to a scrambled version of your internet address, never your name or order. It deletes itself within a day.</p>

        <h2>How long we keep it</h2>
        <p className="m-0">We keep order and enquiry emails for as long as we need them to run the business and keep our records, and then delete them.</p>

        <h2>Your rights</h2>
        <p className="m-0">You can ask us what we hold about you, ask us to correct it, or ask us to delete it. Email <a href={`mailto:${EMAIL}`}>{EMAIL}</a>. If you're unhappy with how we've handled your information you can complain to the <a href="https://inforegulator.org.za" rel="noopener noreferrer" target="_blank">Information Regulator</a>.</p>

        <h2>Payment</h2>
        <p className="m-0">You pay for orders on Yoco's secure payment page. Yoco handles your card details; we never see or store them, and nor does this website. We only send Yoco your order reference and what you ordered, and Yoco tells us whether the payment went through. Yoco's own privacy policy covers what you enter on its page. Orders are confirmed once they are paid.</p>
      </div>
    </main>
  );
}
