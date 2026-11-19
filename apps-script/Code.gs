/**
 * STUFF'D Bagels: order and booking emails (Google Apps Script web app).
 *
 * Install this in the CLIENT's Google account (stuffd.bagels@gmail.com), so that:
 *   - emails to the customer come FROM her address, not from Digital Pantry,
 *   - the "Orders" and "Bookings" Gmail labels live in HER mailbox.
 * Set-up steps: README.md next to this file. Change only the CONFIG block.
 *
 * How it works: the website posts a booking to its own Worker (/api/booking) and the Worker forwards it here. ORDERS
 * are different (ADR-0041): the customer pays on Yoco first, Yoco tells the Worker it was paid (a signed webhook), and ONLY
 * THEN does the Worker send the order here, marked paid:true with Yoco's checkout id. This script refuses any order that
 * isn't paid, so an unpaid order can never reach the owner's inbox. For each accepted request it:
 *   1. emails the owner  "New order: <name>, <day>"  (paid, confirmed)  or  "Booking enquiry: <name>, <date>",
 *   2. emails the customer a short branded reply from the owner's address ("order confirmed" for orders),
 *   3. puts the owner email under the Gmail label "Orders" or "Bookings".
 * Nothing is stored except the emails themselves (and short-lived duplicate and quota counters).
 *
 * The Worker may send the same paid order more than once (it retries if this script was slow): a paid order is
 * de-duplicated by its reference for 6 hours, the longest Google's CacheService allows, so it is emailed once.
 */

const CONFIG = {
  BUSINESS_NAME: "STUFF'D Bagels",
  // Where order and booking emails go. Empty = the account this script runs as (stuffd.bagels@gmail.com).
  OWNER_EMAIL: '',
  SITE_URL: 'https://stuffdbagels.co.za',
  PHONE_DISPLAY: '083 300 8472',
  TIMEZONE: 'Africa/Johannesburg',
  ORDERS_LABEL: 'Orders',
  BOOKINGS_LABEL: 'Bookings',
  // REQUIRED. A random secret of 32 or more characters. Put the same text in the Worker secret APPS_SCRIPT_TOKEN.
  // While this is empty (or shorter than MIN_TOKEN_LENGTH) the script refuses EVERY request, so nobody who finds the
  // web app address can use it to send email from this Gmail account. See README.md, "The token".
  SHARED_TOKEN: '',
  MIN_TOKEN_LENGTH: 32,
  MAX_BODY_CHARS: 12000,
  DUPLICATE_WINDOW_SECONDS: 600,
  PAID_DUPLICATE_WINDOW_SECONDS: 21600, // 6 hours, the maximum CacheService allows
  // A free Gmail account can send about 100 emails a day; each submission sends 2.
  MIN_QUOTA: 4,
  // Caps kept by the script itself, as a second wall behind the Worker's limits.
  MAX_SUBMISSIONS_PER_DAY: 40,      // 40 x 2 emails = 80, below Gmail's 100 a day, so you can still email by hand
  MAX_REPLIES_PER_ADDRESS_PER_DAY: 3 // customer replies to one mailbox per day (Gmail dots and +tags count as the same)
};

const COLOURS = { ink: '#16245c', paper: '#f7f8fc', blue: '#004f94', sky: '#cfe1f3', white: '#ffffff' };

/* ------------------------------------------------------------------ */
/* Web app entry points                                                */
/* ------------------------------------------------------------------ */

function doGet() {
  return reply_({ ok: true, service: "STUFF'D Bagels order and booking endpoint", status: 'running' });
}

/** The Worker posts text/plain JSON here. */
function doPost(e) {
  try {
    const body = e && e.postData && e.postData.contents ? String(e.postData.contents) : '';
    if (!body || body.length > CONFIG.MAX_BODY_CHARS) return reply_({ ok: false, error: 'invalid' });
    let data;
    try { data = JSON.parse(body); } catch (err) { return reply_({ ok: false, error: 'invalid' }); }
    if (!data || typeof data !== 'object') return reply_({ ok: false, error: 'invalid' });
    if (!tokenOk_(data.token)) return reply_({ ok: false, error: 'invalid' });
    return reply_(process_(data));
  } catch (err) {
    console.error('doPost failed: ' + err);
    return reply_({ ok: false, error: 'server' });
  }
}

