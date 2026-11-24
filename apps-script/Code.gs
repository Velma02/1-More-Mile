/**
 * 1 More Mile – registration backend (Google Apps Script)
 *
 * Flow:  Website form (+ bank transfer receipt)  ->  Google Sheet + Google Drive
 *        -> Organizer sets Payment status  Pending -> Confirmed
 *        -> Automatic confirmation email with the unique QR code
 *        -> Staff scan the QR on event day to mark "Participated".
 *
 * Setup steps are in the chat. Edit CONFIG, run setup() once, then deploy as a Web app.
 */
const CONFIG = {
  EVENT_NAME:    '1 More Mile',
  EVENT_DATE:    '20 December 2026',
  EVENT_TIME:    '6:00 AM warm-up, 6:30 AM flag-off (event ends 9:00 AM)',
  EVENT_VENUE:   'Independence Square, Colombo',
  ORGANISER:     'AIESEC in University of Colombo',
  CONTACT_EMAIL: '',                      // e.g. events@example.com (used as reply-to)
  STAFF_PIN:     'CHANGE-ME-1234',        // PIN staff type on the check-in page. Change it!
  SHEET_NAME:    'Registrations',
  RECEIPT_FOLDER:'1 More Mile - Payment Receipts',
  PACKAGES: { Starter: 500, Pacesetter: 1200, Elite: 2500 },   // LKR
  MAX_RECEIPT_MB: 5
};

const HEADERS = ['Timestamp','ID','Name','Age','Gender','Phone','Email','Distance','Package',
  'T-shirt size','Emergency contact','Emergency phone','Privacy consent at','Marketing opt-in',
  'Amount (LKR)','Receipt','Payment status','Confirmed at','Participated','Checked in at','Email sent',
  'Run club','Referral'];   // new columns are added at the END so existing columns don't move
const COL = {}; HEADERS.forEach(function (h, i) { COL[h] = i + 1; });   // column numbers by name

/* ============ entry points ============ */
function doGet() { return json_({ ok: true, message: CONFIG.EVENT_NAME + ' registration service is running' }); }

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.action === 'register') return json_(register_(d));
    if (d.action === 'checkin')  return json_(checkIn_(d));
    return json_({ ok: false, error: 'Unknown request.' });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'Server error. Please try again.' });
  }
}

