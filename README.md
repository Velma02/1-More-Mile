# 1-More-Mile

# 1 More Mile – Registration Website

Registration site for the **1 More Mile** fun run (AIESEC in University of Colombo).
A static website (HTML/CSS/JS) backed by **Google Apps Script**, a **Google Sheet** and **Google Drive**.

## How it works

```
Participant fills the form + uploads bank-transfer receipt
        │
        ▼
Google Apps Script (web app)
   • validates the data (email, 10-digit phone numbers, receipt)
   • saves a row in the "Registrations" sheet as  Payment status = Pending
   • stores the receipt in Google Drive
   • sends the "We received your registration" email
        │
        ▼
Organizer checks the payment and sets  Payment status = Confirmed
        │   (an "On edit" trigger fires automatically)
        ▼
"Payment confirmed" email with a personal QR code is sent
        │
        ▼
Event day: staff scan the QR on checkin.html  →  Participated = Yes
```

## Project structure

| Path | Purpose |
| --- | --- |
| `index.html` | Landing page and registration form |
| `checkin.html` | Staff check-in scanner (only payment-confirmed registrations can be checked in) |
| `css/style.css` | All styling |
| `js/main.js` | Page switching, form validation, form submission |
| `js/config.js` | Holds `SCRIPT_URL` (your Google Apps Script web app URL) |
| `images/` | Logos and photos |
| `apps-script/Code.gs` | Backend. Pasted into Google Apps Script, **not** run locally |

## Form validation

- **Phone and emergency phone:** exactly 10 digits. Spaces and dashes are allowed while typing (`077 123 4567`) and are removed before saving, so the sheet stores plain digits (`0771234567`).
- **Email:** must have a proper domain and a final part of at least 2 letters (`name@mail.co.lk` is valid, `name@mail` is not).
- The same checks run again in `Code.gs`, so data sent around the form is also rejected.

## Setup

### 1. Google Sheet and Apps Script

1. Create a Google Sheet, then open **Extensions → Apps Script**.
2. Paste the contents of `apps-script/Code.gs` into the editor.
3. Edit the `CONFIG` block at the top:
   - `EVENT_NAME`, `EVENT_DATE`, `EVENT_TIME`, `EVENT_VENUE`, `ORGANISER`
   - `CONTACT_EMAIL` (used as the reply-to address)
   - `STAFF_PIN` – **change this**, staff type it on the check-in page
   - `PACKAGES` – package names and prices in LKR
4. Select the `setup` function and click **Run**. Approve the permissions. This creates the `Registrations` sheet, the Drive folder for receipts, and the automatic trigger.

### 2. Deploy as a web app

1. **Deploy → New deployment → Web app**
2. *Execute as:* **Me**, *Who has access:* **Anyone**
3. Copy the web app URL (it ends in `/exec`).

### 3. Connect the website

1. Paste the URL into `SCRIPT_URL` in `js/config.js`.
2. Open the folder in VS Code and run `index.html` with Live Server to test.
3. To host the site, upload `index.html`, `checkin.html`, `css/`, `js/` and `images/` together (for example to Vercel).

> Every time you change `Code.gs`, redeploy: **Deploy → Manage deployments → Edit → New version → Deploy**.
> Keep your own copy of `js/config.js` when updating the website files.

## The confirmation-email trigger

The "Payment confirmed" email is sent by an **installable On-edit trigger**. Running `setup()` creates it. To create it by hand:

1. In Apps Script, open **Triggers** (clock icon) → **+ Add Trigger**
2. Set:
   - Function to run: `onPaymentEdit`
   - Deployment: `Head`
   - Event source: `From spreadsheet`
   - Event type: `On edit`
3. Save and approve the permissions.

Things to know:

- Only **From spreadsheet → On edit** works. Delete any other `onPaymentEdit` trigger (On open, On change, time-driven).
- The email is sent from the Gmail of the account that **owns the trigger**. The registration email is sent from the account that deployed the web app. Use the same Google account for both so all mail appears in one Sent folder.
- The script skips any row whose **Email sent** is `Yes`.
- Payment status must be exactly `Confirmed`.
- Edits made by a script or an import do not fire the trigger. Edit the cell by hand in the sheet.

## Daily use

1. Open the sheet and check the receipt link for each new row.
2. Set **Payment status** to `Confirmed` (or `Rejected`) from the dropdown.
3. The participant receives the confirmation email with their QR code, and **Email sent** becomes `Yes`.
4. To resend an email: click the row, then **1 More Mile → Resend confirmation email (selected row)**.

### Event day

1. Staff open `checkin.html` on a phone and enter the staff PIN.
2. Scan each participant's QR code. The result is one of: checked in, already checked in, payment not confirmed, or not found.
3. **Participated** and **Checked in at** are filled in automatically.

## Troubleshooting

**Participant did not get the confirmation email**

| What the **Email sent** column shows | What to check |
| --- | --- |
| Blank or `No` | The trigger is missing. Open **Triggers** and make sure `onPaymentEdit` exists (see above), or run `setup()` again. |
| `FAILED` | Open **Executions** in Apps Script and read the error for the failed run. Common causes: missing permission for the QR image fetch (run `setup()` again and approve), or the daily email quota was reached. |
| `Yes`, but the email is not in your Sent folder | It was sent from the account that owns the trigger. Check that account's Gmail: `in:sent subject:"Payment confirmed"`. |
| `Yes`, and it is in Sent | Check for a bounce message in that inbox (wrong address), and the recipient's spam or promotions folder. |

To retest a row: set **Email sent** to `No`, change **Payment status** to `Pending`, then back to `Confirmed`.

**Form says "Server error" or nothing happens**
- Confirm `SCRIPT_URL` in `js/config.js` is the `/exec` URL of the latest deployment.
- Confirm the web app access is set to **Anyone**.
- If you edited `Code.gs`, redeploy a new version.

## Security notes

- Do not commit `.env*` files or `.vercel/` (they are already in `.gitignore`).
- Change `STAFF_PIN` from its default before the event.
- Each QR code is personal. Tell participants not to share it.