/** Fails closed: no token set (or too short) means every request is refused. Compared in constant time. */
function tokenOk_(given) {
  const secret = CONFIG.SHARED_TOKEN;
  if (typeof secret !== 'string' || secret.length < CONFIG.MIN_TOKEN_LENGTH) return false;
  if (typeof given !== 'string') return false;
  // Hash both sides first so the lengths match, then look at every byte (no early exit).
  const a = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, given, Utilities.Charset.UTF_8);
  const b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, secret, Utilities.Charset.UTF_8);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ^ b[i]);
  return diff === 0;
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------------------------------------------ */
/* Checking                                                            */
/* ------------------------------------------------------------------ */

function str_(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim().slice(0, max);
}
function line_(v, max) { return str_(v, max).replace(/\s+/g, ' '); }
function validDate_(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(new Date(v + 'T12:00:00Z').getTime()); }
function validEmail_(v) { return /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}$/.test(v) && v.length <= 254; }
function validCheckoutId_(v) { return typeof v === 'string' && /^[A-Za-z0-9_\-]{4,100}$/.test(v); }
function validRef_(v, prefix) { return typeof v === 'string' && new RegExp('^' + prefix + '-[A-Z0-9]{6}$').test(v); }

/** Returns { ok, data } with only the fields we use, cut to length, or { ok: false }. */
function clean_(d) {
  const common = {
    name: line_(d.name, 60), phone: line_(d.phone, 20), email: line_(d.email, 254)
  };
  if (!common.name || !/^\+\d{8,15}$/.test(common.phone) || !validEmail_(common.email)) return { ok: false };
  if (d.type === 'order') {
    // Orders are collected on a Saturday at one of the owner's pickup points (never at a market).
    const place = line_(d.pickupPlace, 200);
    if (!validRef_(d.ref, 'SB') || !place || !validDate_(d.pickupDate) || !Array.isArray(d.items) || d.items.length < 1 || d.items.length > 12) return { ok: false };
    // A paid order only (ADR-0041). The Worker sends it after Yoco's signed webhook; nothing else may send an order.
    if (d.paid !== true || !validCheckoutId_(d.checkoutId)) return { ok: false };
    const items = [];
    let total = 0;
    for (let i = 0; i < d.items.length; i++) {
      const it = d.items[i] || {};
      const qty = Number(it.qty), unit = Number(it.unit);
      if (!line_(it.name, 40) || !(qty >= 1 && qty <= 50 && qty % 1 === 0) || !(unit >= 0 && unit <= 1000 && unit % 1 === 0)) return { ok: false };
      items.push({ name: line_(it.name, 40), qty: qty, unit: unit, line: qty * unit });
      total += qty * unit;
    }
    return { ok: true, data: Object.assign(common, { type: 'order', paid: true, checkoutId: d.checkoutId, ref: d.ref, pickupDate: d.pickupDate, pickupTime: line_(d.pickupTime, 40), pickupPlace: place, pickupDays: line_(d.pickupDays, 120), items: items, total: total, note: str_(d.note, 300) }) };
  }
  if (d.type === 'booking') {
    const guests = Number(d.guests);
    if (!validRef_(d.ref, 'BK') || !validDate_(d.eventDate) || !(guests >= 1 && guests <= 5000 && guests % 1 === 0)) return { ok: false };
    const venue = line_(d.venue, 120);
    if (!venue) return { ok: false };
    return { ok: true, data: Object.assign(common, { type: 'booking', ref: d.ref, eventDate: d.eventDate, venue: venue, guests: guests, details: str_(d.details, 1000) }) };
  }
  return { ok: false };
}