/* ============ 1. Registration (saved as Pending) ============ */
function register_(d) {
  const required = ['name', 'age', 'gender', 'phone', 'email', 'distance', 'package', 'ecname', 'ecphone'];   // run club + referral are optional
  for (const k of required) {
    if (!d[k] || String(d[k]).trim() === '') return { ok: false, error: 'Please fill in all required fields.' };
  }
  if (d.privacy !== true) return { ok: false, error: 'Please accept the Privacy Notice.' };
  const email = String(d.email).trim().toLowerCase();
  if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(email)) return { ok: false, error: 'Please enter a valid email address.' };
  d.phone = String(d.phone).replace(/[\s-]/g, '');
  d.ecphone = String(d.ecphone).replace(/[\s-]/g, '');
  if (!/^\d{10}$/.test(d.phone)) return { ok: false, error: 'Please enter a 10-digit contact number.' };
  if (!/^\d{10}$/.test(d.ecphone)) return { ok: false, error: 'Please enter a 10-digit emergency contact number.' };

  // receipt checks
  const rc = d.receipt;
  if (!rc || !rc.data || !rc.type) return { ok: false, error: 'Please upload your payment receipt.' };
  const types = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' };
  if (!types[rc.type]) return { ok: false, error: 'Receipt must be a JPG, PNG or PDF file.' };
  if (rc.data.length * 0.75 > CONFIG.MAX_RECEIPT_MB * 1024 * 1024) return { ok: false, error: 'Receipt file is too large (max ' + CONFIG.MAX_RECEIPT_MB + ' MB).' };

  const pkgName = String(d.package);
  if (!Object.prototype.hasOwnProperty.call(CONFIG.PACKAGES, pkgName)) return { ok: false, error: 'Please choose a valid package.' };
  const isShirt = pkgName === 'Elite';          // only Elite includes the T-shirt
  if (isShirt && clean_(d.shirt) === '') return { ok: false, error: 'Please choose your T-shirt size.' };
  const amount = CONFIG.PACKAGES[pkgName];      // price is set here, not trusted from the browser

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let id;
  try {
    const sheet = getSheet_();
    const last = sheet.getLastRow();
    if (last > 1) {
      const emails = sheet.getRange(2, COL.Email, last - 1, 1).getValues().flat().map(function (x) { return String(x).toLowerCase(); });
      if (emails.indexOf(email) > -1) return { ok: false, error: 'This email is already registered.' };
    }
    const ids = last > 1 ? sheet.getRange(2, COL.ID, last - 1, 1).getValues().flat() : [];
    do { id = '1MM-' + randomCode_(6); } while (ids.indexOf(id) > -1);

    // save the receipt in Google Drive
    const blob = Utilities.newBlob(Utilities.base64Decode(rc.data), rc.type, id + '_' + safeName_(d.name) + '.' + types[rc.type]);
    const file = getReceiptFolder_().createFile(blob);

    const now = new Date();
    const rec = {
      'Timestamp': now, 'ID': id, 'Name': clean_(d.name), 'Age': clean_(d.age), 'Gender': clean_(d.gender),
      'Phone': clean_(d.phone), 'Email': email, 'Distance': clean_(d.distance), 'Package': pkgName,
      'T-shirt size': isShirt ? clean_(d.shirt) : 'N/A', 'Emergency contact': clean_(d.ecname), 'Emergency phone': clean_(d.ecphone),
      'Privacy consent at': now, 'Marketing opt-in': d.marketing ? 'Yes' : 'No', 'Amount (LKR)': amount,
      'Receipt': file.getUrl(), 'Payment status': 'Pending', 'Confirmed at': '', 'Participated': 'No', 'Checked in at': '', 'Email sent': 'No',
      'Run club': clean_(d.runclub), 'Referral': clean_(d.referral)
    };
    sheet.appendRow(HEADERS.map(function (h) { return rec[h]; }));
  } finally {
    lock.releaseLock();
  }
  // Immediate "we received your registration" email (no QR yet). A failure here must not lose the registration.
  try { sendReceived_(email, d, isShirt, amount); } catch (err) { console.error('Received-email failed', err); }
  return { ok: true, id: id };
}

function sendReceived_(email, d, isShirt, amount) {
  const html =
    '<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#0b1f44">' +
    '<div style="background:#083888;color:#fff;padding:22px;border-radius:14px 14px 0 0;text-align:center">' +
    '<h2 style="margin:0">' + esc_(CONFIG.EVENT_NAME) + '</h2><div>We’ve received your registration</div></div>' +
    '<div style="border:1px solid #dbe5f1;border-top:0;padding:22px;border-radius:0 0 14px 14px">' +
    '<p>Hi ' + esc_(clean_(d.name)) + ',</p>' +
    '<p>Thank you for registering. We have your details and your payment receipt. Your payment status is <b style="color:#c2410c">Pending</b>.</p>' +
    '<p>Once the organisers verify your payment, you will receive a second email with your personal QR code. You will need that QR code to check in on the day.</p>' +
    '<table style="width:100%;font-size:14px;border-collapse:collapse">' +
    tr_('Distance', clean_(d.distance)) + tr_('Package', clean_(d.package)) +
    tr_('Amount', 'LKR ' + amount) + '</table>' +
    '<p style="font-size:13px;color:#52668a">Organized by ' + esc_(CONFIG.ORGANISER) + '</p></div></div>';
  const opts = { to: email, subject: 'We received your registration – ' + CONFIG.EVENT_NAME, htmlBody: html, name: CONFIG.EVENT_NAME };
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(CONFIG.CONTACT_EMAIL)) opts.replyTo = CONFIG.CONTACT_EMAIL;
  MailApp.sendEmail(opts);
}

