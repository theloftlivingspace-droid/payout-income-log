// ═══════════════════════════════════════════════════════════════
// PayPalDirectBooking.gs  (v1, 2026-09-09)
// Direct-booking guests who pay via PayPal. Per Nathan: PayPal auto-
// withdraws the account balance to SCB once it reaches ฿5,000 — so one
// SCB deposit can represent several PayPal payments bundled together,
// the same shape as Airbnb/Trip.com/Expedia payout batches already
// handled by matchSCBtoOTA() in Code.gs.
//
// ⚠️ FLAGGED LIMITATIONS (not silently papered over):
// 1) parsePayPalEmail() below is written against PayPal's commonly
//    documented "payment received" notification wording (sender
//    service@paypal.com, "You've received a payment" / Thai
//    "ได้รับการชำระเงิน"). It has NOT been validated against a live
//    email from this PayPal account — I had no sample to check
//    against. Spot-check the first few parsed rows (Payout_Income_Log
//    tab, OTA='PayPal') after the next sync before trusting it
//    unattended, and forward a sample notification email if the
//    guest/amount don't come through cleanly so the regex can be
//    tightened.
// 2) Unlike Airbnb/Trip/Expedia — where the OTA's own payout email
//    states the exact net batch total — PayPal deducts its receiving
//    fee per transaction, and that fee isn't restated anywhere this
//    script can read. So the sum of parsed PayPal rows (gross, what the
//    guest paid) will NOT equal the SCB deposit (net of fees) to the
//    cent. matchSCBtoPayPal() below matches by date window + a sane
//    fee-ratio check (0–10%) instead of the exact-cents subset-sum
//    matchSCBtoOTA() uses — the computed fee is written into the match
//    note for a manual sanity check against PayPal's actual per-
//    transaction fee.
// 3) Room is left '?' — direct-booking guests don't have an OTA
//    conf-code to look up. matchRoomFromSheet1() (already run every
//    cycle) will still resolve it if/when the guest is logged in
//    Sheet1 under the same name.
// ═══════════════════════════════════════════════════════════════

// Built lazily (not a top-level const/var) so it never depends on file load
// order relative to Code.gs's SEARCH_FROM constant.
function paypalSearchQ_(sinceStr) {
  return '(from:service@paypal.com OR from:paypal@e.paypal.com OR from:member@paypal.com) '
    + '(subject:"payment" OR subject:"receipt" OR subject:"ได้รับ" OR subject:"you\'ve got money") '
    + 'after:' + (sinceStr || SEARCH_FROM);
}