function process_(raw) {
  const c = clean_(raw);
  if (!c.ok) return { ok: false, error: 'invalid' };
  const a = c.data;

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'busy' };
  try {
    const cache = CacheService.getScriptCache();
    const dupeKey = 'dupe_' + a.ref;
    // Bookings also match on content (a double click makes a new reference). Paid orders match on the reference only: two
    // different payments for the same cart are two orders, and the second one must never be swallowed.
    const contentKey = a.type === 'booking' ? 'dupec_' + hash_(JSON.stringify([a.type, a.email, a.name, a.eventDate, a.guests])) : '';
    if (cache.get(dupeKey) || (contentKey && cache.get(contentKey))) return { ok: true, duplicate: true };
    // Daily caps (kept in Script Properties, which survive between runs). Duplicates were answered above and cost nothing.
    const today = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
    const props = PropertiesService.getScriptProperties();
    const total = readCount_(props.getProperty('cap_total'), today);
    const rcptKey = 'cap_rc_' + hash_(recipientKey_(a.email));
    const rcpt = readCount_(props.getProperty(rcptKey), today);
    // Paid orders are never capped (2026-11-19): Yoco's signed payment already proves they are real, and refusing one
    // would mean a customer paid and the owner never heard. The caps below only stop booking-form spam.
    const capped = a.type !== 'order';
    if (capped && total >= CONFIG.MAX_SUBMISSIONS_PER_DAY) {
      console.error('Daily cap reached; refusing ' + a.ref);
      return { ok: false, error: 'cap' };
    }
    if (capped && rcpt >= CONFIG.MAX_REPLIES_PER_ADDRESS_PER_DAY) {
      console.error('Per-address cap reached; refusing ' + a.ref);
      return { ok: false, error: 'cap' };
    }
    if (MailApp.getRemainingDailyQuota() < CONFIG.MIN_QUOTA) {
      console.error('Email quota nearly used up; refusing ' + a.ref);
      return { ok: false, error: 'quota' };
    }
    // The owner email is the one that matters: if it fails, the customer is told it failed and can email.
    sendOwner_(a);
    saveCaps_(props, today, rcptKey, total + 1, rcpt + 1);
    // 21600 s (6 hours) is the longest CacheService keeps a value (Apps Script docs). A paid order is held that long; a booking 10 minutes.
    cache.put(dupeKey, '1', a.type === 'order' ? CONFIG.PAID_DUPLICATE_WINDOW_SECONDS : CONFIG.DUPLICATE_WINDOW_SECONDS);
    if (contentKey) cache.put(contentKey, '1', CONFIG.DUPLICATE_WINDOW_SECONDS);
  } catch (err) {
    console.error('Owner email failed for ' + a.ref + ': ' + err);
    return { ok: false, error: 'mail' };
  } finally {
    lock.releaseLock();
  }

  try { sendCustomer_(a); } catch (err) { console.error('Customer reply failed for ' + a.ref + ': ' + err); }
  try { labelRecent_(); } catch (err) { console.error('Labelling failed (the 5-minute catch-up will retry): ' + err); }
  return { ok: true };
}

/** Counters look like "2026-11-16:3". A counter from an earlier day reads as 0. */
function readCount_(v, today) {
  if (typeof v !== 'string') return 0;
  const p = v.split(':');
  return p[0] === today ? Number(p[1]) || 0 : 0;
}
function saveCaps_(props, today, rcptKey, total, rcpt) {
  // Tidy first: drop per-address counters from earlier days, so the store never grows.
  const all = props.getProperties();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('cap_rc_') === 0 && all[k].split(':')[0] !== today) props.deleteProperty(k);
  });
  props.setProperty('cap_total', today + ':' + total);
  props.setProperty(rcptKey, today + ':' + rcpt);
}
/** The same mailbox written different ways counts once: case, "+tag", and dots in Gmail addresses. */
function recipientKey_(email) {
  const parts = String(email).trim().toLowerCase().split('@');
  let local = parts[0].split('+')[0];
  let domain = parts[1] || '';
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return local + '@' + domain;
}

function hash_(s) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  return bytes.slice(0, 12).map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

/* ------------------------------------------------------------------ */
/* Wording                                                             */
/* ------------------------------------------------------------------ */

function owner_() { return CONFIG.OWNER_EMAIL || Session.getEffectiveUser().getEmail(); }
function day_(iso, withYear) {
  return Utilities.formatDate(new Date(iso + 'T12:00:00+02:00'), CONFIG.TIMEZONE, withYear ? 'EEE d MMM yyyy' : 'EEE d MMM');
}
function rand_(n) { return 'R' + n; }
function first_(name) { return String(name).split(' ')[0]; }
function esc_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function orderLines_(a) {
  return a.items.map(function (i) { return i.qty + ' x ' + i.name + '   ' + rand_(i.line); });
}

function ownerSubject_(a) {
  if (a.type === 'booking') return 'Booking enquiry: ' + a.name + ', ' + day_(a.eventDate, true);
  return 'New order: ' + a.name + ', ' + day_(a.pickupDate, false); // the collection Saturday
}

