// Privacy notice (POPIA section 18). Wording by dp-counsel 2026-11-19 (counsel-review s3); supplier details from the client, 2026-11-19.
// Plain words on purpose. Update it whenever the forms collect something new (for example the Yoco payment step).
const EMAIL = "stuffd.bagels@gmail.com";

export default function Privacy() {
  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="bg-blue text-white">
        <div className="max-w-3xl mx-auto px-5 sm:px-8 py-10">
          <a href="/" className="eyebrow text-white underline underline-offset-4">Back to the menu</a>
          <h1 className="font-bubble text-5xl sm:text-6xl leading-[0.95] m-0 mt-5">Privacy notice</h1>
          <p className="m-0 mt-4 text-white/90 text-lg">How Stuff'd Bagels looks after the details you give us.</p>
        </div>
      </div>
      <div className="max-w-3xl mx-auto px-5 sm:px-8 py-12 leading-relaxed text-base [&_h2]:font-bubble [&_h2]:text-3xl [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:leading-none [&_ul]:pl-5 [&_li]:mt-1.5 [&_a]:font-bold [&_a]:text-blue [&_a]:underline [&_a]:underline-offset-4">
        <p className="m-0">Last updated 19 November 2026.</p>

        <h2>Who we are</h2>
        <p className="m-0">Stuff'd Bagels is a trading name of Sherezaan Khan (sole proprietor), 33 Ulm Way, Strandfontein. We are the "responsible party" under the Protection of Personal Information Act (POPIA). Our Information Officer is Sherezaan Khan. Contact us at <a href={`mailto:${EMAIL}`}>{EMAIL}</a>.</p>

        <h2>What we collect, and why</h2>
        <p className="m-0">We only ask for what we need.</p>
        <ul className="m-0 mt-3">
          <li><strong>When you send an order:</strong> your name, phone number, email address, the pickup point and Saturday you'll collect on, an optional preferred time, what you ordered, and an optional note. We use it to take your payment, prepare your order, email you your confirmation and a reminder on the morning of your collection day, and contact you if there's a problem.</li>
          <li><strong>When you send an event enquiry:</strong> your name, phone number, email address, the event date, venue or area, number of guests, and any details you add. We use it to reply with a quote.</li>
        </ul>
        <p className="m-0 mt-3">The details come from you, through our order and enquiry forms. You do not have to give them, but without them we cannot take or prepare your order, or reply to your enquiry. We use them only for the purposes above. We don't use your details for marketing, and we don't sell them.</p>

        <h2>Who sees it</h2>
        <p className="m-0">Only the people who run Stuff'd Bagels see your details. We also use service providers:</p>
        <ul className="m-0 mt-3">
          <li><strong>Yoco</strong> runs the payment page. It collects your card or bank details itself and looks after them under its own privacy policy; we never see them. We send Yoco your order reference and what you ordered. Yoco tells us the amount, whether the payment went through, and a payment reference.</li>
          <li><strong>Google</strong> provides the Stuff'd Bagels email account. Your order or enquiry arrives there as an email, and we send your confirmation and reminder from it.</li>
          <li><strong>Cloudflare</strong> runs this website. While you pay, it holds your order details for a short time so we can confirm the order when Yoco tells us it was paid. Your details are deleted from the website as soon as the order emails are sent. An order that is never paid is deleted within 48 hours. If the emails cannot be sent, we keep the order for up to 7 days so we can follow it up, then delete it. We keep your payment reference and the order reference for up to 7 days to match the payment to the order. Event enquiries pass straight to our email and are not kept on the website. To stop spam, the website keeps a short-lived counter linked to a scrambled version of your internet address, never your name or order; it deletes itself within a day.</li>
          <li><strong>Cloudflare Turnstile</strong> checks that the person using our order and enquiry forms is not a bot. It is Cloudflare's service and uses some of your browser's details for that check.</li>
        </ul>
        <p className="m-0 mt-3"><strong>Collection-day reminder.</strong> After you pay we email you a reminder on the morning of your collection day. It is about your order, not marketing. For this, a small copy of your order (first name, email address, pickup details and what you ordered) is kept in the Stuff'd Bagels Google account until that morning, then deleted.</p>

        <h2>Other countries</h2>
        <p className="m-0">Google and Cloudflare may store or process your information on servers outside South Africa. We need them to take your order and email you about it, and we rely on their own privacy and security commitments.</p>

        <h2>How long we keep it</h2>
        <p className="m-0">We keep order and enquiry emails for 12 months, then delete them. Payment records are kept by Yoco, and we keep a record of your payment for 5 years because tax and accounting rules require it. If you ask us to delete your details sooner, we will, except where the law makes us keep them.</p>

        <h2>Your rights</h2>
        <p className="m-0">You can ask us what we hold about you, ask us to correct it, or ask us to delete it. Email <a href={`mailto:${EMAIL}`}>{EMAIL}</a>. If you are unhappy with how we have handled your information you can complain to the Information Regulator, through the complaints page at <a href="https://inforegulator.org.za/complaints/" rel="noopener noreferrer" target="_blank">inforegulator.org.za/complaints</a>.</p>

        <h2>Payment</h2>
        <p className="m-0">You pay for orders on Yoco's secure payment page. We never see or store your card details, and nor does this website. Orders are confirmed once they are paid.</p>
      </div>
    </main>
  );
}
