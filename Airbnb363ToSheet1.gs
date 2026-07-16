/**
 * Airbnb363ToSheet1.gs
 * -----------------------------------------------------------------------
 * Fills the "363 Mycondo has no Little Hotelier" gap.
 *
 * Every other room's bookings land in Sheet1 via Little Hotelier sync.
 * Room 363 isn't on Little Hotelier at all, so its Airbnb bookings never
 * showed up in Sheet1 — which meant autoCreateApartmenteryBookings() in
 * loft-booking-invoice-todo's ApartmenteryAutomation.gs (which already
 * has 363 → unit 164250 mapped in ROOM_TO_UNIT_ID) never had anything to
 * pick up for that room.
 *
 * This closes that gap by parsing Airbnb's "Reservation confirmed" HOST
 * email — sent the moment a guest books, not the payout email that
 * arrives much later — and appending a matching row into Sheet1.
 *
 * Called from dailyEmailSync() (see Code.gs), which already runs hourly
 * via createDailyTrigger() — no separate trigger needed.
 *
 * SCOPE: only the two Airbnb listings that are both actually room 363 /
 * Mycondo — "Private apartment best location in Bangkok" (id 17444947)
 * and "Cosy apartment downtown Bangkok" (id 18163498). Every other
 * Airbnb listing is ignored here — those already come through Little
 * Hotelier.
 * -----------------------------------------------------------------------
 */

const AIRBNB_363_LISTING_IDS = ['17444947', '18163498'];
const AIRBNB_363_ROOM = '363';
const SRC_BOOKING_SHEET_NAME = 'Sheet1';
const AIRBNB_363_SEARCH_QUERY = 'from:automated@airbnb.com subject:"Reservation confirmed" newer_than:90d';

/**
 * Searches Gmail for Airbnb "Reservation confirmed" emails belonging to
 * the 363/Mycondo listings, and appends any not already present in
 * Sheet1 (deduped by ResId = 'ABB-' + confirmation code).
 */
function syncAirbnb363Reservations() {
  var ss = SpreadsheetApp.openById(MASTER_SHEET_ID);
  var sheet = ss.getSheetByName(SRC_BOOKING_SHEET_NAME);
  if (!sheet) throw new Error('ไม่พบชีต: ' + SRC_BOOKING_SHEET_NAME);

  var data = sheet.getDataRange().getValues();
  var header = data[0];
  var numCols = header.length;
  var col = {
    room:    header.indexOf('เลขห้อง'),
    guest:   header.indexOf('ชื่อแขก'),
    ci:      header.indexOf('เช็คอิน'),
    co:      header.indexOf('เช็คเอาท์'),
    channel: header.indexOf('Channel'),
    resId:   header.indexOf('ResId'),
    note:    header.indexOf('Note')
  };
  ['room','guest','ci','co','channel','resId'].forEach(function(k) {
    if (col[k] < 0) throw new Error('Sheet1 ไม่มีคอลัมน์ที่ต้องใช้ (key: ' + k + ')');
  });

  // Existing ResIds already in Sheet1 → dedupe key, so re-running this
  // (every hourly dailyEmailSync run) never creates duplicate rows.
  var existingResIds = {};
  for (var r = 1; r < data.length; r++) {
    var v = String(data[r][col.resId] || '').trim();
    if (v) existingResIds[v] = true;
  }

  var threads = GmailApp.search(AIRBNB_363_SEARCH_QUERY, 0, 50);
  var newRows = [];

  threads.forEach(function(thread) {
    thread.getMessages().forEach(function(msg) {
      var parsed = parseAirbnb363ReservationEmail_(msg);
      if (!parsed) return;

      var resId = 'ABB-' + parsed.confCode;
      if (existingResIds[resId]) return;
      existingResIds[resId] = true; // guard against dupes within the same run too

      var row = new Array(numCols).fill('');
      row[col.room]    = AIRBNB_363_ROOM;
      row[col.guest]   = parsed.guest;
      row[col.ci]      = parsed.checkin;
      row[col.co]      = parsed.checkout;
      row[col.channel] = 'Airbnb';
      row[col.resId]   = resId;
      if (col.note >= 0) row[col.note] = 'auto: 363 Mycondo (' + parsed.confCode + ')';
      newRows.push(row);
    });
  });

  if (newRows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, numCols).setValues(newRows);
  }
  Logger.log('syncAirbnb363Reservations: เพิ่ม ' + newRows.length + ' booking ใหม่เข้า Sheet1');
  return newRows.length;
}

/**
 * Returns {guest, checkin, checkout, confCode} for a 363/Mycondo Airbnb
 * "Reservation confirmed" email, or null if this message doesn't match
 * (wrong listing, or the expected fields weren't found).
 */
function parseAirbnb363ReservationEmail_(msg) {
  var raw = msg.getPlainBody();
  if (!raw) return null;

  // Same quoted-printable cleanup parseAirbnbEmail() already relies on.
  var text = raw.replace(/=\r?\n/g, '');
  text = decodeQP(text);
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Identify the listing by its stable Airbnb room id in the listing URL
  // — not by title, since the listing title can be edited later.
  var isOurListing = AIRBNB_363_LISTING_IDS.some(function(id) {
    return text.indexOf('airbnb.com/rooms/' + id) >= 0;
  });
  if (!isOurListing) return null;

  var confMatch = text.match(/CONFIRMATION CODE\s*\r?\n\s*([A-Z0-9]{6,14})/);
  if (!confMatch) return null;
  var confCode = confMatch[1];

  // "Check-in      Checkout\n              \nThu, Jul 23   Mon, Aug 24"
  var dateLineMatch = text.match(
    /Check-in\s+Checkout[\s\S]{0,120}?\n\s*([A-Za-z]{3}, [A-Za-z]{3} \d{1,2})\s+([A-Za-z]{3}, [A-Za-z]{3} \d{1,2})/
  );
  if (!dateLineMatch) return null;

  var emailDate = msg.getDate();
  var checkin = resolveAirbnb363EmailDate_(dateLineMatch[1], emailDate);
  var checkout = resolveAirbnb363EmailDate_(dateLineMatch[2], emailDate);
  if (!checkin || !checkout) return null;

  // Guest name — most reliably pulled from the subject line:
  // "Reservation confirmed - Chani Boran arrives Jul 23"
  var subj = msg.getSubject() || '';
  var guestMatch = subj.match(/Reservation confirmed - (.+?) arrives/);
  var guest = guestMatch ? guestMatch[1].trim() : '';
  if (!guest) return null;

  return { guest: guest, checkin: checkin, checkout: checkout, confCode: confCode };
}

/**
 * "Thu, Jul 23" + the email's own Date header → "2026-07-23".
 * The email body never states the year, so it's inferred from the
 * email's send date: if the parsed month/day would land more than ~60
 * days in the past relative to the email itself, it must mean next year
 * (e.g. a reservation email sent in December for a January stay).
 */
function resolveAirbnb363EmailDate_(str, emailDate) {
  var m = str.match(/([A-Za-z]{3}), ([A-Za-z]{3}) (\d{1,2})/);
  if (!m) return '';
  var MONTHS = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
  var mo = MONTHS[m[2]];
  if (mo === undefined) return '';
  var day = parseInt(m[3], 10);

  var emailYear = emailDate.getFullYear();
  var candidate = new Date(emailYear, mo, day);
  var diffDays = (candidate.getTime() - emailDate.getTime()) / 86400000;
  if (diffDays < -60) candidate = new Date(emailYear + 1, mo, day);

  return Utilities.formatDate(candidate, 'Asia/Bangkok', 'yyyy-MM-dd');
}
