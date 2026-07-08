// ═══════════════════════════════════════════════════════════════════════
// BookingInvoiceTodo.gs  — GAS Web App for The Loft Admin (Vercel)
// แก้ปัญหา matchKeys จับคู่น้อยมาก:
//   1. ชื่อสลับ order: "Sharif, Abdalla" vs "Abdalla Sharif"
//   2. ชื่อสั้นกว่า: "Zachary" vs "Zachary Wissing" → ใช้ prefix match
//   3. Timezone offset ทำให้วันเหลื่อม → normalize เป็น YYYY-MM-DD ก่อน
//   4. ห้องหลายห้องใน 1 invoice row → split แล้ว match ทีละห้อง
// ═══════════════════════════════════════════════════════════════════════

const SS_ID        = '1XbTJLhecql_HNqyE80Hc6h30A2_elIxliudF4e6Rlz0';
const SHEET1_TAB   = 'Sheet1';
const LEDGER_TAB   = 'Bank_Ledger';
const TODO_TAB     = 'BookingTodo';   // sheet เก็บ done state (สร้างอัตโนมัติถ้าไม่มี)

// doGet is defined in Code.gs and delegates ?action= requests to handleRequest() below.

function handleRequest(p) {
  var action = p.action || '';

  if (action === 'getData')        return buildData();
  if (action === 'setBookingDone') return setDone('booking', p.id, p.done === 'true');
  if (action === 'setInvoiceDone') return setDone('invoice', p.id, p.done === 'true');
  if (action === 'setNote')        return setNote(p.resId, p.note || '');

  return { error: 'unknown action' };
}

// ── buildData ──────────────────────────────────────────────────────────
function buildData() {
  var ss     = SpreadsheetApp.openById(SS_ID);
  var today  = fmtDate(new Date());

  var bookings = readBookings(ss, today);
  var invoices = readInvoices(ss, today);

  // ── build matchKey cross-sets ─────────────────────────────────────
  // สร้าง name-prefix index จาก invoice เพื่อ fuzzy match ชื่อสั้น
  var invNamePrefixes = buildNamePrefixes(invoices);   // map: prefix6 → [invoiceKey]
  var bkNamePrefixes  = buildNamePrefixes(bookings);

  // ใส่ matchKeys
  bookings.forEach(function(b) {
    b.matchKeys = buildBookingMatchKeys(b, invNamePrefixes);
  });
  invoices.forEach(function(inv) {
    inv.matchKeys = buildInvoiceMatchKeys(inv, bkNamePrefixes);
  });

  return { today: today, booking: bookings, invoice: invoices };
}

// ── readBookings (Sheet1) ──────────────────────────────────────────────
function readBookings(ss, today) {
  var sheet = ss.getSheetByName(SHEET1_TAB);
  var rows  = sheet.getDataRange().getValues();
  var doneMap = getDoneMap('booking');
  var firstSeenMap = getFirstSeenMap('booking');

  var result = [], mode = 'start';
  for (var i = 0; i < rows.length; i++) {
    var r  = rows[i];
    var c0 = String(r[0] || '').trim();
    if (c0 === 'เลขห้อง') { mode = 'bookings'; continue; }
    if (mode !== 'bookings' || !c0) continue;

    var resId   = String(r[5] || '').trim();
    var checkin = normDate(r[2]);
    var checkout= normDate(r[3]);
    if (!resId) continue;

    // firstSeen: ครั้งแรกที่เห็น resId นี้
    var fs = firstSeenMap[resId] || today;
    if (!firstSeenMap[resId]) {
      firstSeenMap[resId] = today;
      saveFirstSeen('booking', resId, today);
    }

    result.push({
      resId      : resId,
      room       : c0,
      guest      : String(r[1] || ''),
      checkin    : checkin,
      checkout   : checkout,
      channel    : String(r[4] || ''),
      note       : String(r[6] || ''),
      firstSeen  : fs,
      isNewToday : (fs === today),
      done       : !!doneMap[resId],
      matchKeys  : []   // filled later
    });
  }
  return result;
}