/** Pickup details for emails, one [label, value] pair per line. */
function pickupRows_(a) {
  const rows = [['Pickup point', a.pickupPlace], ['Collection Saturday', day_(a.pickupDate, true)]];
  if (a.pickupTime) rows.push(['Preferred time', a.pickupTime]);
  if (a.pickupDays) rows.push(['Collection times', a.pickupDays]);
  return rows;
}

function sendOwner_(a) {
  const wa = 'https://wa.me/' + a.phone.replace('+', '');
  let lines;
  if (a.type === 'order') {
    lines = [
      'NEW ORDER ' + a.ref,
      'PAID ONLINE (Yoco) ' + rand_(a.total) + '. Confirmed.',
      'Yoco checkout id: ' + a.checkoutId + '  (keep this: it is what you need to refund)',
      '',
      'Name: ' + a.name,
      'Phone: ' + a.phone + '  (' + wa + ')',
      'Email: ' + a.email + '  (just hit Reply)',
      '',
    ].concat(pickupRows_(a).map(function (r) { return r[0] + ': ' + r[1]; }), ['', 'Order:'], orderLines_(a), ['Total: ' + rand_(a.total), '', 'Note: ' + (a.note || 'None')]);
  } else {
    lines = [
      'BOOKING ENQUIRY ' + a.ref,
      '',
      'Name: ' + a.name,
      'Phone: ' + a.phone + '  (' + wa + ')',
      'Email: ' + a.email + '  (just hit Reply)',
      '',
      'Event date: ' + day_(a.eventDate, true),
      'Venue or area: ' + a.venue,
      'Guests: ' + a.guests,
      '',
      'Details: ' + (a.details || 'None')
    ];
  }
  lines.push('', 'Sent from the STUFF\'D Bagels website.');
  MailApp.sendEmail({ to: owner_(), subject: ownerSubject_(a), body: lines.join('\n'), htmlBody: ownerHtml_(a), replyTo: a.email, name: CONFIG.BUSINESS_NAME + ' website' });
}

// DRAFT wording from the client's rule (2026-11-18), pending dp-counsel (CPA s17 advance-booking cancellations).
// Credit lasts 2 months (founder and client, 2026-11-18). Keep in step with CANCELLATION_POLICY in src/collection.ts.
const CANCELLATION_POLICY_ = "If you cancel before the Wednesday cut-off, or you pay and don't collect, your order becomes credit for another collection Saturday or one of our markets, valid for 2 months (credit, not a refund).";

function sendCustomer_(a) {
  if (MailApp.getRemainingDailyQuota() < 1) return;
  const f = first_(a.name);
  let subject, intro, rows, outro;
  if (a.type === 'order') {
    subject = "STUFF'D: order confirmed " + a.ref;
    intro = "Thanks for your order, " + f + "! Paid and confirmed.";
    rows = [['Reference', a.ref]].concat(pickupRows_(a))
      .concat(a.items.map(function (i) { return [i.qty + ' x ' + i.name, rand_(i.line)]; }))
      .concat([['Total', rand_(a.total)]]);
    if (a.note) rows.push(['Your note', a.note]);
    outro = 'Your payment has been received and your order is confirmed. ' + CANCELLATION_POLICY_ + ' Questions? Just reply to this email.';
  } else {
    subject = "STUFF'D: we've got your event enquiry " + a.ref;
    intro = "Thanks for thinking of us, " + f + "! Your event enquiry has landed.";
    rows = [['Reference', a.ref], ['Event date', day_(a.eventDate, true)], ['Venue or area', a.venue], ['Guests', String(a.guests)]];
    if (a.details) rows.push(['Details', a.details]);
    outro = "We'll look at the date and get back to you with a quote, usually within a couple of days. Nothing is booked until we confirm. Questions? Just reply to this email.";
  }
  const plain = [intro, ''].concat(rows.map(function (r) { return r[0] + ': ' + r[1]; }), ['', outro, '', "STUFF'D Bagels", 'Cape Town', CONFIG.SITE_URL]).join('\n');
  MailApp.sendEmail({ to: a.email, subject: subject, body: plain, htmlBody: customerHtml_(a), name: CONFIG.BUSINESS_NAME, replyTo: owner_() });
}