/* ============ 2. Organizer confirms payment -> email with QR ============ */
// Runs automatically when someone edits the sheet (installed by setup()).
function onPaymentEdit(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() !== CONFIG.SHEET_NAME) return;
  const c = COL['Payment status'];
  if (e.range.getColumn() > c || e.range.getLastColumn() < c) return;

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    for (let r = Math.max(e.range.getRow(), 2); r <= e.range.getLastRow(); r++) processRow_(sheet, r, false);
  } finally {
    lock.releaseLock();
  }
}

function processRow_(sheet, r, force) {
  const row = sheet.getRange(r, 1, 1, HEADERS.length).getValues()[0];
  if (!row[COL.ID - 1] || row[COL['Payment status'] - 1] !== 'Confirmed') return false;
  if (!force && row[COL['Email sent'] - 1] === 'Yes') return false;
  if (!row[COL['Confirmed at'] - 1]) sheet.getRange(r, COL['Confirmed at']).setValue(new Date());
  try {
    sendConfirmation_(row);
    sheet.getRange(r, COL['Email sent']).setValue('Yes');
    return true;
  } catch (err) {
    console.error('Email failed', err);
    sheet.getRange(r, COL['Email sent']).setValue('FAILED');
    return false;
  }
}

// Menu: 1 More Mile -> Resend confirmation email (selected row)
function onOpen() {
  SpreadsheetApp.getUi().createMenu('1 More Mile')
    .addItem('Resend confirmation email (selected row)', 'resendSelected').addToUi();
}
function resendSelected() {
  const sheet = SpreadsheetApp.getActiveSheet(), ui = SpreadsheetApp.getUi();
  const r = sheet.getActiveRange().getRow();
  if (sheet.getName() !== CONFIG.SHEET_NAME || r < 2) { ui.alert('Click a registration row first.'); return; }
  ui.alert(processRow_(sheet, r, true) ? 'Email sent.' : 'Not sent. The payment status must be "Confirmed", and the email address must be valid.');
}

function sendConfirmation_(row) {
  const id = row[COL.ID - 1];
  const qr = UrlFetchApp.fetch('https://api.qrserver.com/v1/create-qr-code/?size=400x400&margin=10&format=png&data=' +
    encodeURIComponent(id)).getBlob().setName(id + '.png');
  const shirt = row[COL['T-shirt size'] - 1];
  const html =
    '<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#0b1f44">' +
    '<div style="background:#083888;color:#fff;padding:22px;border-radius:14px 14px 0 0;text-align:center">' +
    '<h2 style="margin:0">' + esc_(CONFIG.EVENT_NAME) + '</h2><div>Your payment is confirmed. You’re in!</div></div>' +
    '<div style="border:1px solid #dbe5f1;border-top:0;padding:22px;border-radius:0 0 14px 14px">' +
    '<p>Hi ' + esc_(row[COL.Name - 1]) + ',</p>' +
    '<p>Thank you for registering. We have verified your payment. Show the QR code below at the check-in desk on the day, on your phone or printed.</p>' +
    '<p style="text-align:center"><img src="cid:qr" width="220" height="220" alt="Your QR code"><br><b>' + esc_(id) + '</b></p>' +
    '<table style="width:100%;font-size:14px;border-collapse:collapse">' +
    tr_('Date', CONFIG.EVENT_DATE) + tr_('Flag-off', CONFIG.EVENT_TIME) + tr_('Venue', CONFIG.EVENT_VENUE) +
    tr_('Distance', row[COL.Distance - 1]) + tr_('Package', row[COL.Package - 1]) + (shirt !== 'N/A' ? tr_('T-shirt size', shirt) : '') +
    tr_('Amount paid', 'LKR ' + row[COL['Amount (LKR)'] - 1]) + '</table>' +
    '<p style="font-size:13px;color:#52668a">Please keep this email. Each QR code is personal, so don’t share it.' +
    (CONFIG.CONTACT_EMAIL ? ' Questions? Reply to this email or write to ' + esc_(CONFIG.CONTACT_EMAIL) + '.' : '') + '</p>' +
    '<p style="font-size:13px;color:#52668a">Organized by ' + esc_(CONFIG.ORGANISER) + '</p></div></div>';
  const opts = { to: row[COL.Email - 1], subject: 'Payment confirmed – your QR code for ' + CONFIG.EVENT_NAME, htmlBody: html,
    name: CONFIG.EVENT_NAME, inlineImages: { qr: qr }, attachments: [qr] };
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(CONFIG.CONTACT_EMAIL)) opts.replyTo = CONFIG.CONTACT_EMAIL;
  MailApp.sendEmail(opts);
}