// ── readInvoices (Bank_Ledger) ─────────────────────────────────────────
function readInvoices(ss, today) {
  var sheet  = ss.getSheetByName(LEDGER_TAB);
  var rows   = sheet.getDataRange().getValues();
  var doneMap      = getDoneMap('invoice');
  var firstSeenMap = getFirstSeenMap('invoice');

  // PASS 1: for SCB batch transactions, the same bid can appear on
  // several rows — one merged "total" row (comma-separated rooms/
  // guests/confs) PLUS one legacy single-conf row per guest. Naively
  // keeping "whichever row comes first" in sheet order silently drops
  // every guest except the one on that first row, since the merged
  // row (which is what actually gets split into one invoice per guest
  // below) gets skipped as a duplicate bid. So: pick the row with the
  // MOST comma-separated rooms per bid — that's always the complete
  // merged row when one exists, and falls back to the only row when
  // a bid has just a single row.
  var bestRowForBid = {};
  var ciCoByConf = {};
  for (var i = 1; i < rows.length; i++) {
    var r0  = rows[i];
    var bid0 = String(r0[2] || '').trim();
    if (!bid0) continue;
    var roomCount = String(r0[5] || '').split(',').map(function(x){ return x.trim(); }).filter(Boolean).length;
    var cur = bestRowForBid[bid0];
    if (!cur || roomCount > cur.roomCount) {
      bestRowForBid[bid0] = { index: i, roomCount: roomCount };
    }
    // legacy single-conf rows carry that guest's actual stay dates —
    // remember them so the merged-row split below can use real dates
    // instead of the merged row's shared earliest/latest range.
    // Keyed by bid+conf (not conf alone): a guest's Airbnb conf code stays
    // the same across their whole stay and gets reused on every new partial
    // payout for a long booking, so keying by conf alone let an unrelated
    // earlier/later payout's row silently win the lookup for this batch
    // (e.g. Nihel's conf matched a stale May payout instead of this one).
    var confSingle = String(r0[3] || '').trim();
    if (confSingle && confSingle.indexOf(',') < 0) {
      var ci0 = normDate(r0[6]), co0 = normDate(r0[7]);
      var net0 = parseFloat(String(r0[11]).replace(/,/g,'')) || 0;
      if (ci0 && co0) ciCoByConf[bid0 + '|' + confSingle] = { checkin: ci0, checkout: co0, net: net0 };
    }
  }

  var result = [], seen = {};
  for (var i = 1; i < rows.length; i++) {   // row 0 = header
    var r   = rows[i];
    var bid = String(r[2] || '').trim();
    if (!bid || seen[bid]) continue;
    if (bestRowForBid[bid] && bestRowForBid[bid].index !== i) continue; // not the chosen row for this bid
    seen[bid] = true;

    var detectedRaw = normDate(r[0]);
    var fs = firstSeenMap[bid] || detectedRaw;
    if (!firstSeenMap[bid]) {
      firstSeenMap[bid] = detectedRaw;
      saveFirstSeen('invoice', bid, detectedRaw);
    }

    var rooms   = String(r[5] || '').trim();
    var guests  = String(r[4] || '').trim();
    var confs   = String(r[3] || '').trim();
    var checkin = normDate(r[6]);
    var checkout= normDate(r[7]);
    var net     = parseFloat(String(r[11]).replace(/,/g,'')) || 0;
    var gross   = parseFloat(String(r[9]).replace(/,/g,''))  || 0;
    var nights  = parseInt(r[8]) || 0;
    var status  = String(r[12] || '');
    // per-guest net parsed straight from this row's own note text, keyed by
    // conf code — covers guests with no legacy single-conf row anywhere in
    // the sheet (previously fell back to the full merged total for all of
    // them instead of their real individual share).
    var noteNetByConf = parseNoteNetByConf_(String(r[13] || ''));

    // multi-booking rows (ห้องหลายห้องใน conf เดียว): split เป็น invoice ย่อย
    var roomList  = rooms.split(',').map(function(x){ return x.trim(); }).filter(Boolean);
    var guestList = guests.split(',').map(function(x){ return x.trim(); }).filter(Boolean);
    var confList  = confs.split(',').map(function(x){ return x.trim(); }).filter(Boolean);
    var isMulti   = roomList.length > 1;

    if (isMulti) {
      // แยกเป็น row ย่อย 1 row ต่อ 1 ห้อง
      for (var j = 0; j < roomList.length; j++) {
        var iKey = bid + ':' + j;
        var jConf = confList[j];
        var jCiCo = (jConf && ciCoByConf[bid + '|' + jConf]) || null;
        // net ย่อย: ดึงจาก legacy row เดียวกัน bid ก่อน ไม่งั้น parse จาก note
        // ของแถวนี้เอง ไม่งั้น (ไม่มีทั้งคู่) fallback เป็น merged net
        var jNet = (jCiCo && jCiCo.net)
          ? jCiCo.net
          : (jConf && noteNetByConf[jConf] !== undefined ? noteNetByConf[jConf] : net);
        result.push({
          invoiceKey     : iKey,
          bookingId      : bid,
          room           : roomList[j] || rooms,
          guest          : guestList[j] || guests,
          checkin        : jCiCo ? jCiCo.checkin  : checkin,
          checkout       : jCiCo ? jCiCo.checkout : checkout,
          nights         : nights,
          net            : jNet,
          groupNet       : gross,
          isSplitFromMulti: true,
          splitIndex     : j + 1,
          splitTotal     : roomList.length,
          ota            : String(r[1] || ''),
          status         : status,
          detectedDate   : detectedRaw,
          detectedToday  : (detectedRaw === today || fs === today),
          done           : !!doneMap[iKey],
          confList       : jConf ? [jConf] : [],
          matchKeys      : []
        });
      }
    } else {
      result.push({
        invoiceKey     : bid,
        bookingId      : bid,
        room           : rooms,
        guest          : guests,
        checkin        : checkin,
        checkout       : checkout,
        nights         : nights,
        net            : net,
        groupNet       : gross,
        isSplitFromMulti: false,
        ota            : String(r[1] || ''),
        status         : status,
        detectedDate   : detectedRaw,
        detectedToday  : (detectedRaw === today || fs === today),
        done           : !!doneMap[bid],
        confList       : confList,
        matchKeys      : []
      });
    }
  }

  // ── PASS 3: PrePaid Booking.com/Expedia rows ที่ยังไม่ ✅ ใน Bank_Ledger ──
  // Booking.com net ที่แม่นยำมาจาก Financial Report CSV เท่านั้น (ส่งเป็น
  // ระยะๆ ตาม payout frequency ของ property นี้) — รอให้ SCB match ก่อนถึงจะ
  // ทำ invoice ได้ ทำให้ invoice ล่าช้าเป็นระยะยาวโดยไม่จำเป็น เพิ่ม PrePaid
  // row ตรงจาก Payout_Income_Log เข้ามาเลย (net เป็นค่าประมาณจาก LH email,
  // ทำเครื่องหมาย estimated:true) เพื่อให้เริ่มทำ invoice ได้ทันทีที่เช็คเอาท์
  // แล้วค่อยอัปเดต net จริงอัตโนมัติเมื่อ syncBookingComFinancialReports()
  // หรือ matchBookingComSCB() ยืนยันยอดภายหลัง
  var srcSheet = ss.getSheetByName(TAB_NAME); // 'Payout_Income_Log' (const จาก Code.gs)
  if (srcSheet) {
    var srcRows = srcSheet.getDataRange().getValues();
    for (var k = 1; k < srcRows.length; k++) {
      var sr = srcRows[k];
      var sOta = String(sr[1] || '').trim();
      if (sOta !== 'Booking.com' && sOta !== 'Booking' && sOta !== 'Expedia') continue;
      var sBid = String(sr[2] || '').trim();
      if (!sBid || seen[sBid]) continue; // มี invoice ยืนยันแล้วจาก Bank_Ledger
      var sStatus = String(sr[12] || '');
      if (!/^PrePaid|^Net Rate/.test(sStatus)) continue; // เอาเฉพาะที่ยังรอ settle

      seen[sBid] = true;
      var fs2 = firstSeenMap[sBid] || normDate(sr[0]);
      if (!firstSeenMap[sBid]) { firstSeenMap[sBid] = fs2; saveFirstSeen('invoice', sBid, fs2); }

      result.push({
        invoiceKey      : sBid,
        bookingId       : sBid,
        room            : String(sr[5] || '').trim(),
        guest           : String(sr[4] || '').trim(),
        checkin         : normDate(sr[6]),
        checkout        : normDate(sr[7]),
        nights          : parseInt(sr[8]) || 0,
        net             : parseFloat(String(sr[11]).replace(/,/g,'')) || 0,
        groupNet        : parseFloat(String(sr[9]).replace(/,/g,'')) || 0,
        isSplitFromMulti: false,
        ota             : sOta,
        status          : sStatus,
        estimated       : true,
        detectedDate    : fs2,
        detectedToday   : (fs2 === today),
        done            : !!doneMap[sBid],
        confList        : [sBid],
        matchKeys       : []
      });
    }
  }

  return result;
}

// ── parseNoteNetByConf_ ──────────────────────────────────────────────────
// Parses "Guest(CONF) NET ฿1234.56" entries out of a payout note string,
// returning { CONF: net } so per-guest splits can fall back to the row's
// own note when no legacy single-conf row exists for that guest anywhere
// else in the sheet. Handles minus sign either before or after ฿, and the
// "Adjustment" wording used for negative/adjustment line items.
function parseNoteNetByConf_(notes) {
  var pattern = /([^|]+?)\(([^)]+)\)\s*(?:Adjustment\s+)?(?:NET\s+)?(-)?\s*฿(-)?([\d,]+\.?\d*)/g;
  var out = {};
  var m;
  while ((m = pattern.exec(notes)) !== null) {
    var conf = m[2].trim();
    var sign = (m[3] === '-' || m[4] === '-') ? -1 : 1;
    out[conf] = sign * parseFloat(m[5].replace(/,/g, ''));
  }
  return out;
}

// ── matchKey builders ─────────────────────────────────────────────────
//
// Strategy (ลำดับความสำคัญ):
//   1. conf:HMXXXXXX  (Airbnb conf code ใน resId หรือ confList)
//   2. cr:YYYY-MM-DD:ROOM  (checkin date + room number)
//   3. n6:XXXXXX  (6-char name prefix ทั้ง "FirstLast" และ "LastFirst")
//
// การใช้ prefix 6 ตัวช่วยแก้ปัญหา:
//   - "Sharif, Abdalla" → n6:sharif  AND  n6:abdall  (ทั้งสองด้าน)
//   - Invoice "Abdalla Sharif" → n6:abdall  AND  n6:sharif  → match กัน

function normName(s) {
  // lowercase, remove diacritics, remove non-alpha
  s = String(s || '').toLowerCase().trim();
  // remove diacritics via regex (GAS V8 supports this)
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  s = s.replace(/[^a-z0-9]/g, '');
  return s;
}

function nameTokens(fullName) {
  // split "Sharif, Abdalla" or "Abdalla Sharif" into tokens
  var s = String(fullName || '').replace(/,/g, ' ').trim();
  return s.split(/\s+/).filter(function(t){ return t.length > 1; });
}

function namePrefixes(fullName) {
  // return array of 6-char prefixes of each token (normalized)
  var tokens = nameTokens(fullName);
  return tokens.map(function(t) {
    var n = normName(t);
    return 'n6:' + n.substring(0, 6);
  }).filter(function(k){ return k.length > 4; });
}

function buildNamePrefixes(items) {
  // build map: prefix → [keys of items that have this prefix]
  // used for reverse lookup
  var map = {};
  items.forEach(function(item) {
    var key = item.resId || item.invoiceKey;
    var pxs = namePrefixes(item.guest || '');
    pxs.forEach(function(px) {
      if (!map[px]) map[px] = [];
      map[px].push(key);
    });
  });
  return map;
}

function buildBookingMatchKeys(b, invNamePrefixes) {
  var keys = [];

  // 1. conf code จาก resId (Airbnb: ABB-HMXXXXXX-... หรือ ABB-confcode-...)
  var confFromResId = extractConfFromResId(b.resId);
  if (confFromResId) keys.push('conf:' + confFromResId);

  // 2. checkin + room (เฉพาะ room number ตัวเลข)
  var roomNum = extractRoomNum(b.room);
  if (roomNum && b.checkin) keys.push('cr:' + b.checkin + ':' + roomNum);

  // 3. name prefixes (ทั้ง token แรก+สอง เพื่อ handle order สลับ)
  var pxs = namePrefixes(b.guest);
  pxs.forEach(function(px) { keys.push(px); });

  // 4. full norm name (สำหรับกรณีชื่อตรงทั้งหมด)
  var nn = normName(b.guest.replace(/,/g, ' '));
  if (nn.length >= 4) keys.push('n:' + nn);

  return keys;
}

function buildInvoiceMatchKeys(inv, bkNamePrefixes) {
  var keys = [];

  // 1. conf codes
  var confList = inv.confList || [];
  confList.forEach(function(c) {
    if (c && /^HM[A-Z0-9]{6,}/.test(c)) keys.push('conf:' + c);  // Airbnb HM...
  });

  // 2. checkin + room
  // For split invoices from multi-room batches, inv.checkin may be the merged row's
  // earliest date (not the actual guest checkin). Also add inv.checkout as a cr: key
  // because in Airbnb batch payouts the merged row checkout = next guest's checkin.
  var roomNum = extractRoomNum(inv.room);
  if (roomNum && inv.checkin)  keys.push('cr:' + inv.checkin  + ':' + roomNum);
  if (roomNum && inv.checkout) keys.push('cr:' + inv.checkout + ':' + roomNum);

  // 3. name prefixes
  var pxs = namePrefixes(inv.guest);
  pxs.forEach(function(px) { keys.push(px); });

  // 4. full norm name
  var nn = normName(inv.guest);
  if (nn.length >= 4) keys.push('n:' + nn);

  return keys;
}

function extractConfFromResId(resId) {
  // ABB-HMXXXXXX-20260301 → HMXXXXXX
  // ABB-hmxxxxxx-... (lowercase)
  var m = String(resId || '').match(/ABB-([A-Za-z0-9]{6,})-\d{8}/);
  if (m) {
    var candidate = m[1].toUpperCase();
    if (/^HM[A-Z0-9]{6,}/.test(candidate)) return candidate;
  }
  return null;
}

function extractRoomNum(roomStr) {
  var m = String(roomStr || '').match(/(\d{3})/);
  return m ? m[1] : null;
}

// ── normDate ───────────────────────────────────────────────────────────
function normDate(v) {
  if (!v) return '';
  var s = String(v);
  // ISO string with timezone: "2026-03-03T17:00:00.000Z"
  // T17:00:00Z = UTC 17:00 = Bangkok 00:00 next day → ต้อง +7
  if (/T\d\d:\d\d:\d\d/.test(s)) {
    var d = new Date(s);
    // แปลงเป็น Bangkok time (UTC+7)
    var bkk = new Date(d.getTime() + 7 * 60 * 60 * 1000);
    return fmtDate(bkk);
  }
  // plain date: "2026-03-03" or Date object
  if (v instanceof Date) return fmtDate(v);
  return s.substring(0, 10);
}

function fmtDate(d) {
  var y  = d.getFullYear();
  var m  = String(d.getMonth() + 1).padStart(2, '0');
  var dd = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + dd;
}

// ── setNote: write note to Sheet1 col G for a given resId ─────────────
function setNote(resId, note) {
  if (!resId) return { ok: false, error: 'no resId' };
  var ss    = SpreadsheetApp.openById(SS_ID);
  var sheet = ss.getSheetByName(SHEET1_TAB);
  var rows  = sheet.getDataRange().getValues();
  var mode  = 'start';
  for (var i = 0; i < rows.length; i++) {
    var c0 = String(rows[i][0] || '').trim();
    if (c0 === 'เลขห้อง') { mode = 'bookings'; continue; }
    if (mode !== 'bookings') continue;
    if (String(rows[i][5] || '').trim() === resId) {
      sheet.getRange(i + 1, 7).setValue(note);   // col G = index 6 = column 7
      return { ok: true };
    }
  }
  return { ok: false, error: 'resId not found' };
}

// ── Done state (stored in BookingTodo sheet) ───────────────────────────
//
// Sheet structure:
//   Col A: type ('booking' | 'invoice')
//   Col B: id (resId or invoiceKey)
//   Col C: done (TRUE/FALSE)
//   Col D: firstSeen (YYYY-MM-DD)

function getTodoSheet(ss) {
  var s = ss ? ss.getSheetByName(TODO_TAB) : null;
  if (!s) {
    var spreadsheet = ss || SpreadsheetApp.openById(SS_ID);
    s = spreadsheet.insertSheet(TODO_TAB);
    s.appendRow(['type','id','done','firstSeen']);
  }
  return s;
}

function getDoneMap(type) {
  var ss   = SpreadsheetApp.openById(SS_ID);
  var s    = getTodoSheet(ss);
  var rows = s.getDataRange().getValues();
  var map  = {};
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === type) {
      map[String(rows[i][1])] = rows[i][2] === true || rows[i][2] === 'TRUE';
    }
  }
  return map;
}

function getFirstSeenMap(type) {
  var ss   = SpreadsheetApp.openById(SS_ID);
  var s    = getTodoSheet(ss);
  var rows = s.getDataRange().getValues();
  var map  = {};
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === type && rows[i][3]) {
      map[String(rows[i][1])] = String(rows[i][3]).substring(0,10);
    }
  }
  return map;
}

function saveFirstSeen(type, id, dateStr) {
  var ss = SpreadsheetApp.openById(SS_ID);
  var s  = getTodoSheet(ss);
  s.appendRow([type, id, false, dateStr]);
}

function setDone(type, id, done) {
  if (!id) return { ok: false, error: 'no id' };
  var ss   = SpreadsheetApp.openById(SS_ID);
  var s    = getTodoSheet(ss);
  var rows = s.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === type && String(rows[i][1]) === id) {
      s.getRange(i + 1, 3).setValue(done);
      return { ok: true };
    }
  }
  // ไม่เจอ row → สร้างใหม่
  s.appendRow([type, id, done, fmtDate(new Date())]);
  return { ok: true, created: true };
}