/* ------------------------------------------------------------------ */
/* Branded HTML emails (founder 2026-11-19: STUFF'D branding and logo, */
/* and a clearer owner email). Inline styles and tables only, so they  */
/* hold up in Gmail, Apple Mail and Outlook. The logo is an image from */
/* the website; if a mail app hides images, its alt text still reads   */
/* STUFF'D in big white letters on the blue bar.                       */
/* ------------------------------------------------------------------ */

const FONT_ = "'Arial Black','Helvetica Neue',Arial,Helvetica,sans-serif";
const BODY_FONT_ = "'Helvetica Neue',Arial,Helvetica,sans-serif";

function logoUrl_() { return CONFIG.SITE_URL.replace(/\/$/, '') + '/logo-white.png'; }

/** The shared frame: blue bar with the logo, white card, footer. */
function shell_(preheader, tag, inner) {
  const c = COLOURS;
  return '<!doctype html><html><body style="margin:0;padding:0;background:' + c.paper + '">' +
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0">' + esc_(preheader) + '</div>' +
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:' + c.paper + '"><tr><td align="center" style="padding:24px 12px">' +
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:' + c.white + ';border:2px solid ' + c.ink + ';border-radius:20px;overflow:hidden">' +
    '<tr><td style="background:' + c.blue + ';padding:22px 26px">' +
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>' +
      '<td style="vertical-align:middle"><img src="' + logoUrl_() + '" width="150" alt="STUFF\'D" style="display:block;width:150px;max-width:150px;height:auto;border:0;color:#ffffff;font-family:' + FONT_ + ';font-size:30px;font-weight:900"></td>' +
      (tag ? '<td align="right" style="vertical-align:middle"><span style="display:inline-block;background:' + c.white + ';color:' + c.blue + ';font-family:' + FONT_ + ';font-size:11px;font-weight:900;letter-spacing:2px;text-transform:uppercase;padding:7px 12px;border-radius:999px">' + esc_(tag) + '</span></td>' : '') +
      '</tr></table></td></tr>' +
    inner +
    '<tr><td style="padding:18px 26px 22px;border-top:1px solid #dbe3f0;font-family:' + BODY_FONT_ + ';font-size:12px;line-height:1.5;color:#4a5578">' +
      '<b style="color:' + c.ink + '">STUFF\'D Bagels</b> &middot; Cape Town &middot; ' + esc_(CONFIG.PHONE_DISPLAY) + '<br>' +
      '<a href="' + esc_(CONFIG.SITE_URL) + '" style="color:' + c.blue + ';font-weight:700;text-decoration:none">' + esc_(CONFIG.SITE_URL.replace(/^https?:\/\//, '')) + '</a>' +
    '</td></tr></table></td></tr></table></body></html>';
}

function h1_(text, sub) {
  const c = COLOURS;
  return '<tr><td style="padding:26px 26px 6px;font-family:' + FONT_ + ';font-size:26px;line-height:1.15;font-weight:900;color:' + c.ink + '">' + esc_(text) + '</td></tr>' +
    (sub ? '<tr><td style="padding:0 26px 14px;font-family:' + BODY_FONT_ + ';font-size:16px;line-height:1.5;color:' + c.ink + '">' + esc_(sub) + '</td></tr>' : '');
}

/** A soft blue box with a small label and big lines: where and when to collect, or the event. */
function box_(label, big, lines) {
  const c = COLOURS;
  return '<tr><td style="padding:8px 26px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:' + c.sky + ';border-radius:14px"><tr><td style="padding:16px 18px;font-family:' + BODY_FONT_ + ';color:' + c.ink + '">' +
    '<div style="font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:' + c.blue + '">' + esc_(label) + '</div>' +
    '<div style="font-family:' + FONT_ + ';font-size:22px;font-weight:900;line-height:1.2;margin-top:4px">' + esc_(big) + '</div>' +
    lines.filter(Boolean).map(function (l) { return '<div style="font-size:15px;line-height:1.5;margin-top:2px">' + esc_(l) + '</div>'; }).join('') +
    '</td></tr></table></td></tr>';
}

/** The bagels, one row each with the quantity in a blue circle, then the total. */
function itemsTable_(a) {
  const c = COLOURS;
  const rows = a.items.map(function (i) {
    return '<tr>' +
      '<td width="40" style="padding:10px 0;border-bottom:1px solid #dbe3f0;vertical-align:middle"><span style="display:inline-block;min-width:28px;height:28px;line-height:28px;text-align:center;border-radius:14px;background:' + c.blue + ';color:#ffffff;font-family:' + FONT_ + ';font-size:14px;font-weight:900">' + i.qty + '</span></td>' +
      '<td style="padding:10px 0;border-bottom:1px solid #dbe3f0;font-family:' + BODY_FONT_ + ';font-size:16px;font-weight:700;color:' + c.ink + '">' + esc_(i.name) + '</td>' +
      '<td align="right" style="padding:10px 0;border-bottom:1px solid #dbe3f0;font-family:' + BODY_FONT_ + ';font-size:15px;color:' + c.ink + ';white-space:nowrap">' + rand_(i.line) + '</td></tr>';
  }).join('');
  return '<tr><td style="padding:10px 26px 4px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0">' + rows +
    '<tr><td></td><td style="padding:14px 0 0;font-family:' + FONT_ + ';font-size:16px;font-weight:900;color:' + c.ink + '">Total paid</td>' +
    '<td align="right" style="padding:14px 0 0;font-family:' + FONT_ + ';font-size:24px;font-weight:900;color:' + c.blue + ';white-space:nowrap">' + rand_(a.total) + '</td></tr>' +
    '</table></td></tr>';
}

/** Label / value rows (bookings). */
function factsTable_(rows) {
  const c = COLOURS;
  return '<tr><td style="padding:8px 26px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0">' + rows.map(function (r) {
    return '<tr><td style="padding:9px 0;border-bottom:1px solid #dbe3f0;font-family:' + BODY_FONT_ + ';font-size:13px;font-weight:700;color:#4a5578;vertical-align:top;width:38%">' + esc_(r[0]) + '</td>' +
      '<td style="padding:9px 0;border-bottom:1px solid #dbe3f0;font-family:' + BODY_FONT_ + ';font-size:15px;font-weight:700;color:' + c.ink + ';white-space:pre-wrap">' + esc_(r[1]) + '</td></tr>';
  }).join('') + '</table></td></tr>';
}

/** A highlighted note (the customer's own words). */
function note_(label, text) {
  if (!text) return '';
  return '<tr><td style="padding:8px 26px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fff6e0;border-left:4px solid #f2b705;border-radius:10px"><tr><td style="padding:12px 16px;font-family:' + BODY_FONT_ + ';color:' + COLOURS.ink + '">' +
    '<div style="font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:#8a6400">' + esc_(label) + '</div>' +
    '<div style="font-size:15px;line-height:1.5;margin-top:3px;white-space:pre-wrap">' + esc_(text) + '</div></td></tr></table></td></tr>';
}

function para_(text, small) {
  return '<tr><td style="padding:10px 26px;font-family:' + BODY_FONT_ + ';font-size:' + (small ? '13px' : '15px') + ';line-height:1.55;color:' + (small ? '#4a5578' : COLOURS.ink) + '">' + esc_(text) + '</td></tr>';
}

/** Tap-to-contact buttons for the owner. */
function buttons_(a) {
  const btn = function (href, label, bg) {
    return '<td style="padding:4px"><a href="' + esc_(href) + '" style="display:block;text-align:center;background:' + bg + ';color:#ffffff;font-family:' + FONT_ + ';font-size:13px;font-weight:900;text-decoration:none;padding:12px 8px;border-radius:999px">' + label + '</a></td>';
  };
  return '<tr><td style="padding:6px 22px 10px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>' +
    btn('https://wa.me/' + a.phone.replace('+', ''), 'WhatsApp', '#1f8f4e') +
    btn('tel:' + a.phone, 'Call', COLOURS.ink) +
    btn('mailto:' + a.email + '?subject=' + encodeURIComponent((a.type === 'order' ? 'Your STUFF\'D order ' : 'Your STUFF\'D enquiry ') + a.ref), 'Email', COLOURS.blue) +
    '</tr></table></td></tr>';
}

function customerCard_(a) {
  const c = COLOURS;
  return '<tr><td style="padding:14px 26px 4px;font-family:' + BODY_FONT_ + ';color:' + c.ink + '">' +
    '<div style="font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:' + c.blue + '">Customer</div>' +
    '<div style="font-family:' + FONT_ + ';font-size:20px;font-weight:900;margin-top:4px">' + esc_(a.name) + '</div>' +
    '<div style="font-size:15px;margin-top:2px">' + esc_(a.phone) + ' &middot; ' + esc_(a.email) + '</div></td></tr>' + buttons_(a);
}

function customerHtml_(a) {
  const f = first_(a.name);
  if (a.type === 'order') {
    return shell_('Paid and confirmed. Collect on ' + day_(a.pickupDate, false) + '.', 'Order ' + a.ref,
      h1_('Order confirmed!', 'Thanks, ' + f + '. Your payment came through and your bagels are on the list.') +
      box_('Collect', day_(a.pickupDate, true), [a.pickupPlace, a.pickupTime ? 'Your preferred time: ' + a.pickupTime : '', a.pickupDays]) +
      itemsTable_(a) +
      note_('Your note', a.note) +
      para_('Questions or need to change something? Just reply to this email.') +
      para_(CANCELLATION_POLICY_, true));
  }
  return shell_('We\'ve got your event enquiry ' + a.ref + '.', 'Enquiry ' + a.ref,
    h1_('Enquiry received!', 'Thanks for thinking of us, ' + f + '. We\'ll look at the date and come back to you with a quote, usually within a couple of days.') +
    box_('Your event', day_(a.eventDate, true), [a.venue, a.guests + ' guests']) +
    note_('Your details', a.details) +
    para_('Nothing is booked until we confirm. Questions? Just reply to this email.', true));
}

function ownerHtml_(a) {
  if (a.type === 'order') {
    return shell_('Paid ' + rand_(a.total) + '. ' + a.name + ', collecting ' + day_(a.pickupDate, false) + '.', 'Paid ' + rand_(a.total),
      h1_('New order ' + a.ref, 'Paid online with Yoco. Nothing to chase.') +
      box_('Collecting', day_(a.pickupDate, true), [a.pickupTime ? 'Preferred time: ' + a.pickupTime : 'Any time', a.pickupPlace]) +
      itemsTable_(a) +
      note_('Their note', a.note) +
      customerCard_(a) +
      para_('Yoco checkout id: ' + a.checkoutId + '. Keep this email: you need the id to refund.', true));
  }
  return shell_('Event enquiry: ' + a.name + ', ' + day_(a.eventDate, true) + '.', 'Enquiry',
    h1_('Event enquiry ' + a.ref, 'Reply with a quote. Nothing is booked yet.') +
    box_('Event', day_(a.eventDate, true), [a.venue, a.guests + ' guests']) +
    note_('Their details', a.details) +
    customerCard_(a));
}

/* ------------------------------------------------------------------ */
/* Gmail labels                                                        */
/* ------------------------------------------------------------------ */

/** Gmail has no folders; labels are the folders. This finds our owner emails and files them. */
function labelRecent_() {
  const orders = GmailApp.getUserLabelByName(CONFIG.ORDERS_LABEL) || GmailApp.createLabel(CONFIG.ORDERS_LABEL);
  const bookings = GmailApp.getUserLabelByName(CONFIG.BOOKINGS_LABEL) || GmailApp.createLabel(CONFIG.BOOKINGS_LABEL);
  // The email we just sent can take a moment to show up in search; the 5-minute trigger catches any left over.
  [['New order', 'New order: ', orders], ['Booking enquiry', 'Booking enquiry: ', bookings]].forEach(function (g) {
    const threads = GmailApp.search('subject:"' + g[0] + '" newer_than:2d -label:' + g[2].getName().toLowerCase(), 0, 30);
    threads.forEach(function (t) {
      if (t.getFirstMessageSubject().indexOf(g[1]) === 0) t.addLabel(g[2]);
    });
  });
}

/* ------------------------------------------------------------------ */
/* Inbox folders (founder and client, 2026-11-19)                      */
/* Files everyday mail into labels so the inbox only holds what needs  */
/* her. Shopping and Promotions also leave the inbox (archived, never  */
/* deleted: they stay under their label). Our own emails are skipped.  */
/* To add a sender, add it to the matching query below.                */
/* ------------------------------------------------------------------ */
const FOLDERS_ = [
  { label: 'Payments', query: 'from:(yoco.com OR capitecbank.co.za)' },
  { label: 'Markets', query: 'from:bookipi.com OR "Revere Markets"' },
  { label: 'Accounts', query: 'from:(google.com OR canva.com)' },
  { label: 'Enquiries', query: 'subject:(sponsorship OR sponsor OR collab OR collaboration OR vacancy OR inquiry OR enquiry OR quote)' },
  { label: 'Shopping', query: 'from:(shein.com OR sheinnotify.com OR sheinnotice.com OR buffaloex.com OR takealot.com OR temu.com)', archive: true },
  { label: 'Promotions', query: 'from:uber.com OR category:promotions', archive: true }
];

/** Labels matching threads; `window` like '2d' limits it to recent mail ('' = everything, for the first run). */
function organise_(window) {
  const business = ['Orders', 'Bookings', 'Payments', 'Markets', 'Enquiries'];
  FOLDERS_.forEach(function (f) {
    const label = GmailApp.getUserLabelByName(f.label) || GmailApp.createLabel(f.label);
    let q = '(' + f.query + ') -from:me -label:' + f.label.toLowerCase();
    // Never hide business mail: promotions skip anything already filed as business.
    if (f.archive) q += business.map(function (b) { return ' -label:' + b.toLowerCase(); }).join('');
    if (window) q += ' newer_than:' + window;
    for (let round = 0; round < 10; round++) { // 10 x 100 threads per label per run keeps us inside Apps Script's time limit
      const threads = GmailApp.search(q, 0, 100);
      if (!threads.length) break;
      label.addToThreads(threads);
      if (f.archive) GmailApp.moveThreadsToArchive(threads.filter(function (t) { return t.isInInbox(); }));
      if (threads.length < 100) break;
    }
  });
}

/** Run once from the editor to file all existing mail. Safe to run again. */
function organiseAll() { organise_(''); }

/** Run by the 5-minute trigger that setup() installs. */
function labelNew() {
  labelRecent_();
  try { organise_('2d'); } catch (err) { console.error('Folders failed (next run retries): ' + err); }
}

/* ------------------------------------------------------------------ */
/* One-time set-up and self-test (run from the editor, as the owner)   */
/* ------------------------------------------------------------------ */

/** Run once: creates the labels, installs the 5-minute labeller. Safe to run again. */
function setup() {
  GmailApp.getUserLabelByName(CONFIG.ORDERS_LABEL) || GmailApp.createLabel(CONFIG.ORDERS_LABEL);
  GmailApp.getUserLabelByName(CONFIG.BOOKINGS_LABEL) || GmailApp.createLabel(CONFIG.BOOKINGS_LABEL);
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'labelNew') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('labelNew').timeBased().everyMinutes(5).create();
  console.log('Labels "' + CONFIG.ORDERS_LABEL + '" and "' + CONFIG.BOOKINGS_LABEL + '" are ready, and the 5-minute labeller is on.');
  console.log('Owner emails go to: ' + owner_());
  console.log('Next: Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone). Then run testOrder and testBooking.');
}

/** Sends a pretend order and booking to the owner's own address (the customer reply goes to the same address). */
function testOrder() {
  console.log(JSON.stringify(process_({
    type: 'order', paid: true, checkoutId: 'ch_TEST0001', // a real order only arrives after Yoco says it was paid
    ref: 'SB-' + Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, '7'), name: 'Test Customer', phone: '+27820000000', email: owner_(),
    pickupDate: '2026-12-19', // any date works for the test; real orders are always a Saturday
    pickupTime: '10:30', pickupDays: 'Saturdays, 10am to 1pm',
    pickupPlace: 'Test pickup point, Cape Town',
    items: [{ name: 'Pizza Bagel', qty: 2, unit: 85, line: 170 }, { name: 'Extra Jalapeno', qty: 1, unit: 5, line: 5 }],
    total: 175, note: 'This is a test, please ignore.'
  })));
}
function testBooking() {
  console.log(JSON.stringify(process_({
    type: 'booking', ref: 'BK-TEST22', name: 'Test Customer', phone: '+27820000000', email: owner_(),
    eventDate: Utilities.formatDate(new Date(Date.now() + 30 * 86400000), 'Africa/Johannesburg', 'yyyy-MM-dd'),
    venue: 'Test venue, Cape Town', guests: 80, details: 'This is a test, please ignore.'
  })));
}
