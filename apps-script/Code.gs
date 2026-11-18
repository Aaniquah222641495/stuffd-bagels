/**
 * STUFF'D Bagels: order and booking emails (Google Apps Script web app).
 *
 * Install this in the CLIENT's Google account (stuffd.bagels@gmail.com), so that:
 *   - emails to the customer come FROM her address, not from Digital Pantry,
 *   - the "Orders" and "Bookings" Gmail labels live in HER mailbox.
 * Set-up steps: README.md next to this file. Change only the CONFIG block.
 *
 * How it works: the website posts an order or a booking to its own Worker (/api/order, /api/booking).
 * The Worker checks it (limits, honeypot, orders switched on, pickup day is a real market day, prices
 * worked out from the menu) and forwards it here. This script checks it again, then:
 *   1. emails the owner  "New order: <name>, <day>"  or  "Booking enquiry: <name>, <date>",
 *   2. emails the customer a short branded reply from the owner's address,
 *   3. puts the owner email under the Gmail label "Orders" or "Bookings".
 * Nothing is stored except the emails themselves (and short-lived duplicate and quota counters).
 *
 * Orders are "awaiting payment": an order is only confirmed once it has been paid (founder 2026-11-16).
 * The Yoco "Pay now" step is not built yet; the reference in each email is what it will hang on.
 */

const CONFIG = {
  BUSINESS_NAME: "STUFF'D Bagels",
  // Where order and booking emails go. Empty = the account this script runs as (stuffd.bagels@gmail.com).
  OWNER_EMAIL: '',
  SITE_URL: 'https://stuffdbagels-preview.thedigitalpantryza.workers.dev', // change to the real address when the domain is live
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
    const items = [];
    let total = 0;
    for (let i = 0; i < d.items.length; i++) {
      const it = d.items[i] || {};
      const qty = Number(it.qty), unit = Number(it.unit);
      if (!line_(it.name, 40) || !(qty >= 1 && qty <= 50 && qty % 1 === 0) || !(unit >= 0 && unit <= 1000 && unit % 1 === 0)) return { ok: false };
      items.push({ name: line_(it.name, 40), qty: qty, unit: unit, line: qty * unit });
      total += qty * unit;
    }
    return { ok: true, data: Object.assign(common, { type: 'order', ref: d.ref, pickupDate: d.pickupDate, pickupTime: line_(d.pickupTime, 40), pickupPlace: place, pickupDays: line_(d.pickupDays, 120), items: items, total: total, note: str_(d.note, 300) }) };
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
    const contentKey = 'dupec_' + hash_(JSON.stringify([a.type, a.email, a.name, a.pickupDate || a.eventDate, a.items || a.guests, a.total]));
    if (cache.get(dupeKey) || cache.get(contentKey)) return { ok: true, duplicate: true };
    // Daily caps (kept in Script Properties, which survive between runs). Duplicates were answered above and cost nothing.
    const today = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
    const props = PropertiesService.getScriptProperties();
    const total = readCount_(props.getProperty('cap_total'), today);
    const rcptKey = 'cap_rc_' + hash_(recipientKey_(a.email));
    const rcpt = readCount_(props.getProperty(rcptKey), today);
    if (total >= CONFIG.MAX_SUBMISSIONS_PER_DAY) {
      console.error('Daily cap reached; refusing ' + a.ref);
      return { ok: false, error: 'cap' };
    }
    if (rcpt >= CONFIG.MAX_REPLIES_PER_ADDRESS_PER_DAY) {
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
    cache.put(dupeKey, '1', CONFIG.DUPLICATE_WINDOW_SECONDS);
    cache.put(contentKey, '1', CONFIG.DUPLICATE_WINDOW_SECONDS);
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
      'Status: AWAITING PAYMENT. Not confirmed until it is paid.',
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
  MailApp.sendEmail({ to: owner_(), subject: ownerSubject_(a), body: lines.join('\n'), replyTo: a.email, name: CONFIG.BUSINESS_NAME + ' website' });
}

// DRAFT wording from the client's rule (2026-11-18), pending dp-counsel (CPA s17 advance-booking cancellations).
// No credit expiry is stated because none has been decided. Keep in step with CANCELLATION_POLICY in src/collection.ts.
const CANCELLATION_POLICY_ = "If you cancel before the Wednesday cut-off, or you pay and don't collect, your order becomes credit for another collection Saturday or one of our markets (credit, not a refund).";

function sendCustomer_(a) {
  if (MailApp.getRemainingDailyQuota() < 1) return;
  const f = first_(a.name);
  let subject, intro, rows, outro;
  if (a.type === 'order') {
    subject = "STUFF'D: we've got your order " + a.ref;
    intro = "Thanks for your order, " + f + "! We've got it.";
    rows = [['Reference', a.ref]].concat(pickupRows_(a))
      .concat(a.items.map(function (i) { return [i.qty + ' x ' + i.name, rand_(i.line)]; }))
      .concat([['Total', rand_(a.total)]]);
    if (a.note) rows.push(['Your note', a.note]);
    outro = 'Your order is awaiting payment. It is confirmed once it has been paid, and we will be in touch with how to pay. ' + CANCELLATION_POLICY_ + ' Questions? Just reply to this email.';
  } else {
    subject = "STUFF'D: we've got your event enquiry " + a.ref;
    intro = "Thanks for thinking of us, " + f + "! Your event enquiry has landed.";
    rows = [['Reference', a.ref], ['Event date', day_(a.eventDate, true)], ['Venue or area', a.venue], ['Guests', String(a.guests)]];
    if (a.details) rows.push(['Details', a.details]);
    outro = "We'll look at the date and get back to you with a quote, usually within a couple of days. Nothing is booked until we confirm. Questions? Just reply to this email.";
  }
  const plain = [intro, ''].concat(rows.map(function (r) { return r[0] + ': ' + r[1]; }), ['', outro, '', "STUFF'D Bagels", 'Cape Town', CONFIG.SITE_URL]).join('\n');
  MailApp.sendEmail({ to: a.email, subject: subject, body: plain, htmlBody: html_(intro, rows, outro), name: CONFIG.BUSINESS_NAME, replyTo: owner_() });
}

/** Branded HTML email: inline styles only, no images (they are blocked by default in many mail apps). */
function html_(intro, rows, outro) {
  const c = COLOURS;
  const tr = rows.map(function (r, i) {
    const total = r[0] === 'Total';
    return '<tr><td style="padding:10px 14px;border-top:1px solid #dbe3f0;font-size:14px;color:' + c.ink + ';' + (total ? 'font-weight:900;' : '') + '">' + esc_(r[0]) +
      '</td><td style="padding:10px 14px;border-top:1px solid #dbe3f0;font-size:14px;color:' + c.ink + ';text-align:right;white-space:pre-wrap;' + (total ? 'font-weight:900;' : 'font-weight:600;') + '">' + esc_(r[1]) + '</td></tr>';
  }).join('');
  return '<div style="background:' + c.paper + ';padding:24px 12px;font-family:Arial,Helvetica,sans-serif">' +
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;margin:0 auto;border-radius:18px;overflow:hidden;background:' + c.white + ';border:2px solid ' + c.ink + '">' +
    '<tr><td style="background:' + c.blue + ';padding:22px 24px;color:' + c.white + ';font-size:30px;font-weight:900;letter-spacing:1px">STUFF\'D <span style="font-size:13px;font-weight:700;letter-spacing:3px;color:' + c.sky + '">BAGELS</span></td></tr>' +
    '<tr><td style="padding:24px 24px 8px;font-size:18px;font-weight:700;color:' + c.ink + '">' + esc_(intro) + '</td></tr>' +
    '<tr><td style="padding:8px 24px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:' + c.paper + ';border-radius:12px">' + tr + '</table></td></tr>' +
    '<tr><td style="padding:16px 24px 8px;font-size:15px;line-height:1.5;color:' + c.ink + '">' + esc_(outro) + '</td></tr>' +
    '<tr><td style="padding:8px 24px 24px;font-size:13px;color:#4a5578">STUFF\'D Bagels, Cape Town &middot; ' + esc_(CONFIG.PHONE_DISPLAY) + '</td></tr>' +
    '</table></div>';
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

/** Run by the 5-minute trigger that setup() installs. */
function labelNew() { labelRecent_(); }

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
    type: 'order', ref: 'SB-TEST22', name: 'Test Customer', phone: '+27820000000', email: owner_(),
    pickupDate: '2026-12-19', // any date works for the test; real orders are always a Saturday
    pickupTime: '10:30', pickupDays: 'Saturdays, 10am to 1pm',
    pickupPlace: 'Test pickup point, Cape Town',
    items: [{ name: 'Pizza Bagel', qty: 2, unit: 85, line: 170 }, { name: 'Extra Cheese', qty: 1, unit: 5, line: 5 }],
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