// Parses a single PayPal "money received" notification. Returns null for
// any PayPal email that isn't a received-payment notice (invoices sent,
// subscription/billing mail, security alerts, etc.) so callers can skip it.
function parsePayPalEmail(msg) {
  var subj = msg.getSubject() || '';
  var dt   = fmtDate(msg.getDate());
  var body = msg.getPlainBody() || '';
  if (!body || body.trim().length < 20) {
    var html = msg.getBody() || '';
    if (html) {
      body = stripHTML(html.replace(/=\r?\n/g,'').replace(/=3D/g,'=')
                            .replace(/&nbsp;/g,' ').replace(/&amp;/g,'&'));
    }
  }
  if (!body || body.trim().length < 10) return null;

  var isReceived = /you'?ve received|you'?ve got money|payment received|payment from|ได้รับการชำระเงิน|ได้รับเงิน|การชำระเงินจาก/i.test(body + ' ' + subj);
  if (!isReceived) return null;
  // Skip PayPal's own outbound-transfer notices (PayPal→bank withdrawal) —
  // those are parsed as ordinary incoming SCB deposits by parseSCBEmail()
  // already; we only want the guest→PayPal leg here.
  if (/sent to your bank|withdrawal|โอนเงินไปที่|payout was sent/i.test(subj)) return null;

  var amount = gRe(body, /(?:received|payment of|ได้รับ)[^0-9]{0,40}(?:THB|บาท|[฿\u0e3f])\s*([\d,]+\.\d{2})/i);
  if (!amount) amount = gRe(body, /[฿\u0e3f]\s*([\d,]+\.\d{2})\s*THB/i);
  if (!amount) return null;

  var guest = gRe(body, /(?:payment from|received from|from)\s+([A-Za-zก-๙][A-Za-zก-๙\s.'-]{1,58}?)(?:\r?\n|\.\s|\s{2,}|$)/i);
  if (!guest) guest = gRe(body, /จาก\s*([^\n\r]{2,60})/);
  guest = (guest || 'Unknown').replace(/\s+/g,' ').trim();

  var txnId = gRe(body, /Transaction ID[:\s]*([A-Z0-9]{10,})/i);
  if (!txnId) txnId = gRe(body, /หมายเลขรายการ[:\s]*([A-Z0-9]{10,})/);

  var amtClean = amount.replace(/,/g,'');
  var bookingId = txnId
    ? 'PP-' + txnId
    : 'PP-' + dt.replace(/-/g,'') + '-' + guest.replace(/\s+/g,'').slice(0,12) + '-' + Math.round(parseFloat(amtClean) * 100);

  return makeRow('PayPal', dt, bookingId, txnId || '',
    guest, '?', '', '', '',
    amtClean, '', amtClean,
    'รอโอนเข้าบัญชี (PayPal)',
    'PayPal direct booking payment | ' + subj);
}

// Array-returning wrapper — fullRebuild()/dailyEmailSync() expect
// s.fn(msg).forEach(...), same shape as parseAirbnbEmail/parseLHEmail/etc.
function parsePayPalEmailRows(msg) {
  var row = parsePayPalEmail(msg);
  return row ? [row] : [];
}

// Called right after matchSCBtoOTA(sheet) in the pipeline (quickReformat,
// fullRebuild, dailyEmailSync). Pools not-yet-settled PayPal rows and looks
// for an SCB deposit whose net is plausibly "gross minus PayPal fee" —
// see limitation #2 in the file header re: why this isn't exact-cents.
function matchSCBtoPayPal(sheet) {
  if (!sheet) { var ss = SpreadsheetApp.openById(MASTER_SHEET_ID); sheet = ss.getSheetByName(TAB_NAME); }
  if (!sheet) return;
  var last = sheet.getLastRow();
  if (last < 2) return;
  var data = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();

  var ppRows = [];
  data.forEach(function(row, i) {
    if ((row[C.ota-1]||'').toString().trim() !== 'PayPal') return;
    if ((row[C.status-1]||'').toString().indexOf('รอโอนเข้าบัญชี') !== 0) return;
    ppRows.push({
      rowIndex: i+2,
      guest: (row[C.guest-1]||'').toString(),
      net: parseFloat((row[C.net-1]||0).toString().replace(/,/g,'')) || 0,
      dateStr: normalizeDate(row[C.date-1])
    });
  });
  if (!ppRows.length) return;

  var ops = [];
  var usedRowIndices = {};
  data.forEach(function(row, i) {
    var ota = (row[C.ota-1]||'').toString();
    if (!ota.startsWith('SCB')) return;
    var notes = (row[C.notes-1]||'').toString();
    if (notes.indexOf('✅')===0 || notes.indexOf('↳')===0) return; // already matched to something else

    var scbAmt  = parseFloat((row[C.net-1]||0).toString().replace(/,/g,'')) || 0;
    var scbDate = normalizeDate(row[C.date-1]);
    var scbTs   = new Date(scbDate).getTime();

    var pool = ppRows.filter(function(r) {
      if (usedRowIndices[r.rowIndex]) return false;
      var diffDays = (scbTs - new Date(r.dateStr).getTime()) / 86400000;
      return diffDays >= -3 && diffDays <= 21; // PayPal→SCB withdrawal typically lands within ~1–3 weeks
    });
    if (!pool.length || pool.length > 12) return; // guard against runaway 2^n search

    var best = null;
    for (var mask = 1; mask < (1 << pool.length); mask++) {
      var subset = [], grossSum = 0;
      for (var b = 0; b < pool.length; b++) {
        if (mask & (1 << b)) { subset.push(pool[b]); grossSum += pool[b].net; }
      }
      if (grossSum <= 0) continue;
      var exact = Math.abs(grossSum - scbAmt) <= 0.005;
      var feeRatio = (grossSum - scbAmt) / grossSum;
      var plausibleFee = feeRatio >= 0 && feeRatio <= 0.10;
      if (exact) { best = {subset:subset, grossSum:grossSum, feeRatio:0}; break; }
      if (plausibleFee && (!best || subset.length > best.subset.length)) {
        best = {subset:subset, grossSum:grossSum, feeRatio:feeRatio};
      }
    }
    if (!best) return;

    var feeAmt = (best.grossSum - scbAmt).toFixed(2);
    var note = 'PayPal → SCB | ' + best.subset.map(function(r){ return r.guest+' ฿'+r.net.toFixed(2); }).join(' + ')
      + ' = ฿' + best.grossSum.toFixed(2) + ' gross, fee ~฿' + feeAmt
      + ' (' + (best.feeRatio*100).toFixed(1) + '%) — verify against PayPal fee manually'
      + ' | net ฿' + scbAmt.toFixed(2) + ' | Value Date: ' + scbDate;

    ops.push({ scbRow:i+2, ppRows:best.subset, note:note });
    best.subset.forEach(function(r){ usedRowIndices[r.rowIndex] = true; });
  });

  // Apply top-down by row number so earlier edits don't shift later row indices.
  ops.sort(function(a,b){ return b.scbRow - a.scbRow; });
  ops.forEach(function(op) {
    sheet.getRange(op.scbRow, C.ota).setValue('SCB (PayPal)');
    sheet.getRange(op.scbRow, C.status).setValue('✅ Matched - PayPal direct booking');
    sheet.getRange(op.scbRow, C.guest).setValue(op.ppRows.map(function(r){return r.guest;}).join(', '));
    sheet.getRange(op.scbRow, C.notes).setValue(op.note);
    op.ppRows.forEach(function(r) {
      sheet.getRange(r.rowIndex, C.status).setValue('โอนแล้ว (PayPal→SCB)');
      var nc = sheet.getRange(r.rowIndex, C.notes);
      nc.setValue(((nc.getValue()||'').toString()) + ' | ' + op.note);
    });
  });
  Logger.log('matchSCBtoPayPal: ' + ops.length + ' SCB deposit(s) matched to PayPal batch(es)');
}

// ── One-off: record the 2 known PayPal payments visible in the 2026-09-09
// PayPal activity screenshot (Kari Ramsey ฿5,892.00, Florian Lintner
// ฿800.00), plus a note on the pending ฿6,353.40 SCB withdrawal (PayPal txn
// 77304910AM099910C, expected ~17 Sep 2026), so they're in the sheet now
// rather than waiting on Gmail search to find the original PayPal emails
// (which this account may not have, or which may not match the regex above
// yet — see limitation #1). Safe to re-run: skips rows that already exist.
// Once the actual SCB deposit email arrives and gets parsed, matchSCBtoPayPal()
// will match against these automatically on the next sync/quickReformat.
// ── One-off, run manually once from the Apps Script editor. ──
function recordKnownPayPalPayments_20260909() {
  var ss = SpreadsheetApp.openById(MASTER_SHEET_ID);
  var sheet = ss.getSheetByName(TAB_NAME);
  if (!sheet) { Logger.log('sheet not found'); return 0; }
  var last = sheet.getLastRow();
  var existing = {};
  if (last >= 2) {
    sheet.getRange(2, C.bid, last - 1, 1).getValues().forEach(function(r) {
      if (r[0]) existing[r[0].toString().trim()] = true;
    });
  }
  var known = [
    { date:'2026-09-02', guest:'Kari Ramsey',     amt:'5892.00' },
    { date:'2026-08-31', guest:'Florian Lintner', amt:'800.00'  }
  ];
  var rows = [];
  known.forEach(function(k) {
    var bid = 'PP-' + k.date.replace(/-/g,'') + '-' + k.guest.replace(/\s+/g,'');
    if (existing[bid]) return;
    rows.push(makeRow('PayPal', k.date, bid, '',
      k.guest, '?', '', '', '',
      k.amt, '', k.amt,
      'รอโอนเข้าบัญชี (PayPal)',
      'PayPal direct booking payment — manually recorded from PayPal activity screenshot 2026-09-09 | '
      + 'รอ SCB ฿6,353.40 คาดถึง 17/9/2026 (PayPal withdrawal txn 77304910AM099910C)'));
  });
  if (rows.length) {
    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rows.length, HEADERS.length).setValues(
      rows.map(function(r){
        return [r.date, r.ota, r.bookingId, r.confCode, r.guest, r.room,
                r.checkIn, r.checkOut, r.nights, r.total, r.commission, r.net,
                r.status, r.notes];
      })
    );
  }
  Logger.log('recordKnownPayPalPayments_20260909: ' + rows.length + ' rows added (of ' + known.length + ' known)');
  return rows.length;
}