/* ============ 3. Event day check-in ============ */
function checkIn_(d) {
  if (String(d.pin || '') !== String(CONFIG.STAFF_PIN)) return { ok: false, error: 'Wrong staff PIN.' };
  const id = String(d.id || '').trim().toUpperCase();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getSheet_();
    const last = sheet.getLastRow();
    if (last < 2) return { ok: true, status: 'not_found' };
    const rows = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (String(r[COL.ID - 1]).toUpperCase() !== id) continue;
      const info = { name: r[COL.Name - 1], distance: r[COL.Distance - 1], package: r[COL.Package - 1],
        shirt: r[COL['T-shirt size'] - 1], payment: r[COL['Payment status'] - 1] };
      if (info.payment !== 'Confirmed') return Object.assign({ ok: true, status: 'not_confirmed' }, info);
      if (r[COL.Participated - 1] === 'Yes') return Object.assign({ ok: true, status: 'already', at: fmt_(r[COL['Checked in at'] - 1]) }, info);
      sheet.getRange(i + 2, COL.Participated, 1, 2).setValues([['Yes', new Date()]]);
      return Object.assign({ ok: true, status: 'checked_in' }, info);
    }
    return { ok: true, status: 'not_found' };
  } finally {
    lock.releaseLock();
  }
}

/* ============ setup & helpers ============ */
// Run this once from the Apps Script editor: creates the sheet, the Drive folder and the automatic trigger.
function setup() {
  getSheet_();
  getReceiptFolder_();
  // Remove any old/wrong trigger for onPaymentEdit, then create the correct "On edit" one.
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onPaymentEdit') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onPaymentEdit').forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet()).onEdit().create();
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold').setBackground('#083888').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.getRange(1, COL.Name, 1000, 10).setNumberFormat('@');   // Name..Emergency phone stay plain text
    ['Timestamp', 'Privacy consent at', 'Confirmed at', 'Checked in at'].forEach(function (h) {
      sheet.getRange(2, COL[h], 1000, 1).setNumberFormat('d MMM yyyy h:mm a');
    });
    // Payment status: dropdown + colours (Pending orange, Confirmed green, Rejected red)
    const pay = sheet.getRange(2, COL['Payment status'], 1000, 1);
    pay.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Pending', 'Confirmed', 'Rejected'], true).build());
    const rule = function (txt, bg, fg) {
      return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(txt).setBackground(bg).setFontColor(fg).setRanges([pay]).build();
    };
    sheet.setConditionalFormatRules([rule('Pending', '#fde7d3', '#c2410c'), rule('Confirmed', '#d6f5e3', '#0f7a43'), rule('Rejected', '#fde2e2', '#b42318')]);
  }
  return sheet;
}

function getReceiptFolder_() {
  const it = DriveApp.getFoldersByName(CONFIG.RECEIPT_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(CONFIG.RECEIPT_FOLDER);
}

function randomCode_(n) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no look-alike characters
  let s = ''; for (let i = 0; i < n; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}
function clean_(v) { return String(v == null ? '' : v).trim().slice(0, 200); }
function safeName_(v) { return String(v).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'participant'; }
function esc_(v) { return String(v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function tr_(a, b) { return '<tr><td style="padding:6px 0;color:#52668a">' + a + '</td><td style="padding:6px 0;text-align:right"><b>' + esc_(b) + '</b></td></tr>'; }
function fmt_(d) { return d instanceof Date ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'd MMM, h:mm a') : String(d); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }