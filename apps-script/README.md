# STUFF'D Bagels: order and booking emails (set-up guide, about 15 minutes, once)

The website sends every order and every event booking to its own server (the Worker). The Worker checks it and
passes it to a small Google script that lives in **stuffd.bagels@gmail.com**. The script:

1. emails the owner **"New order: <name>, <Saturday>"** or **"Booking enquiry: <name>, <date>"**,
2. emails the customer a short branded reply **from stuffd.bagels@gmail.com** (orders say "awaiting payment";
   booking enquiries say nothing is booked until you confirm),
3. files the owner email under the Gmail label **Orders** or **Bookings** (Gmail labels are its folders).

It uses only free Google services. Nothing is stored except the emails themselves.

You must do Parts 1 to 3 **signed in as stuffd.bagels@gmail.com**. That is what makes the replies come from her
address and puts the two labels in her mailbox.

## Part 1: Paste the script
1. Go to https://script.google.com signed in as stuffd.bagels@gmail.com. Click **New project**.
2. Click "Untitled project" at the top, name it **STUFFD orders**, press Enter.
3. In the code editor, select everything in `Code.gs`, delete it, and paste all of `apps-script/Code.gs` from this repo.
4. Make the token (next section, "The token") and put it in `SHARED_TOKEN` in the CONFIG block. **The script refuses every
   request until you do**, so this step is not optional. Leave the rest of CONFIG as it is.
5. Press **Cmd+S** (Ctrl+S on Windows) to save.

### The token (required, about 2 minutes)
The token is a secret password that only the website server and the script know. Without it, anyone who found the web app
address could make your Gmail send email to anybody, so the script refuses to work without one.

1. Make a random token of **32 or more characters**. In Terminal, run: `openssl rand -base64 36 | tr -d '/+=\n'` and copy the output.
   (A password manager's "generate" button with 40 characters and letters and numbers works too.)
2. Paste it between the quotes: `SHARED_TOKEN: 'paste-it-here',` in the CONFIG block of the script. Save.
3. Deploy it (Part 3 for the first time, or **Deploy > Manage deployments > pencil > Version: New version > Deploy** if it already exists).
   Changing `SHARED_TOKEN` only takes effect after a new version is deployed.
4. Give the **same value** to the website server (this is the only place it goes besides the script; never put it in the repo, a chat or an email):
   `npx wrangler@4.148.0 secret put APPS_SCRIPT_TOKEN --env preview` and paste it when asked (it is not echoed).
   The website server also refuses to send anything on if this secret is missing or shorter than 32 characters.
5. To change it later, repeat steps 1 to 4 (new token in both places, new version in the script).

## Part 2: Run the one-time set-up
1. In the grey bar above the code, click the function drop-down (it may say `doGet`) and choose **setup**.
2. Click **Run**. Google asks for permission: click **Review permissions**, choose stuffd.bagels@gmail.com.
3. You will see "Google hasn't verified this app". That is normal for your own script. Click **Advanced**, then
   **Go to STUFFD orders (unsafe)**, then **Allow**. It asks for: send email, manage Gmail labels, run on a timer. That is all it uses.
4. Under **Execution log** at the bottom you should see:
   `Labels "Orders" and "Bookings" are ready, and the 5-minute labeller is on.`
5. Open Gmail: the labels **Orders** and **Bookings** are now in the left sidebar (click "More" if they are hidden).

## Part 3: Publish it as a web app
1. Top right: **Deploy > New deployment**.
2. Click the gear next to "Select type" and choose **Web app**.
3. Description: `Orders and bookings`. **Execute as: Me (stuffd.bagels@gmail.com)**. **Who has access: Anyone**.
   ("Anyone" is needed so the website server can reach it. The address is a long secret link, the website server checks
   every order before sending it on, and the script refuses anything without the token from "The token" above.)
4. Click **Deploy**. Copy the **Web app URL** (it ends in `/exec`).
5. Paste the URL into a new browser tab. You should see `{"ok":true,...,"status":"running"}`.

## Part 4: Test it (sends two emails to stuffd.bagels@gmail.com itself)
1. Back in the editor choose **testOrder** in the function drop-down and click **Run**.
2. Open Gmail. Within a minute you should have:
   - **New order: Test Customer, ...** (the owner email: pickup point, Saturday, items, total, "AWAITING PAYMENT"),
   - **STUFF'D: we've got your order SB-TEST22** (what the customer receives: the branded one).
3. The owner email carries the **Orders** label straight away or within 5 minutes.
4. Choose **testBooking** and Run. You get **Booking enquiry: Test Customer, ...**, a customer reply, and the **Bookings** label.
5. Running a test twice within 10 minutes does nothing the second time (duplicate guard). Wait, or ignore.
6. Delete the test emails when you are happy.

## Part 5: Give the website the address
Do this for the **preview** first (the founder does this part, with the URL from Part 3). The website needs **both** secrets,
`APPS_SCRIPT_URL` and `APPS_SCRIPT_TOKEN` (see "The token"); with only one, the order and booking forms say "not switched on yet".

**Cloudflare dashboard:** Workers & Pages > **stuffdbagels-preview** > **Settings** > **Variables and Secrets** >
**Add** > Type **Secret**, name `APPS_SCRIPT_URL`, value = the Web app URL > **Deploy**.

**Or on the command line** (paste the URL when asked, it is not echoed):
`npx wrangler@4.148.0 secret put APPS_SCRIPT_URL --env preview`

Then place a real test order on the preview site (see the checklist in the session notes) and check both emails arrive.
The live `stuffdbagels` Worker gets the same secret only when the site goes live on its own address.

### If the web app address ever leaks
Anyone with the address still needs the token, so a leaked address alone is harmless. If the token leaks too, make a new token
(steps 1 to 5 above) and deploy a new version: the old one stops working at once.

## Changing the script later
Edit, save, then **Deploy > Manage deployments > pencil > Version: New version > Deploy**. The URL stays the same.
If you change `SITE_URL` or the phone number in CONFIG, do this too.

## Good to know
- **Email limits:** a free Gmail account can send about 100 emails a day, and each order or booking sends 2. The website
  stops accepting after 40 a day and asks people to email instead, and the script has its own cap of 40 a day (80 emails),
  so you can still send a few by hand. The script also sends **at most 3 customer replies to one email address per day**
  (`john.smith`, `johnsmith+x` and `JohnSmith@googlemail.com` count as the same Gmail address). Both caps are in CONFIG.
  If the script cannot send, the website tells the customer to email you; nothing is lost silently.
- **Labels:** Gmail has no real folders. A label works like one: click **Orders** in the sidebar to see only orders.
  If you want them to skip your Inbox, make a Gmail filter later; the script does not hide anything.
- **Orders are "awaiting payment".** The "Pay now" step (Yoco) is not built yet. Every email carries a reference
  (SB-XXXXXX for orders, BK-XXXXXX for bookings) that the payment step will use.
- **Privacy:** customer details stay in this Gmail account. The privacy notice on the website says so.
- The checks in `selftest.mjs` can be run with `node apps-script/selftest.mjs`. They test the script's logic with
  pretend Google services; the real proof is Part 4.
