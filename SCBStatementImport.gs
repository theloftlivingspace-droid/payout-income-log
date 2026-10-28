// ═══════════════════════════════════════════════════════════════
// SCB STATEMENT IMPORT  (added 2026-10-28)
//
// ปัญหา: SCB ไม่ส่งอีเมลแจ้งเงินเข้าสำหรับบางช่องทาง (เจอแล้ว: ATS — เช่น
// Trip.com payout "MCL 00100789633 000xx") → fetchSCBAlerts()/parseSCBEmail()
// ไม่เห็นรายการ → ไม่มีแถว SCB ให้ matchSCBtoOTA() จับคู่ → รายการ Trip.com
// ค้าง "รอ monthly settlement" ทั้งที่เงินเข้าแล้ว
//
// วิธีแก้: นำเข้า statement CSV (SCB Easy → ประวัติรายการ → ดาวน์โหลด CSV)
// สร้างแถว SCB ในรูปแบบเดียวกับ parseSCBEmail() เฉพาะรายการเงินเข้าที่ยังไม่มี
// ในชีต แล้วให้ pipeline เดิม (matchSCBtoOTA → rebuildBankLedger) จับคู่ต่อ
//
// - ไม่แตะ appsscript.json / OAuth scopes (ไม่อ่านไฟล์จาก Drive)
//   ใช้งานโดยส่งข้อความ CSV เข้า importSCBStatementCsv(csvText)
// - idempotent: รันซ้ำได้ ข้ามรายการที่มีอยู่แล้ว (bookingId เดียวกัน หรือ
//   ยอดเท่ากันในวันที่ห่างกัน ≤ 1 วัน)
// - รองรับ CSV เต็มของ SCB (Account Number, Date, Time, Channel, Withdrawal,
//   Deposit, Description, ...) อ่านคอลัมน์จากชื่อหัวตาราง
// ═══════════════════════════════════════════════════════════════

// ── CSV parser (รองรับ quote / BOM / บรรทัดใน quote) ───────────
function parseCsv_(text) {
  var rows = [], row = [], field = '', inQ = false;
  text = String(text || '').replace(/^\uFEFF/, '');
  for (var i = 0; i < text.length; i++) {
    var ch = text.charAt(i);
    if (inQ) {
      if (ch === '"') {
        if (text.charAt(i + 1) === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += ch;
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text.charAt(i + 1) === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// dd/mm/yyyy (หรือ yyyy พ.ศ.) → yyyy-MM-dd
function scbStmtDateToISO_(s) {
  var m = String(s || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return '';
  var y = parseInt(m[3], 10);
  if (y > 2500) y -= 543;
  return y + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
}

// แปลง CSV statement → รายการเงินเข้า [{date,time,channel,amount,desc,acct}]
function parseSCBStatementDeposits_(csvText) {
  var rows = parseCsv_(csvText);
  if (rows.length < 2) return [];
  var hdr = rows[0].map(function (h) { return String(h).trim().toLowerCase(); });
  function col(name) { return hdr.indexOf(name); }
  var iDate = col('date'), iTime = col('time'), iCh = col('channel'),
      iDep = col('deposit'), iDesc = col('description'), iAcct = col('account number');
  if (iDate < 0 || iDep < 0) throw new Error('CSV ไม่มีคอลัมน์ Date/Deposit — ใช่ไฟล์ statement ของ SCB หรือไม่?');
  var out = [];
  for (var r = 1; r < rows.length; r++) {
    var row = rows[r];
    var dep = parseFloat(String(row[iDep] || '').replace(/,/g, ''));
    if (!dep || dep <= 0) continue;               // เฉพาะเงินเข้า
    var iso = scbStmtDateToISO_(row[iDate]);
    if (!iso) continue;
    var acct = iAcct >= 0 ? String(row[iAcct] || '').replace(/\D/g, '') : '';
    out.push({
      date: iso,
      time: iTime >= 0 ? String(row[iTime] || '').trim() : '',
      channel: iCh >= 0 ? String(row[iCh] || '').trim() : 'Transfer',
      amount: dep.toFixed(2),
      desc: iDesc >= 0 ? String(row[iDesc] || '').replace(/\s+/g, ' ').trim() : '',
      acct: acct.length >= 6 ? 'x' + acct.slice(-6) : 'x256221'
    });
  }
  return out;
}

// ── หลัก: นำเข้า statement CSV ────────────────────────────────
// opts.skipMatch = true → แค่เพิ่มแถว SCB ไม่รัน matching (ใช้ตอนทดสอบ)
function importSCBStatementCsv(csvText, opts) {
  opts = opts || {};
  var ss = SpreadsheetApp.openById(MASTER_SHEET_ID);
  var sheet = ss.getSheetByName(TAB_NAME);
  if (!sheet) throw new Error('ไม่พบชีต ' + TAB_NAME);

  var deposits = parseSCBStatementDeposits_(csvText);
  var existing = getExistingIds(sheet);

  // ดึงแถว SCB เดิม (วันที่ + ยอด) ไว้เช็คซ้ำแบบ ±1 วัน
  // (วันที่ในอีเมล "วันที่รายการมีผล" กับวันที่ใน statement อาจต่างกัน 1 วัน)
  var scbSeen = [];
  var last = sheet.getLastRow();
  if (last >= 2) {
    sheet.getRange(2, 1, last - 1, HEADERS.length).getValues().forEach(function (row) {
      if (!String(row[C.ota - 1] || '').startsWith('SCB')) return;
      scbSeen.push({
        ts: new Date(normalizeDate(row[C.date - 1])).getTime(),
        amt: parseAmt(row[C.net - 1])
      });
    });
  }
  function alreadyHave_(iso, amtStr) {
    if (existing.has('SCB-' + iso + '-' + amtStr)) return true;
    var ts = new Date(iso).getTime(), a = parseFloat(amtStr);
    return scbSeen.some(function (s) {
      return Math.abs(s.amt - a) < 0.005 && Math.abs(s.ts - ts) <= 86400000;
    });
  }

  var added = [], skipped = 0, old = 0;
  deposits.forEach(function (d) {
    if (d.date < '2026-03-01') { old++; return; }   // เหมือนกฎใน dailyEmailSync
    if (alreadyHave_(d.date, d.amount)) { skipped++; return; }
    var bid = 'SCB-' + d.date + '-' + d.amount;
    var ch = d.channel || 'Transfer';
    var row = makeRow(
      'SCB (' + ch + ')', d.date, bid, '',
      'รอ match', '?', '', '', '',
      d.amount, '', d.amount,
      'เงินเข้าบัญชี ' + d.acct,
      'via SCB ' + ch + ' | statement import ' + d.date + (d.time ? ' ' + d.time : '') +
        (d.desc ? ' | ' + d.desc : '')
    );
    appendRow(sheet, row);
    existing.set(bid, parseFloat(d.amount));
    scbSeen.push({ ts: new Date(d.date).getTime(), amt: parseFloat(d.amount) });
    added.push(d.date + ' ' + ch + ' ' + d.amount);
  });

  if (added.length && !opts.skipMatch) {
    // เหมือน fullSyncAndLedger() ตัด syncTripCom/toast ออก
    matchSCBtoOTA(sheet);
    matchRoomFromSheet1();
    applyManualRoomFixes();
    syncSCBTotalRooms();
    rebuildBankLedger();
  }
  var msg = 'importSCBStatementCsv: เพิ่ม ' + added.length + ' แถว, ข้าม (มีอยู่แล้ว) ' + skipped +
            ', ข้าม (ก่อน 2026-03-01) ' + old + (added.length ? ' | ' + added.join('; ') : '');
  Logger.log(msg);
  return msg;
}

// ── One-off: เงินเข้าทาง ATS ที่ไม่มีอีเมลจาก SCB (ต.ค. 2026) ─────
// ยอด 21/10 ฿1,990.72 = Trip.com booking #1622930961967037 (Saphanthong/
// ChinchuthaRoom 300). ที่เหลือเป็น ATS ที่ผู้จ่ายยังไม่ยืนยัน — ถ้าจับคู่
// กับรายการ Trip.com/OTA ไม่ได้ จะค้างเป็น "รอ match" ให้ตรวจมือ
// (idempotent — รันซ้ำได้)
function importSCBAtsOct2026() {
  var csv =
    'Account Number,Date,Time,Channel,Withdrawal,Deposit,Description\n' +
    '1644256221,07/10/2026,02:01,ATS ,,4168.97,MCL 00100789633 00020\n' +
    '1644256221,09/10/2026,01:54,ATS ,,2765.67,MCL 02055838002 00031\n' +
    '1644256221,14/10/2026,01:44,ATS ,,1443.04,MCL 00100854311 00020\n' +
    '1644256221,14/10/2026,01:44,ATS ,,3442.81,MCL 00100789633 00020\n' +
    '1644256221,21/10/2026,01:57,ATS ,,1990.72,MCL 00100789633 00020\n';
  return importSCBStatementCsv(csv);
}
