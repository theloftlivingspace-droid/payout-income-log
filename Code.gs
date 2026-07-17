// ═══════════════════════════════════════════════════════════════
// Payout_Income_Log_v24.gs
// Changes from v23:
//   1. roomFromText(): map elegance/legacy/allure/radiance → เลขห้องที่ถูกต้อง
//      (เดิมคืน '?' ทำให้ matching room ล้มเหลวทุกรายการที่มีชื่อประเภทห้อง)
//   2. matchSCBtoOTA() Airbnb: ขยาย window -3 ถึง +10 วัน + fallback ±1 วัน net sum
//   3. detailByConf: ลด regex minimum จาก 8 เป็น 6 ตัว รับ conf code สั้นกว่า
//   4. matchSCBtoOTA() Trip.com: เพิ่ม net sum matching (หลาย booking รวมกัน)
//   5. applyManualRoomFixes(): แก้ bug skip logic — เดิม skip แม้ room ผิด
// ═══════════════════════════════════════════════════════════════
// Payout_Income_Log_v23.gs
// Changes from v22:
//   1. fullRebuild() → ใช้ incremental fetch (skip existing IDs) ไม่ parse ซ้ำ
//   2. quickReformat() — ใหม่: แค่ match+sort+style+ledger ไม่ fetch email เลย
//      ใช้เมื่อต้องการแก้สี/format/CI-CO โดยไม่ต้อง rebuild ทั้งหมด
//   3. fetchAndParseNew() — helper: fetch แล้ว skip bookingId ที่มีใน sheet อยู่แล้ว
// ═══════════════════════════════════════════════════════════════
// Payout_Income_Log_v20.gs  (updated: getSheet1CiCoMap, font reset, more MANUAL_ROOM_FIXES)
// Changes from v19:
//   1. roomFromText(): เพิ่ม "cosy apartment", "private apartment",
//      "mycondo", "363" → '363' (Mycondo A/B ห้อง 363)
//   2. MANUAL_ROOM_FIXES: ตารางแก้ห้องที่ยังเป็น '?' แบบ hardcode
//   3. applyManualRoomFixes(): รัน pass สุดท้ายหลัง matchRoomFromSheet1()
//   4. fullRebuild() / dailyEmailSync() / rematch() เรียก applyManualRoomFixes()
//   5. buildSCBRows(): เพิ่ม getSheet1CiCoMap() fallback ci/co/nights
//   6. sortPayoutByOTA(): เพิ่ม font reset loop สำหรับ SCB sub/total rows
// ═══════════════════════════════════════════════════════════════

const MASTER_SHEET_ID = '1XbTJLhecql_HNqyE80Hc6h30A2_elIxliudF4e6Rlz0';
const TAB_NAME        = 'Payout_Income_Log';
const SEARCH_FROM     = '2026/01/01';
const BANK_LEDGER_TAB = 'Bank_Ledger';

const HEADERS = [
  'วันที่ตรวจพบ','OTA','Booking ID','Conf. Code',
  'ชื่อแขก','ห้อง','เช็คอิน','เช็คเอาท์','คืน',
  'ยอดรวม (THB)','Commission (THB)','NET (THB)',
  'สถานะ','หมายเหตุ'
];
var C = {
  date:1,ota:2,bid:3,conf:4,guest:5,room:6,
  ci:7,co:8,nights:9,total:10,comm:11,net:12,
  status:13,notes:14
};
const OTA_BG = {
  'Airbnb':'#fff0f0','Booking.com':'#f0f8ff',
  'Expedia':'#fffbe6','Trip.com':'#f0fff4','SCB':'#fdf5ff'
};
const RES_BG       = '#ffe8e8';
const SCB_TOTAL_BG = '#e8f5e9';
const SCB_SUB_BG   = '#f1f8e9';

// ═══════════════════════════════════════════════════════════════
// MANUAL ROOM FIXES
// ═══════════════════════════════════════════════════════════════
var MANUAL_ROOM_FIXES = [
  // ── 2026-06-23 batch fix ──────────────────────────────────────
  { conf:'HMFNWRKAHD', room:'103' },  // Johnny Brillantes → 103 Elegance
  { conf:'HM3DJ3XWXT', room:'300' },  // Por → 300
  // ── Room swap fix 2026-06-13 ──────────────────────────────────
  { conf:'BKC-seanaldcro-20260613', room:'205' },  // sean aldcroft → 205 Allure
  { conf:'ABB-maudsantoc-20260613', room:'210' },  // Maud Santocildes → 210 Radiance
  { conf:'HMQR4QJA55', room:'205' },             // Maud Santocildes → 205 Allure (Airbnb payout)
  // ── Mycondo 363 ─────────────────────────────────────────────
  { conf:'HMRKPSAX9F', room:'363' },  // Harley Bowman
  { conf:'HMP9HW25EN', room:'363' },  // Hélèm Saouchi
  // ── ยืนยันจาก invoice + Sheet1 ────────────────────────────
  { conf:'HMWXCP29RP', room:'214' },  // Nelson Rodrigues
  { conf:'HM9X2AW3R3', room:'113' },  // Eiji Uenaka
  { conf:'HMTZCKN2XM', room:'214' },  // Dogukan Kaner
  { conf:'HMYD8PBRFR', room:'214' },  // La'Tavia Antrice
  { conf:'HMCTA5TJ35', room:'113' },  // Nihel Ben Naceur
  { conf:'HM4RDKF888', room:'214' },  // Sarah Carrington
  { conf:'HMSJPE93NS', room:'113' },  // Luisa Marriaga
  { conf:'HMNHWSPHPT', room:'214' },  // Poonchanok Gramut
  { conf:'HMZJN29RZ5', room:'214' },  // Cristina P
  { conf:'HMRFAMDAXW', room:'113' },  // Dick Blom
  { conf:'HM3A89NS8M', bid:'SCB-2026-03-08-3923.90', room:'214' },  // Josh Cadle
  { conf:'HM529FX8QH', room:'214' },  // Gabriel Carletto
  { conf:'HMMWTMN5QS', bid:'SCB-2026-03-05-900.00', room:'113' },  // Lona Lee
  { conf:'HMCBAE24X2', room:'214' },  // Gabriel Carletto
  { conf:'HMDKRWE9ST', bid:'SCB-2026-04-14-4314.50', room:'214' },  // Laurent Pierre Noguer
  { conf:'HMXS5X9J9T', room:'214' },  // May Zin
  { conf:'HMM2YXSJXC', room:'113' },  // Hasan Workman
  { conf:'HMTF5QWZ38', room:'113' },  // Keegan Jacinto
  { conf:'HM49DKJYBR', room:'113' },  // Ngân Nguyễn Thị
  { conf:'HMTQJXECS9', room:'203' },  // SM Muhaimen Mahmood (cancel)
  { conf:'HMNNRSRWEK', room:'203' },  // Siren Wills
  { conf:'HMPJDDT2X2', room:'103' },  // 妘芮 Lin
  // ── Trip.com — ยืนยันจาก invoice ──────────────────────────
  { bid:'1128145356180955', room:'103' },  // Akhoundi/Farzad
  { bid:'1616327691667562', room:'103' },  // FAN/MEIYU
  { bid:'1622924707373102', room:'204' },  // GANTO/CAWANCHAI
  { bid:'1539361352649181', room:'203' },  // RAI/ROMAN
  { bid:'1578947342348802', room:'103' },  // SU MYAT/AUNG
  { bid:'1622927451953412', room:'103' },  // Rattanabamrung/Araya
  // ── SCB rows match ด้วย bid (ยืนยันจาก invoice) ────────────
  { bid:'SCB-2026-03-04-18195.32', room:'300' },  // Shaokun Zhang / Expedia
  { bid:'SCB-2026-03-04-997.34',   room:'214' },  // Gabriel Carletto / Airbnb
  { bid:'SCB-2026-03-05-3230.22',  room:'300' },  // Jake Burke / Trip.com
  { bid:'SCB-2026-03-12-1396.26',  room:'113' },  // Songwut Heraphiwatthana / Expedia
  { bid:'SCB-2026-03-21-15105.30', room:'363' },  // Hélèm Saouchi / Airbnb
  { bid:'SCB-2026-03-27-1826.72',  room:'204' },  // Sarina Javid Osborne / Trip.com
  { bid:'SCB-2026-03-30-13497.52', room:'205' },  // Amir Hayes / Airbnb
  { bid:'SCB-2026-04-02-1923.36',  room:'300' },  // 辉 宫 Gong Hui / Airbnb
  { bid:'SCB-2026-04-07-980.93',   room:'203' },  // ALLARD Angélique / booking.com
  { bid:'SCB-2026-04-07-2126.89',  room:'300' },  // 辉 宫 Gong Hui / Airbnb
  { bid:'SCB-2026-04-09-2201.90',  room:'300' },  // 辉 宫 Gong Hui / Airbnb
  { bid:'SCB-2026-04-17-4823.58',  room:'113' },  // Ngân Nguyễn Thị / Airbnb
  { bid:'SCB-2026-04-21-943.21',   room:'300' },  // 辉 宫 Gong Hui / Airbnb
  { bid:'SCB-2026-05-16-1169.49',  room:'108' },  // Dave Casey / Airbnb
  { bid:'SCB-2026-05-26-1423.79',  room:'103' },  // Natthaphon Pakhothanang / booking
  { bid:'SCB-2026-05-31-2996.07',  room:'113' },  // Eiji Uenaka / Airbnb
  { conf:'HMF3M5DXDD', room:'205' },  // Cedric Nixon / Airbnb
  { conf:'HM29NH5XYT', room:'103' },  // Nick Laschet / Airbnb (Jun)
  { conf:'HMMY9NZCED', room:'209' },  // Saragba Rekom C / Airbnb
  { conf:'HMWXCP29RP', room:'214' },  // Nelson Rodrigues Coutinho Junior / Airbnb
  { bid:'SCB-2026-06-07-7648.98', room:'205, 103, 209, 214' },  // order matches guest field: Cedric Nixon(205), Nick Laschet(103), Saragba Rekom C(209), Nelson(214)
  { bid:'SCB-2026-06-07-600.16',  room:'205' },  // Cedric Nixon single — reset from bad sync  // Cedric Nixon(205)+Nick Laschet(103)+Saragba(209)+Nelson(214)
  // SCB-2026-04-07-9464.05: 妘芮林(103) + Avto Dagdelen(203) → total=103, 203
  { bid:'SCB-2026-04-07-9464.05', conf:'HMPJDDT2X2', room:'103' },   // 妘芮 林
  { bid:'SCB-2026-04-07-9464.05', conf:'HMJSD4WSQ9', room:'203' },   // Avto Dagdelen
  { bid:'SCB-2026-04-07-9464.05', room:'103, 203' },                  // total

  // SCB-2026-04-21-9177.65: Hélèm(363) + Aiman(203) → total=203, 363
  { bid:'SCB-2026-04-21-9177.65', conf:'HMP9HW25EN', room:'363' },   // Hélèm Saouchi
  { bid:'SCB-2026-04-21-9177.65', conf:'HMDWQA9E9H', room:'203' },   // Aiman Hamizan
  { bid:'SCB-2026-04-21-9177.65', room:'363, 203' },                  // total — order matches guest field: Hélèm Saouchi(363), Aiman Hamizan(203)

  // SCB-2026-04-27-499.80: Nick(204)+Hasan(113)+Hélèm(363)+Денис(203) → total=113,203,204,363
  { bid:'SCB-2026-04-27-499.80', conf:'HMED99EQ8W', room:'204' },    // Nick Laschet
  { bid:'SCB-2026-04-27-499.80', conf:'HMM2YXSJXC', room:'113' },   // Hasan Workman
  { bid:'SCB-2026-04-27-499.80', conf:'HMP9HW25EN', room:'363' },    // Hélèm Saouchi
  { bid:'SCB-2026-04-27-499.80', conf:'HMHY2NAW82', room:'203' },    // Денис Колескников
  { bid:'SCB-2026-04-27-499.80', room:'204, 113, 363, 203' },         // total — order matches guest field: Nick Laschet(204), Hasan Workman(113), Hélèm Saouchi(363), Денис Колескников(203)

  { bid:'SCB-2026-05-05-5555.03',  room:'300, 204, 108' },  // Trip.com batch total — order matches guest field: BOONTUM/PAKPONG(300), YAMKAMOL/METAWEE(204), NAM/SANG WON(108)
  // SCB-2026-05-05-5555.03 sub-rows (Trip.com booking IDs)
  { bid:'SCB-2026-05-05-5555.03', conf:'1622926832063903', room:'300' },  // BOONTUM/PAKPONG
  { bid:'SCB-2026-05-05-5555.03', conf:'1622926832063939', room:'204' },  // YAMKAMOL/METAWEE
  { bid:'SCB-2026-05-05-5555.03', conf:'1400825520948811', room:'108' },  // NAM/SANG WON
  // SCB-2026-06-25-12380.35 (Trip.com withdrawal #1779538302)
  { bid:'SCB-2026-06-25-12380.35', room:'103, 103, 103, 300, 204' },  // total — SU MYAT/AUNG(103) + Boon/Pornpawit x2(103) + PATHONG/THANAPHACHARA(300) + BUKBOON/THANAPORNPAN(204)
  { bid:'SCB-2026-06-25-12380.35', conf:'1578947342348802', room:'103' },  // SU MYAT/AUNG  Jun 3-12 3003.63
  { bid:'SCB-2026-06-25-12380.35', conf:'1622928032878497', room:'103' },  // Boon/Pornpawit Jun 12-16 2054.76
  { bid:'SCB-2026-06-25-12380.35', conf:'1622928101685164', room:'103' },  // Boon/Pornpawit Jun 16-19 2175.99
  { bid:'SCB-2026-06-25-12380.35', conf:'1622928138476811', room:'300' },  // PATHONG/THANAPHACHARA Jun 16-20 1905.72
  { bid:'SCB-2026-06-25-12380.35', conf:'1653714323322744', room:'204' },  // BUKBOON/THANAPORNPAN Jun 16-21 3240.25
  { bid:'SCB-2026-03-02-14599.29', room:'205, 300' },  // Egor Lebedev(205)+Rica Chanel(300)
  { conf:'HMR38XW4Z3', room:'300' },  // Rica Chanel / Airbnb
  { conf:'HMQDZAHYBE', room:'205' },  // Egor Lebedev / Airbnb
  // ── ยกเลิกการจอง ────────────────────────────────────────────
  { bid:'2472443860',        room:'ยกเลิก' },  // JELLUM, JOHN / Expedia
  { bid:'2439271536',        room:'ยกเลิก' },  // doungprasert, Khajonyod / Expedia
  { bid:'1622924258510520',  room:'ยกเลิก' },  // PONPIAN/NAPADA / Trip.com
  // ── Guest name fallback (SCB total rows ที่ guest = combined names) ──
  { guest:'Harley Bowman',                     room:'363' },  // Mycondo
  { guest:'Hélèm Saouchi',                     room:'363' },  // conf HMP9HW25EN
  { guest:'Hélèm Saouchi, Aiman Hamizan',      room:'363' },  // batch 363+203
  { guest:'Cristina P',                        room:'214' },  // conf HMZJN29RZ5
  { guest:'妘芮 林, Avto Dagdelen',             room:'103' },  // batch 103+203
  { guest:'Siren Wills, Avto Dagdelen',         room:'203' },  // conf HMNNRSRWEK
  { guest:'SM Muhaimen',                        room:'203' },  // conf HMTQJXECS9 (cancel)
  { guest:'妘芮 林',                             room:'103' },  // standalone
  { guest:'Siren Wills',                        room:'203' },  // standalone
  // ── ยกเลิกก่อนเช็คอิน แต่ Airbnb โอน cancellation payout มา ──────
  { conf:'HMFTY4YTTK', room:'204' },  // 佰顺 王 / จอง 3 คืน 07-05→07-08 ยกเลิกก่อนเข้าพัก (ไม่ใช่ occupancy จริง)
];


// ═══════════════════════════════════════════════════════════════
// AIRBNB_EXTENSIONS — conf ที่มี payout > 1 ครั้ง (แขกขออยู่ต่อ)
// bookingId: ABB-CONF (payout แรก), ABB-CONF-EXT-COYYYYMMDD (ครั้งถัดไป)
// ═══════════════════════════════════════════════════════════════
// AIRBNB_EXTENSIONS — DEPRECATED: ไม่จำเป็นต้องเพิ่ม conf code ที่นี่อีกต่อไป
// resolveAirbnbBid() จัดการ auto-suffix ให้อัตโนมัติเมื่อ net ต่างกัน
// เก็บไว้เพื่อ backward compat กับ extSuffix logic ใน parseAirbnbEmail เท่านั้น
var AIRBNB_EXTENSIONS = {
  'HM9X2AW3R3':  true,  // Eiji Uenaka — extension payout (legacy)
  'HMZN329QRH':  true,  // Igor Markov — 2nd payout ฿2,179.30 on 2026-06-14 (legacy)
  'HMMY9NZCED':  true   // Saragba Rekom C — 2nd payout ฿1,307.52 on 2026-06-16 (auto-handled now)
};


// ═══════════════════════════════════════════════════════════════
// BOOKING_COM_SCB_MAP — map SCB transfer → Booking.com booking IDs
// เพิ่มเมื่อรู้ว่า SCB ไหนเป็น Booking.com (เพราะ email ไม่บอก sender)
// net ของแต่ละ booking จะถูก calculate จาก:
//   simple: prepaid - payment_charge - commission - VAT7%(charge+comm)
//   complex: ระบุ net ตรงๆ ใน netOverride
// ═══════════════════════════════════════════════════════════════
var BOOKING_COM_SCB_MAP = [
  // { scbId: 'SCB-2026-04-02-980.93', bids: ['6148157193'] },            // ALLARD Angélique
  // { scbId: 'SCB-2026-05-26-1423.79', bids: ['6339174127'] },           // Natthaphon
  // { scbId: 'SCB-YYYY-MM-DD-AMOUNT', bids: ['BID1','BID2'], nets: ['NET1','NET2'] },  // multi
  { scbId: 'SCB-2026-06-16-2756.73', bids: ['6506062257'], nets: ['2756.73'] },  // Shahid Hussain / room 300
  { scbId: 'SCB-2026-07-07-2161.31', bids: ['5418031702'], nets: ['2161.31'] },  // Phattaragun Buatee / room 205
];

// ═══════════════════════════════════════════════════════════════
// calcBookingComNet — คำนวณ net payout จาก LH email fields
// ใช้ได้กับ simple bookings (prepaid = gross)
// fields: prepaid, payment_charge, commission (จาก parseLHEmail)
// ═══════════════════════════════════════════════════════════════
function calcBookingComNet(prepaid, paymentCharge, commission) {
  var vat = Math.round((paymentCharge + commission) * 0.07 * 100) / 100;
  return Math.round((prepaid - paymentCharge - commission - vat) * 100) / 100;
}

// ═══════════════════════════════════════════════════════════════
// ENTRY POINTS
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// QUICK REFORMAT — ไม่ fetch email ใหม่เลย
// แค่ re-match + sort + recolor + rebuild ledger บน existing data
// ใช้เมื่อต้องการแก้สี/format/CI-CO โดยไม่รอ parse email
// ═══════════════════════════════════════════════════════════════
function quickReformat() {
  var ss    = SpreadsheetApp.openById(MASTER_SHEET_ID);
  var sheet = ss.getSheetByName(TAB_NAME);
  if (!sheet) { Logger.log('quickReformat: ไม่พบ sheet'); return; }
  matchSCBtoOTA(sheet);
  matchBookingComSCB();
  syncBookingComFinancialReports();
  resolveManualExtranetHints(sheet);
  matchExtranetSCB(sheet);
  matchRoomFromSheet1();
  applyManualRoomFixes();
  syncSCBTotalRooms();
  fillMissingCiCoFromPatch();
  fillMissingCiCoFromBookingID();
  fillMissingCiCoFromEmail();
  sortPayoutByOTA(sheet);
  stylePayoutLog();
  flagStaleUnmatchedAirbnbPayouts();
  rebuildBankLedger();
  exportToGitHub();
  SpreadsheetApp.getActiveSpreadsheet().toast('QuickReformat เสร็จ | GitHub synced', 'Done', 4);
}

// ═══════════════════════════════════════════════════════════════
// FULL REBUILD — incremental: fetch เฉพาะ rows ใหม่ที่ยังไม่มีใน sheet
// ═══════════════════════════════════════════════════════════════
// ลบ duplicate EXT rows ที่เกิดจาก fullRebuild ซ้ำ
// จัดการ 2 pattern:
//   1. ABB-CONF-EXT-N-1, -2, ... (attempt suffix) → ลบทิ้งทั้งหมด เก็บแค่ ABB-CONF-EXT-N
//   2. bid ซ้ำกันทั้งคู่ (bid + net เหมือน) → ลบตัวหลัง
function cleanupDuplicateExtRows() {
  var sheet = setupSheet();
  var last  = sheet.getLastRow();
  if (last < 2) return;
  var data  = sheet.getRange(2,1,last-1,HEADERS.length).getValues();
  var seen  = {};   // bid → net
  var toDelete = [];
  for (var i=0; i<data.length; i++) {
    var bid = (data[i][C.bid-1]||'').toString().trim();
    var net = parseFloat((data[i][C.net-1]||0).toString().replace(/,/g,''))||0;
    if (!bid) continue;
    // pattern: ABB-CONF-EXT-N-attempt → ถ้า base bid (ABB-CONF-EXT-N) อยู่ใน seen แล้ว → ลบ
    var attemptMatch = bid.match(/^(.+-EXT-\d+)-\d+$/);
    if (attemptMatch) {
      var baseBid = attemptMatch[1];
      if (seen[baseBid] !== undefined) {
        toDelete.push(i+2);
        continue;
      }
    }
    // bid ซ้ำทั่วไป (net เหมือน) → ลบตัวหลัง
    if (seen[bid] !== undefined && Math.abs(seen[bid] - net) < 0.02) {
      toDelete.push(i+2);
    } else {
      seen[bid] = net;
    }
  }
  toDelete.sort(function(a,b){return b-a;});
  toDelete.forEach(function(r){ sheet.deleteRow(r); });
  Logger.log('cleanupDuplicateExtRows: deleted '+toDelete.length+' dup rows');
}

// GAS caps a single execution at 6 min (consumer) / 30 min (Workspace).
// This budget leaves headroom under the tighter 6-min cap so we always
// get a chance to checkpoint before Google kills the run outright.
const REBUILD_TIME_BUDGET_MS = 4.5 * 60 * 1000;
const REBUILD_PROP_DONE      = 'FULLREBUILD_DONE_SOURCES';
const REBUILD_PROP_TOTAL     = 'FULLREBUILD_TOTAL_NEW';

function fullRebuild() {
  var startTime = Date.now();
  var props = PropertiesService.getScriptProperties();

  var sheet    = setupSheet();
  cleanupDuplicateExtRows();              // ลบ dup EXT rows ก่อน rebuild
  var existing = getExistingIds(sheet);   // Set ของ bookingId ที่มีอยู่แล้ว

  var doneSources = JSON.parse(props.getProperty(REBUILD_PROP_DONE) || '[]');
  var totalNew     = Number(props.getProperty(REBUILD_PROP_TOTAL) || 0);
  var timedOut     = false;

  function timeLeft() { return (Date.now() - startTime) < REBUILD_TIME_BUDGET_MS; }

  // ── fetch เฉพาะ rows ใหม่ (checkpointed per-source) ─────────────
  var sources = [
    { key:'airbnb', q:'from:automated@airbnb.com subject:"sent a payout" after:'+SEARCH_FROM, fn:parseAirbnbEmail, lim:100 },
    { key:'lh',     q:'from:no-reply@app.littlehotelier.com after:'+SEARCH_FROM,              fn:parseLHEmail,     lim:100 },
    { key:'scb',    q:'from:No_reply_scbbusinessalert@scb.co.th after:'+SEARCH_FROM,          fn:parseSCBEmail,    lim:200 }
  ];
  sources.forEach(function(s) {
    if (timedOut || doneSources.indexOf(s.key) !== -1) return;
    if (!timeLeft()) { timedOut = true; return; }
    var threads;
    try {
      threads = GmailApp.search(s.q, 0, s.lim);
    } catch(e) {
      Logger.log('ERR fullRebuild search ['+s.q+']: '+e.message);
      doneSources.push(s.key);
      return;
    }
    for (var ti = 0; ti < threads.length; ti++) {
      if (!timeLeft()) { timedOut = true; break; }
      var t = threads[ti];
      var msgs;
      try {
        msgs = t.getMessages();
      } catch(e) {
        Logger.log('ERR fullRebuild getMessages: '+e.message);
        continue;
      }
      msgs.forEach(function(m) {
        try {
          s.fn(m).forEach(function(r) {
            if ((r.ota||'').startsWith('SCB') && (r.date||'') < '2026-03-01') return;
            var bid = r.bookingId;
            if ((r.ota||'') === 'Airbnb') {
              bid = resolveAirbnbBid(bid, Number(r.net)||0, existing);
              if (!bid) return; // dup จริง → skip
              r.bookingId = bid;
            }
            if (!existing.has(bid)) {
              existing.set(bid, Number(r.net)||0);
              appendRow(sheet, r);   // write immediately — nothing lost if we time out
              totalNew++;
            }
          });
        } catch(e) {
          var subj='?'; try{ subj=m.getSubject(); }catch(e2){}
          Logger.log('ERR fullRebuild parse: '+e.message+' | '+subj);
        }
      });
    }
    if (!timedOut) doneSources.push(s.key);
  });

  // Trip.com (multi-query, ต้อง handle seen เอง)
  if (!timedOut && doneSources.indexOf('trip') === -1) {
    if (!timeLeft()) {
      timedOut = true;
    } else {
      var tripSeen = {};
      var tripQueries = [
        'subject:"ยืนยันหมายเลขการจอง" after:'+SEARCH_FROM,
        'subject:"Booking no" after:'+SEARCH_FROM,
        'from:noreply_htl@trip.com after:'+SEARCH_FROM
      ];
      for (var qi = 0; qi < tripQueries.length && !timedOut; qi++) {
        var q = tripQueries[qi];
        var threads2;
        try {
          threads2 = GmailApp.search(q, 0, 50);
        } catch(e) {
          Logger.log('ERR Trip search ['+q+']: '+e.message);
          continue;
        }
        for (var ti2 = 0; ti2 < threads2.length; ti2++) {
          if (!timeLeft()) { timedOut = true; break; }
          var t2 = threads2[ti2];
          var msgs2;
          try {
            msgs2 = t2.getMessages();
          } catch(e) {
            Logger.log('ERR Trip getMessages: '+e.message);
            continue;
          }
          msgs2.forEach(function(m) {
            try {
              parseTripEmail(m).forEach(function(r) {
                if (!tripSeen[r.bookingId] && !existing.has(r.bookingId)) {
                  tripSeen[r.bookingId] = true; existing.set(r.bookingId, Number(r.net)||0);
                  appendRow(sheet, r); totalNew++;
                }
              });
            } catch(e) { Logger.log('ERR Trip: '+e.message); }
            try {
              m.getAttachments().forEach(function(att) {
                var aType = att.getContentType().toLowerCase();
                var aName = att.getName().toLowerCase();
                if (!/eml|message\/rfc822|octet-stream/.test(aType+aName)) return;
                var content = att.getDataAsString('UTF-8');
                var text = stripHTML(content.replace(/=\r?\n/g,'').replace(/=3D/g,'='));
                if (!/Reservation no\.|trip\.com/i.test(text)) return;
                parseTripText(text, fmtDate(m.getDate()), m.getSubject()).forEach(function(r) {
                  if (!tripSeen[r.bookingId] && !existing.has(r.bookingId)) {
                    tripSeen[r.bookingId] = true; existing.set(r.bookingId, Number(r.net)||0);
                    appendRow(sheet, r); totalNew++;
                  }
                });
              });
            } catch(e) { Logger.log('ERR Trip att: '+e.message); }
          });
        }
      }
      if (!timedOut) doneSources.push('trip');
    }
  }

  // ── ran out of time budget → checkpoint + auto-resume, skip match/format/export this pass ──
  if (timedOut) {
    props.setProperty(REBUILD_PROP_DONE, JSON.stringify(doneSources));
    props.setProperty(REBUILD_PROP_TOTAL, String(totalNew));
    scheduleRebuildContinuation();
    var partialMsg = 'fullRebuild: time budget reached after ['+doneSources.join(', ')+'] — +'+totalNew+' rows appended so far, auto-continuing in ~1 min';
    Logger.log(partialMsg);
    try { SpreadsheetApp.getActiveSpreadsheet().toast(partialMsg, 'Rebuild continuing…', 8); } catch(e) {}
    return;
  }

  // ── fetch phase fully complete → clear checkpoint, run match + format ──
  props.deleteProperty(REBUILD_PROP_DONE);
  props.deleteProperty(REBUILD_PROP_TOTAL);
  clearRebuildContinuationTrigger();

  Logger.log('fullRebuild: +'+totalNew+' new rows appended (fetch phase complete)');

  // ── match + format ────────────────────────────────────────────
  matchSCBtoOTA(sheet);
  matchBookingComSCB();
  syncBookingComFinancialReports();
  resolveManualExtranetHints(sheet);
  matchExtranetSCB(sheet);
  matchRoomFromSheet1();
  applyManualRoomFixes();
  syncSCBTotalRooms();
  fillMissingCiCoFromPatch();
  fillMissingCiCoFromBookingID();
  fillMissingCiCoFromEmail();
  sortPayoutByOTA(sheet);
  stylePayoutLog();
  rebuildBankLedger();
  exportToGitHub();

  var msg = 'Rebuild เสร็จ: +'+totalNew+' rows ใหม่ | Bank_Ledger updated | GitHub synced';
  Logger.log(msg);
  try { SpreadsheetApp.getActiveSpreadsheet().toast(msg, 'Done', 8); } catch(e) {}
}

// One-off trigger that re-invokes fullRebuild() shortly after a checkpointed
// timeout, so a slow rebuild finishes across multiple executions without
// any manual re-click. Cleared automatically once the fetch phase completes.
function scheduleRebuildContinuation() {
  ScriptApp.getProjectTriggers()
    .filter(function(t){ return t.getHandlerFunction()==='fullRebuild'; })
    .forEach(function(t){ ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('fullRebuild')
    .timeBased().after(60*1000)
    .create();
}
function clearRebuildContinuationTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(function(t){ return t.getHandlerFunction()==='fullRebuild'; })
    .forEach(function(t){ ScriptApp.deleteTrigger(t); });
}

function rematch() {
  quickReformat();
}

function dailyEmailSync() {
  var yday = new Date(); yday.setDate(yday.getDate()-1);
  var since = Utilities.formatDate(yday,'Asia/Bangkok','yyyy/MM/dd');
  // Booking.com Financial Reports can arrive a bit later than the stay/booking
  // itself, so give that specific search a wider (but still bounded) buffer
  // instead of the full-history rescan it used to do on every hourly run.
  var finReportLookback = new Date(); finReportLookback.setDate(finReportLookback.getDate()-14);
  var finReportSince = Utilities.formatDate(finReportLookback,'Asia/Bangkok','yyyy/MM/dd');
  var sheet = setupSheet();
  var existing = getExistingIds(sheet);
  var newRows = [];
  var searches = [
    {q:'from:automated@airbnb.com subject:"sent a payout" after:'+since, fn:parseAirbnbEmail},
    {q:'from:no-reply@app.littlehotelier.com after:'+since,              fn:parseLHEmail},
    {q:'from:noreply_htl@trip.com after:'+since,                         fn:parseTripEmail},
    {q:'from:No_reply_scbbusinessalert@scb.co.th after:'+since,          fn:parseSCBEmail}
  ];
  searches.forEach(function(s) {
    GmailApp.search(s.q,0,20).forEach(function(t) {
      t.getMessages().forEach(function(m) {
        try { s.fn(m).forEach(function(r) {
          if ((r.ota||'').startsWith('SCB') && (r.date||'') < '2026-03-01') return;
          var bid2 = r.bookingId;
          if ((r.ota||'') === 'Airbnb') {
            bid2 = resolveAirbnbBid(bid2, Number(r.net)||0, existing);
            if (!bid2) return;
            r.bookingId = bid2;
          }
          if (!existing.has(bid2)) { newRows.push(r); existing.set(bid2, Number(r.net)||0); }
        }); } catch(e){ Logger.log('ERR: '+e.message); }
      });
    });
  });

  newRows.forEach(function(r){ appendRow(sheet,r); });

  // 363/Mycondo doesn't sync with Little Hotelier, so its Airbnb bookings
  // never reach Sheet1 the way every other room's do. Parses Airbnb's
  // "Reservation confirmed" host email (sent at booking time) instead.
  // See Airbnb363ToSheet1.gs for details — folded in here rather than a
  // separate trigger since dailyEmailSync already runs hourly.
  try { syncAirbnb363Reservations(); } catch(e) { Logger.log('ERR syncAirbnb363Reservations: '+e.message); }

  matchSCBtoOTA(sheet);
  matchBookingComSCB();
  syncBookingComFinancialReports(finReportSince);
  resolveManualExtranetHints(sheet);
  matchExtranetSCB(sheet);
  matchRoomFromSheet1();
  applyManualRoomFixes();
  syncSCBTotalRooms();
  fillMissingCiCoFromPatch();
  fillMissingCiCoFromBookingID();
  fillMissingCiCoFromEmail();
  sortPayoutByOTA(sheet);
  stylePayoutLog();
  rebuildBankLedger();

  exportToGitHub();
  Logger.log('daily: +'+newRows.length+' new rows | Bank_Ledger rebuilt | GitHub synced');
}

function createDailyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(function(t){ return t.getHandlerFunction()==='dailyEmailSync'; })
    .forEach(function(t){ ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('dailyEmailSync')
    .timeBased().everyHours(1)
    .create();
  Logger.log('Trigger: ทุก 1 ชั่วโมง');
}

// ═══════════════════════════════════════════════════════════════
// FETCH
// ═══════════════════════════════════════════════════════════════
function fetchAirbnbPayouts() {
  return fetchAndParse(
    'from:automated@airbnb.com subject:"sent a payout" after:'+SEARCH_FROM, 100, parseAirbnbEmail);
}
function fetchLittleHotelierBookings() {
  return fetchAndParse(
    'from:no-reply@app.littlehotelier.com after:'+SEARCH_FROM, 100, parseLHEmail);
}
function fetchTripComBookings() {
  var seen = {}, newRows = [];
  var queries = [
    'subject:"ยืนยันหมายเลขการจอง" after:'+SEARCH_FROM,
    'subject:"Booking no" after:'+SEARCH_FROM,
    'from:noreply_htl@trip.com after:'+SEARCH_FROM,
  ];
  queries.forEach(function(q) {
    GmailApp.search(q, 0, 50).forEach(function(t) {
      t.getMessages().forEach(function(m) {
        try {
          parseTripEmail(m).forEach(function(r) {
            if (!seen[r.bookingId]) { seen[r.bookingId]=true; newRows.push(r); }
          });
        } catch(e) { Logger.log('ERR HTML: '+e.message); }
        try {
          m.getAttachments().forEach(function(att) {
            var aType = att.getContentType().toLowerCase();
            var aName = att.getName().toLowerCase();
            if (!/eml|message\/rfc822|octet-stream/.test(aType+aName)) return;
            var content = att.getDataAsString('UTF-8');
            var text = stripHTML(content.replace(/=\r?\n/g,'').replace(/=3D/g,'='));
            if (!/Reservation no\.|trip\.com/i.test(text)) return;
            parseTripText(text, fmtDate(m.getDate()), m.getSubject()).forEach(function(r) {
              if (!seen[r.bookingId]) { seen[r.bookingId]=true; newRows.push(r); }
            });
          });
        } catch(e) { Logger.log('ERR att: '+e.message); }
      });
    });
  });
  Logger.log('fetchTripComBookings: '+newRows.length+' rows');
  return newRows;
}
function fetchSCBAlerts() {
  return fetchAndParse(
    'from:No_reply_scbbusinessalert@scb.co.th after:'+SEARCH_FROM, 200, parseSCBEmail);
}
function fetchAndParse(q, limit, fn) {
  if (!q || typeof fn !== 'function') return [];
  var rows = [], seen = {};
  GmailApp.search(q, 0, limit || 50).forEach(function(t) {
    t.getMessages().forEach(function(m) {
      try {
        fn(m).forEach(function(r) {
          if (!seen[r.bookingId]) { seen[r.bookingId]=true; rows.push(r); }
        });
      } catch(e){ Logger.log('ERR: '+e.message+' | '+m.getSubject()); }
    });
  });
  return rows;
}

// ═══════════════════════════════════════════════════════════════
// AIRBNB PARSER
// ═══════════════════════════════════════════════════════════════
function parseAirbnbEmail(msg) {
  var raw = msg.getPlainBody();
  var dt  = fmtDate(msg.getDate());
  if (raw.indexOf('was sent') < 0) return [];

  var text = raw.replace(/=\r?\n/g,'');
  text = decodeQP(text);
  text = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n');

  var bm = text.match(/[฿\u0e3f]([\d,]+\.\d+)\s*THB\s*was sent/i);
  var batchTotal = bm ? bm[1].replace(/,/g,'') : '';

  var allLines = text.split('\n');
  var startIdx = 0;
  for (var i=0;i<allLines.length;i++) {
    if (/^Details\s*$/.test(allLines[i].trim())) { startIdx=i+1; break; }
  }
  var lines = [];
  for (var i=startIdx;i<allLines.length;i++) {
    var ln=allLines[i].trim(); if (ln) lines.push(ln);
  }

  var rows = [], i = 0;
  while (i < lines.length) {
    var ln = lines[i];
    var gam = ln.match(/^(.+?)\s{2,}(-)?[฿\u0e3f]([\d,]+\.\d+)\s*THB$/i);
    if (!gam) { i++; continue; }
    var guest = gam[1].trim();
    var net   = (gam[2]?'-':'')+gam[3].replace(/,/g,'');
    if (!guest||guest.length<2) { i++; continue; }
    if (/^(Total paid|Details|Bank account|Airbnb account|Get help|View)/i.test(guest)) { i++; continue; }

    var homeLine='',listLine='',confCode='';
    var checkIn='',checkOut='',isRes=false,isAdj=false,resDate='';
    for (var j=i+1;j<Math.min(i+10,lines.length);j++) {
      var nl=lines[j];
      if (!homeLine && /^Home\s*[•·\u2022\u00b7\-]/.test(nl)) {
        homeLine=nl;
        var dm=nl.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s*[-–]\s*(\d{1,2}\/\d{1,2}\/\d{4})/);
        if (dm) { checkIn=slashToISO(dm[1]); checkOut=slashToISO(dm[2]); }
      } else if (!homeLine&&/^Resolution\s*(Payout|Adjustment)/i.test(nl)) {
        homeLine=nl; isRes=true;
        var rm=nl.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
        if (rm) resDate=slashToISO(rm[1]);
      } else if (!homeLine&&/^Adjustment\b/i.test(nl)) {
        homeLine=nl; isAdj=true;
        var dm2=nl.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s*[-–]\s*(\d{1,2}\/\d{1,2}\/\d{4})/);
        if (dm2) { checkIn=slashToISO(dm2[1]); checkOut=slashToISO(dm2[2]); }
        var rm2=nl.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
        if (rm2) resDate=slashToISO(rm2[1]);
      } else if (!homeLine&&/(\d{1,2}\/\d{1,2}\/\d{4})\s*[-–]\s*(\d{1,2}\/\d{1,2}\/\d{4})/.test(nl)) {
        // Generic category line (e.g. "Cancellation Fee - 7/4/2026 - 7/7/2026")
        // ที่ไม่ใช่ Home/Resolution/Adjustment - กันไม่ให้ scan รั่วไปกินข้อมูลของ
        // guest ถัดไป (root cause: Nicco Joselito Tan หายไปจาก payout 2026-07-05
        // เพราะ Moritz's Cancellation Fee line ไม่ match ตัวไหนเลย)
        homeLine=nl;
        var dm3=nl.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s*[-–]\s*(\d{1,2}\/\d{1,2}\/\d{4})/);
        if (dm3) { checkIn=slashToISO(dm3[1]); checkOut=slashToISO(dm3[2]); }
      } else if (homeLine&&!listLine&&nl.indexOf('(')>=0) {
        listLine=nl;
      } else if (homeLine&&!listLine&&!confCode&&/^The Loft|Loft|loft/i.test(nl)) {
        listLine=nl;
      } else if ((homeLine||listLine)&&!confCode&&/^[A-Z0-9]{6,14}$/.test(nl)) {
        confCode=nl; break;
      } else if (homeLine&&!confCode&&!listLine&&/^[A-Z0-9]{6,14}$/.test(nl)) {
        confCode=nl; break;
      }
    }

    // Resolution/Adjustment payout lines don't carry the actual stay dates
    // themselves (e.g. "Resolution Payout 7/6/2026") - the real Home d/m/yyyy
    // date range often appears on a nearby line but gets skipped above because
    // homeLine is already locked in by the Resolution/Adjustment match.
    // root cause: 2026-07-06 Moritz Resolution Payout had blank checkIn/checkOut,
    // which broke matching against Sheet1 booking (BookingInvoiceTodo "ไม่มี Booking").
    // Backfill by scanning the same window for any date-range line we haven't used yet.
    if ((isRes||isAdj) && !checkIn) {
      for (var k=i+1;k<Math.min(i+10,lines.length);k++) {
        var nlk=lines[k];
        if (nlk===homeLine) continue;
        var dmk=nlk.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s*[-–]\s*(\d{1,2}\/\d{1,2}\/\d{4})/);
        if (dmk) { checkIn=slashToISO(dmk[1]); checkOut=slashToISO(dmk[2]); break; }
      }
    }

    // conf ใน AIRBNB_EXTENSIONS → ใช้ checkOut เป็น suffix เพื่อแยก payout หลายครั้ง
    var extSuffix = (confCode && AIRBNB_EXTENSIONS[confCode] && checkOut)
      ? '-EXT-'+checkOut.replace(/-/g,'') : '';
    var bookingId = confCode
      ? 'ABB-'+confCode+(isRes?'-RES-'+dt.replace(/-/g,''):extSuffix)
      : 'ABB-'+dt.replace(/-/g,'')+'-'+rows.length+(isRes?'-RES':'');

    rows.push(makeRow('Airbnb',dt,bookingId,confCode,
      guest, roomFromText(listLine),
      checkIn,checkOut,
      checkIn&&checkOut?nightsBetween(checkIn,checkOut):'',
      batchTotal,'',net,
      isRes?'โอนแล้ว (Resolution Payout)':(isAdj?'โอนแล้ว (Adjustment)':'โอนแล้ว'),
      isRes
        ?'Resolution Payout | '+resDate+' | Batch THB '+batchTotal+' | ส่ง '+dt
        :(isAdj
          ?'Adjustment | '+resDate+' | Batch THB '+batchTotal+' | ส่ง '+dt
          :'Airbnb Batch THB '+batchTotal+' | ส่ง '+dt)));

    if (confCode) {
      var ci2=lines.indexOf(confCode,i+1);
      i=ci2>=0?ci2+1:i+5;
    } else { i+=4; }
  }
  Logger.log('parseAirbnb "'+msg.getSubject()+'": '+rows.length+' bookings');
  return rows;
}

function decodeQP(s) {
  return s.replace(/((?:=[0-9A-Fa-f]{2})+)/g, function(match) {
    try {
      var bytes = match.split('=').filter(Boolean).map(function(h){ return parseInt(h,16); });
      return Utilities.newBlob(bytes).getDataAsString('UTF-8');
    } catch(e) { return match; }
  });
}

// ═══════════════════════════════════════════════════════════════
// LITTLE HOTELIER (Booking.com + Expedia)
// ═══════════════════════════════════════════════════════════════
function parseLHEmail(msg) {
  var body = msg.getPlainBody().replace(/\r\n/g,'\n');
  var subj = msg.getSubject(), dt = fmtDate(msg.getDate());
  var ota = 'Unknown';
  if (/booking\.com/i.test(subj+body)) ota='Booking.com';
  else if (/expedia/i.test(subj+body)) ota='Expedia';
  if (/cancellation/i.test(subj)) return [];

  var bookingId = gRe(body,/Booking Confirmation Id[:\s]*\n?([\d]+)/);
  if (!bookingId) return [];

  var lines=body.split('\n'), guest='';
  for (var i=0;i<lines.length;i++) {
    if (/^Guest:\s*$/.test(lines[i].trim())) {
      guest=(lines[i+1]||'').trim().replace(/\s+(Age:|Guest Count:).*$/i,'').trim(); break;
    }
  }
  if (!guest||guest.length<2) {
    var sm=subj.match(/for\s+([A-Z][^,]+,[^,]+),\s*Arriving/i);
    guest=sm?sm[1].trim():'?';
  }

  var ci    = lhDateToISO(gRe(body,/Check In Date[:\s]*\n?(\d{2}-[A-Za-z]+-\d{4})/));
  var co    = lhDateToISO(gRe(body,/Check Out Date[:\s]*\n?(\d{2}-[A-Za-z]+-\d{4})/));
  var total = gRe(body,/Total Price[:\s]*\n?([\d,]+\.?\d*)\s*THB/);
  var comm  = gRe(body,/Commission Payable[:\s]*\n?([\d,]+\.?\d*)\s*THB/);
  var remit = gRe(body,/Remittance amount[:\s]*([\d,]+\.?\d*)/);
  var roomL = gRe(body,/ROOM\s*[-–]\s*([^\n]+)/);
  var net   = remit||(total&&comm?(parseAmt(total)-parseAmt(comm)).toFixed(2):total||'');
  var status= ota==='Booking.com'?'PrePaid - รอ Booking.com โอน':'Net Rate - รอ Expedia remittance';

  return [makeRow(ota,dt,bookingId,bookingId,guest,roomFromText(roomL),
    ci,co,nightsBetween(ci,co),total,comm,net,status,'via Little Hotelier')];
}

// ═══════════════════════════════════════════════════════════════
// TRIP.COM
// ═══════════════════════════════════════════════════════════════
function parseTripEmail(msg) {
  var dt  = fmtDate(msg.getDate());
  var subj= msg.getSubject();
  var html= msg.getBody();
  if (!html||html.length<50) html=msg.getPlainBody();
  if (!html) return [];
  var decoded=html.replace(/=\r?\n/g,'').replace(/=3D/g,'=');
  decoded=decoded.replace(/<style[\s\S]*?<\/style>/gi,'');
  var text=stripHTML(decoded);
  if (!/Reservation no\.|หมายเลขการจอง/i.test(text)) {
    var plain=msg.getPlainBody()||'';
    if (/Reservation no\.|หมายเลขการจอง/i.test(plain)) text=plain;
  }
  if (!/Reservation no\.|หมายเลขการจอง|trip\.com/i.test(text)) return [];
  return parseTripText(text,dt,subj);
}

function parseTripText(text,dt,subj) {
  var bookingId=gRe(text,/Reservation no[.:\s]*([\d]{10,})/);
  if (!bookingId) bookingId=gRe(text,/หมายเลขการจอง[^0-9]*([\d]{10,})/);
  if (!bookingId) return [];

  var guest=gRe(text,/Guest Name[:\s]*([^\n\r]+)/);
  if (!guest) guest=gRe(text,/ชื่อผู้เข้าพัก[:\s]*([^\n\r]+)/);
  if (guest) guest=guest.replace(/\s+/g,' ').trim();

  var roomRaw=gRe(text,/Room Type[:\s]*([^\n\r|]+)/);
  if (!roomRaw) roomRaw=gRe(text,/ประเภทห้องพัก[:\s]*([^\n\r|]+)/);

  var stayRaw=gRe(text,/Staying period[:\s]*([^\n\r]+)/);
  var ci='',co='',nights='';
  if (stayRaw) {
    var dm=stayRaw.match(/([A-Za-z]+ \d+,?\s*\d{4})\s*[-–]\s*([A-Za-z]+ \d+,?\s*\d{4})/);
    if (dm) { ci=tripDateToISO(dm[1]); co=tripDateToISO(dm[2]); }
    var nm=stayRaw.match(/(\d+)\s*night/);
    if (nm) nights=nm[1];
  }
  if (!ci) ci=thaiDateToISO(gRe(text,/วันเข้าพัก[:\s]*([^\n\r|–\-]+)/));
  if (!co) co=thaiDateToISO(gRe(text,/วันออก[:\s]*([^\n\r|–\-]+)/));

  var net=gRe(text,/Your payout[\s\S]{0,30}?THB\s*([\d,]+\.?\d*)/);
  if (!net) net=gRe(text,/THB\s*([\d,]+\.?\d*)(?:\s|\n)/);
  if (!net) net=gRe(text,/จำนวนเงินที่จ่ายให้คุณ[\s\S]{0,10}?([\d,]+\.?\d*)/);
  if (!net) net=gRe(text,/Final room rate \(incl\. taxes and fees\)[\s\S]{0,10}?([\d,]+\.?\d*)/);

  return [makeRow('Trip.com',dt,bookingId,bookingId,
    guest||'?', roomFromText(roomRaw||''),
    ci,co,nights||nightsBetween(ci,co),
    '','',net,
    'Net Rate - รอ monthly settlement',
    'Non-refundable | Prepaid | Trip.com | '+subj)];
}

// ═══════════════════════════════════════════════════════════════
// SCB PARSER
// ═══════════════════════════════════════════════════════════════
function parseSCBEmail(msg) {
  var subj=msg.getSubject();
  var dt  =fmtDate(msg.getDate());
  var plainBody=msg.getPlainBody()||'';
  var body=plainBody, isHtml=false;
  if (!plainBody||plainBody.trim().length<20) {
    var html=msg.getBody()||'';
    if (html) {
      body=stripHTML(html.replace(/=\r?\n/g,'').replace(/=3D/g,'=')
                        .replace(/&nbsp;/g,' ').replace(/&amp;/g,'&'));
      isHtml=true;
    }
  }
  if (!body||body.trim().length<10) return [];
  if (/สรุปยอดบัญชี/.test(body+subj)) return [];

  var txType=gRe(body,/ประเภทรายการ[:\s]*([^\n\r<]+)/);
  if (!txType) txType=gRe(body,/transaction\s*type[:\s]*([^\n\r<]+)/i);
  if (/ถอนเงิน|โอนเงิน|ชำระ/.test(txType)) return [];

  var isIncoming=/เงินเข้า|เงินโอนเข้า|โอนเข้า/.test(body.substring(0,800))
               ||/เงินเข้า|เงินโอนเข้า|โอนเข้า/.test(txType);
  if (!isIncoming) return [];

  var amount=gRe(body,/จำนวนเงิน[^:\n\r]*[:\s]+(?:THB\s*)?([\d,]+\.?\d*)/);
  if (!amount) amount=gRe(body,/THB[\s\u00a0]*([\d,]+\.\d+)/);
  if (!amount) return [];

  var channel=gRe(body,/ช่องทาง[:\s]*([^\n\r<]+)/);
  if (!channel) channel=gRe(body,/channel[:\s]*([^\n\r<]+)/i);
  if (!channel) channel='Transfer';

  var acct=gRe(body,/หมายเลขบัญชี[:\s]*([^\n\r<]+)/);
  if (!acct) acct=gRe(body,/account[:\s\u00a0]*([x\d]+)/i);

  var txDateRaw=gRe(body,/วันที่รายการมีผล[:\s]*([^\n\r<]+)/);
  var txDate=dt;
  if (txDateRaw) {
    var dm=txDateRaw.match(/(\d{2})-(\d{2})-(\d{4})/);
    if (dm) { var y=parseInt(dm[3]); if (y>2500) y-=543; txDate=y+'-'+dm[2]+'-'+dm[1]; }
  }

  var amtClean=amount.replace(/,/g,'');
  var pseudoId='SCB-'+txDate+'-'+amtClean;

  return [makeRow(
    'SCB ('+channel+')', txDate,
    pseudoId, '',
    'รอ match', '?',
    '','','',
    amtClean,'',amtClean,
    'เงินเข้าบัญชี '+(acct||'x256221'),
    'via SCB '+(channel||'Transfer')+' | '+txType
  )];
}

// ═══════════════════════════════════════════════════════════════
// MATCH SCB → OTA
function buildSCBRows(scbOTA, scbDate, scbBid, scbAmt, scbAcct,
                      refIds, guests, nets, detailByConf, detailByBid, payType) {

  // ✅ โหลด Sheet1 สำหรับ fallback ci/co/nights
  var s1Map = getSheet1CiCoMap();

  if (guests.length === 1) {
    var ref    = (refIds[0] || '').toString().trim();
    var guest  = (guests[0] || '').toString().trim();
    var net    = parseAmt(nets[0] || scbAmt);
    var detail = detailByConf[ref] || detailByBid[ref]
               || detailByBid['guest:' + normG(guest)] || {};
    var room   = isValidRoom(detail.room) ? cleanRoom(detail.room) : '?';
    var ci     = dateStr(detail.ci);
    var co     = dateStr(detail.co);
    var nts    = detail.nights || nightsBetween(ci, co) || '';

    // ✅ fallback จาก Sheet1 ถ้า ci/co ว่าง
    if (!ci || !co) {
      var s1 = s1Map[normG(guest)];
      if (s1) { ci = s1.ci; co = s1.co; nts = s1.nights || nightsBetween(ci, co); }
    }

    var note = '✅ '+payType+' | '+guest+'('+ref+') NET ฿'+nets[0]+' | Value Date: '+scbDate;
    var r = makeRow(scbOTA,scbDate,scbBid,ref,
      guest,room,ci,co,nts,scbAmt,'',scbAmt,
      '✅ Matched - '+payType,note);
    r._isSingle=true; r._isTotal=false;
    return [r];
  }

  var rows=[];
  var allConfs=[],allRooms=[],allGuests=[];
  var earliest=null,latest=null,totalNights=0;

  for (var j=0;j<guests.length;j++) {
    var ref   =(refIds[j]||'').toString().trim();
    var guest =(guests[j]||'').toString().trim();
    var net   =parseAmt(nets[j]||'0');
    var detail=detailByConf[ref]||detailByBid[ref]||detailByBid['guest:'+normG(guest)]||{};
    var room  =isValidRoom(detail.room)?cleanRoom(detail.room):'?';
    var ci    =dateStr(detail.ci);
    var co    =dateStr(detail.co);
    var nts   =detail.nights||'';
    // fallback: Sheet1 ci/co/room ถ้า detail ไม่ครบ
    if (!ci||!co||room==='?') {
      var s1e=s1Map[normG(guest)];
      if (s1e) {
        if (!ci) ci=s1e.ci;
        if (!co) co=s1e.co;
        if (!nts) nts=s1e.nights||nightsBetween(ci,co);
        if (room==='?'&&s1e.room&&isValidRoom(s1e.room)) room=cleanRoom(s1e.room);
      }
    }
    if (nts) { try { totalNights+=parseInt(nts); } catch(e){} }
    if (ci) { var ciD=new Date(ci); if (!earliest||ciD<earliest) earliest=ciD; }
    if (co) { var coD=new Date(co); if (!latest  ||coD>latest  ) latest  =coD; }
    allConfs.push(ref); allRooms.push(room); allGuests.push(guest);

    var subRow=makeRow(scbOTA,scbDate,scbBid,ref,
      guest,room,ci,co,nts,'','',net,'',
      '↳ '+guest+' ('+ref+') NET ฿'+net+' | Value Date: '+scbDate);
    subRow._isTotal=false; subRow._isSingle=false;
    rows.push(subRow);
  }

  var uniqueRooms=[];
  allRooms.forEach(function(r){ if(r&&r!=='?'&&uniqueRooms.indexOf(r)<0) uniqueRooms.push(r); });
  var ciStr=earliest?Utilities.formatDate(earliest,'Asia/Bangkok','yyyy-MM-dd'):'';
  var coStr=latest  ?Utilities.formatDate(latest,  'Asia/Bangkok','yyyy-MM-dd'):'';
  var nStr =totalNights>0?totalNights:'';
  var totalNote='✅ '+payType+' | '+allGuests.map(function(g,k){
    return g+'('+allConfs[k]+') NET ฿'+nets[k];
  }).join(' | ')+' | Value Date: '+scbDate;

  var totalRow=makeRow(scbOTA,scbDate,scbBid,allConfs.filter(Boolean).join(', '),
    allGuests.join(', '), uniqueRooms.length>0?uniqueRooms.join(', '):'',
    ciStr,coStr,nStr,
    scbAmt,'',scbAmt,'✅ Matched - '+payType,totalNote);
  totalRow._isTotal=true; totalRow._isSingle=false;
  rows.push(totalRow);
  return rows;
}

// ── normalizeSheetDate_: แปลงค่า date cell ใน Sheet1 → YYYY-MM-DD string ──
// รองรับ: Date object, 'YYYY-MM-DD', 'D/M/YYYY', 'M/D/YYYY', 'DD-MM-YYYY', ISO timestamp
function normalizeSheetDate_(v) {
  if (!v) return '';
  if (v instanceof Date) return Utilities.formatDate(v,'GMT+7','yyyy-MM-dd');
  var s = String(v).trim();
  if (!s) return '';
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // ISO timestamp e.g. 2026-02-19T00:00:00.000Z
  if (s.indexOf('T') > -1) {
    try { return Utilities.formatDate(new Date(s),'GMT+7','yyyy-MM-dd'); } catch(e) {}
  }
  // D/M/YYYY or DD/MM/YYYY (Thai convention)
  var slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    var dd=parseInt(slash[1],10), mm=parseInt(slash[2],10), yyyy=parseInt(slash[3],10);
    // Disambiguate: if first number > 12 it must be day; else assume D/M/YYYY (Thai)
    if (dd > 12) {
      return yyyy+'-'+(mm<10?'0':'')+mm+'-'+(dd<10?'0':'')+dd;
    } else {
      return yyyy+'-'+(dd<10?'0':'')+dd+'-'+(mm<10?'0':'')+mm;
    }
  }
  // D-M-YYYY
  var dash = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dash) {
    var dd2=parseInt(dash[1],10), mm2=parseInt(dash[2],10), yyyy2=parseInt(dash[3],10);
    if (dd2 > 12) {
      return yyyy2+'-'+(mm2<10?'0':'')+mm2+'-'+(dd2<10?'0':'')+dd2;
    } else {
      return yyyy2+'-'+(dd2<10?'0':'')+dd2+'-'+(mm2<10?'0':'')+mm2;
    }
  }
  // Fallback: take first 10 chars (handles existing YYYY-MM-DD with trailing chars)
  return s.substring(0,10);
}

function dateStr(v) {
  if (!v) return '';
  if (v instanceof Date) return Utilities.formatDate(v,'Asia/Bangkok','yyyy-MM-dd');
  var s = v.toString().trim();
  // Normalize non-standard formats via same helper
  var n = normalizeSheetDate_(v);
  return n || s.substring(0,10);
}

// ✅ NEW: Sheet1 ci/co/room fallback map
function getSheet1CiCoMap() {
  var ss = SpreadsheetApp.openById(MASTER_SHEET_ID);
  var s1 = ss.getSheets()[0];
  var data = s1.getDataRange().getValues();
  var map = {};
  var h = data[0].map(function(v){ return v.toString().trim().toLowerCase(); });
  var cG  = h.indexOf('ชื่อแขก');
  var cCI = h.indexOf('เช็คอิน');
  var cCO = h.indexOf('เช็คเอาท์');
  var cR  = h.indexOf('เลขห้อง');
  for (var i = 1; i < data.length; i++) {
    var g  = normG((data[i][cG]  || '').toString());
    var ci = dateStr(data[i][cCI]);
    var co = dateStr(data[i][cCO]);
    var rm = cR >= 0 ? (data[i][cR] || '').toString().trim() : '';
    // ดึงเฉพาะตัวเลขห้องจากหน้า เช่น "103 Elegance" → "103"
    var rmNum = rm.match(/^(\d+)/);
    if (g && ci && co) {
      map[g] = { ci: ci, co: co, nights: nightsBetween(ci, co),
                 room: rmNum ? rmNum[1] : '' };
    }
  }
  return map;
}

// ═══════════════════════════════════════════════════════════════
// MATCH ROOM FROM SHEET1
// ═══════════════════════════════════════════════════════════════
function debugConfLookup_(needle) {
  var ss=SpreadsheetApp.openById(MASTER_SHEET_ID);
  var s1=ss.getSheets()[0];
  var s1Data=s1.getDataRange().getValues();
  var s1HR=0;
  for (var i=0;i<s1Data.length;i++) {
    if (s1Data[i].join('').indexOf('เลขห้อง')>=0) { s1HR=i; break; }
  }
  var h1=s1Data[s1HR].map(function(h){return h.toString().trim().toLowerCase();});
  var cR=h1.indexOf('เลขห้อง'), cG=h1.indexOf('ชื่อแขก'), cCI=h1.indexOf('เช็คอิน');
  var hasExtractFn=typeof extractConfFromResId==='function';
  var matches=[];
  for (var i=s1HR+1;i<s1Data.length;i++) {
    var row=s1Data[i];
    var resId=(row[5]||'').toString().trim();
    var guest=(row[cG]||'').toString().trim();
    var room=(row[cR]||'').toString().trim();
    var extracted=hasExtractFn?extractConfFromResId(resId):null;
    var rawHit=needle&&resId.indexOf(needle)>=0;
    var extractHit=needle&&extracted===needle;
    if (rawHit||extractHit||(!needle&&/luis/i.test(guest))) {
      matches.push({row:i+1,resId:resId,extracted:extracted,guest:guest,room:room,rawContainsNeedle:rawHit,extractedMatchesNeedle:extractHit});
    }
  }
  return {hasExtractConfFromResId:hasExtractFn,resIdColumnIndexUsed:5,needle:needle,matches:matches,totalRowsScanned:s1Data.length-s1HR-1};
}

function matchRoomFromSheet1() {
  var ss=SpreadsheetApp.openById(MASTER_SHEET_ID);
  var s1=ss.getSheets()[0];
  var s1Data=s1.getDataRange().getValues();

  var s1HR=0;
  for (var i=0;i<s1Data.length;i++) {
    if (s1Data[i].join('').indexOf('เลขห้อง')>=0) { s1HR=i; break; }
  }
  var h1=s1Data[s1HR].map(function(h){return h.toString().trim().toLowerCase();});
  var cR =h1.indexOf('เลขห้อง');
  var cG =h1.indexOf('ชื่อแขก');
  var cCI=h1.indexOf('เช็คอิน');
  if (cR<0) cR=0;

  var byGuest={}, byGuestAll={}, byConf={};
  for (var i=s1HR+1;i<s1Data.length;i++) {
    var row=s1Data[i];
    if (!row[cR]||!row[cG]) continue;
    var roomRaw=row[cR].toString().trim();
    var roomNum=roomRaw.match(/^(\d+)/);
    if (!roomNum) continue;
    roomNum=roomNum[1];
    var isCancelled=/cancel|ยกเลิก|no show/i.test(roomRaw);
    var gk=normG(row[cG].toString());
    var ci=row[cCI]?new Date(row[cCI]):null;
    var entry={room:roomNum,ci:ci};
    if (!byGuestAll[gk]) byGuestAll[gk]=[];
    byGuestAll[gk].push(entry);
    if (!isCancelled) {
      if (!byGuest[gk]) byGuest[gk]=[];
      byGuest[gk].push(entry);
    }
    // resId (คอลัมน์ F ตาม readBookings ใน BookingInvoiceTodo.gs) มี conf code ฝังอยู่
    // เช่น "ABB-HMEQD5FAY2-20260630" → match ตรง conf code แม่นกว่าเดาชื่อ/วันที่มาก
    var resId=(row[5]||'').toString().trim();
    var confCode=typeof extractConfFromResId==='function'?extractConfFromResId(resId):null;
    if (confCode && !byConf[confCode]) byConf[confCode]=entry;
  }

  var paySheet=ss.getSheetByName(TAB_NAME);
  if (!paySheet) return;
  var payData=paySheet.getDataRange().getValues();
  var pH=payData[0].map(function(h){return h.toString().trim();});
  var pG    =pH.indexOf('ชื่อแขก');
  var pR    =pH.indexOf('ห้อง')>=0?pH.indexOf('ห้อง'):pH.indexOf('เลขห้อง');
  var pCI   =pH.indexOf('เช็คอิน');
  var pOTA  =pH.indexOf('OTA');
  var pNotes=pH.indexOf('หมายเหตุ');

  var updated=0;
  for (var i=1;i<payData.length;i++) {
    var pr=payData[i];
    var ota=(pr[pOTA]||'').toString().trim();
    var notes=(pr[pNotes]||'').toString().trim();

    if (ota.startsWith('SCB')) {
      var curRoomSCB=(pr[pR]||'').toString().trim();
      var notes=(pr[pNotes]||'').toString().trim();

      if (notes.startsWith('↳')) {
        // sub-row: parse guest + conf code from "↳ Guest Name(CONF) NET ..."
        var subM=notes.match(/↳\s*([^(]+)\(([^)]+)\)/);
        var guestForLookup=subM?subM[1].trim():'';
        var confForLookup=subM?subM[2].trim():'';
        if (!guestForLookup) continue;
        var ciSCB=pr[pCI]?new Date(pr[pCI]):null;
        var confRoomSCB=confForLookup&&byConf[confForLookup]?byConf[confForLookup].room:null;
        var foundSCB=null;
        if (confRoomSCB) {
          // conf code match = ความมั่นใจสูง แก้ทับค่าที่ผิดได้ทันทีแม้ห้องเดิมจะดู "valid" อยู่แล้ว
          // (จุดนี้เองที่ทำให้ห้อง 103 ผิดค้างอยู่ เพราะเดิม skip ทุกแถวที่มีเลขห้องอยู่แล้ว ไม่ว่าจะถูกหรือผิด)
          if (confRoomSCB!==curRoomSCB) foundSCB=confRoomSCB;
        } else if (!isValidRoom(curRoomSCB)) {
          // ไม่มี conf ให้เทียบ (ยังไม่เข้า Sheet1 / ไม่ใช่ Airbnb) → fuzzy fallback เฉพาะตอนห้องว่าง/ไม่ valid เท่านั้น
          // ความมั่นใจต่ำกว่า conf code เลยห้ามทับค่าที่มีอยู่แล้ว
          foundSCB=findRoom(guestForLookup,ciSCB,byGuestAll);
        }
        if (foundSCB) {
          paySheet.getRange(i+1,pR+1).setValue(foundSCB.toString().replace(/\.0$/,''));
          payData[i][pR]=foundSCB;
          updated++;
        }
      } else if (notes.indexOf('✅')===0) {
        // total/summary row: รวมห้องของทุก sub-booking ใน batch นี้
        // ใช้ conf code จาก notes ของแถวนี้เองเป็นหลัก (self-contained, deterministic)
        // เดิม scan sibling sub-rows แทน ซึ่งพัง 2 ทาง: (1) ถ้า total rowถูกประมวลผลก่อน
        // sub-rows ในรอบเดียวกัน จะอ่านค่าเก่าที่ยังไม่ถูกแก้ (2) ต่อให้ sub-rows ถูกแก้แล้ว
        // แต่ค่าเดิมที่ "ดู valid" อยู่ก่อน (เช่น 103 ผิดๆ) ทำให้ allRooms ไม่เคยว่าง เลยไม่ยอม
        // ตกไปใช้ conf-code fallback เลย — ห้อง 103 เลยค้างอยู่ในบรรทัดรวมแม้ sub-rows ถูกแล้ว
        var seen={}, allRooms=[];
        var guestMatches=notes.match(/([^|()]+)\(([A-Z0-9]{8,20})\)\s*NET/g)||[];
        var ciSCB=pr[pCI]?new Date(pr[pCI]):null;
        guestMatches.forEach(function(gm){
          var gm2=gm.match(/^([^(]+)\(([^)]+)\)/);
          if (!gm2) return;
          var gName=gm2[1].trim(), gConf=gm2[2].trim();
          var r=gConf&&byConf[gConf]?byConf[gConf].room:null; // 1) conf code ก่อนเสมอ
          if (!r) r=findRoom(gName,ciSCB,byGuestAll); // 2) fuzzy fallback
          if (!r && gConf) {
            // 3) conf นี้ไม่มีใน Sheet1 เลย (เช่น Luis) → เช็คว่า sub-row ของ conf นี้เอง
            // ถูกแก้มือไว้แล้วหรือยัง (เช่นพิมพ์เลขห้องใส่ตรงๆ ตอน auto-match หาไม่เจอ)
            for (var k=1;k<payData.length;k++) {
              var kNotes=(payData[k][pNotes]||'').toString().trim();
              if (kNotes.startsWith('\u21b3') && kNotes.indexOf('('+gConf+')')>=0) {
                var kRoom=(payData[k][pR]||'').toString().trim();
                if (isValidRoom(kRoom)) r=kRoom;
                break;
              }
            }
          }
          if (r) {
            var rs=r.toString().replace(/\.0$/,'');
            if (!seen[rs]) { seen[rs]=true; allRooms.push(rs); }
          }
        });
        if (allRooms.length===0) continue;
        var roomStr=allRooms.join(', ');
        if (roomStr!==curRoomSCB) {
          paySheet.getRange(i+1,pR+1).setValue(roomStr);
          payData[i][pR]=roomStr;
          updated++;
        }
      }
      continue;
    }

    var curRoom=(pr[pR]||'').toString().trim();
    var guestRaw=(pr[pG]||'').toString().trim();
    if (!guestRaw||/^(รอ match)$/i.test(guestRaw)) continue;
    var ci=pr[pCI]?new Date(pr[pCI]):null;
    var pConfCol=pH.indexOf('Conf. Code');
    var rowConf=pConfCol>=0?(pr[pConfCol]||'').toString().trim():'';
    var confRoom=rowConf&&byConf[rowConf]?byConf[rowConf].room:null;
    var found=null;
    if (confRoom) {
      if (confRoom!==curRoom) found=confRoom; // conf code แม่นยำ แก้ทับค่าเดิมได้แม้จะดู valid อยู่แล้ว
    } else if (!isValidRoom(curRoom)) {
      // ใช้ byGuestAll (รวม booking ที่ยกเลิกแล้ว) เหมือน SCB branch ด้านบน —
      // เดิมใช้ byGuest (ไม่รวม cancelled) ทำให้ guest ที่ถูกยกเลิกใน Sheet1
      // (เช่น "204 Elegance ยกเลิก") หาห้องไม่เจอเลยแม้จะมี conf/checkin ตรงกัน
      // root cause: Moritz Reinhold Airbnb rows ค้างเป็น "?" ทั้งที่ SCB row ข้างๆ resolve ได้
      found=findRoom(guestRaw,ci,byGuestAll); // fuzzy ต่ำกว่า conf → เติมเฉพาะช่องว่าง ห้ามทับของเดิม
    }
    if (found) {
      paySheet.getRange(i+1,pR+1).setValue(found.toString().replace(/\.0$/,''));
      payData[i][pR]=found;
      updated++;
    }
  }
  Logger.log('matchRoomFromSheet1: '+updated+' rows updated');
  return updated;
}

function findRoom(guestRaw,ci,byGuest) {
  var CI_WINDOW_EXACT = 3*86400000;  // 3 วัน สำหรับ exact name match
  var CI_WINDOW_FUZZY = 5*86400000;  // 5 วัน สำหรับ fuzzy match
  var CI_WINDOW_DATE  = 1*86400000;  // 1 วัน สำหรับ date-only fallback (ชื่อเปลี่ยนสิ้นเชิง)

  var gk=normG(guestRaw);
  // 1. Exact normalized name match
  if (byGuest[gk]) {
    var cands=byGuest[gk];
    if (ci) {
      var dc=cands.filter(function(c){
        return c.ci&&Math.abs(ci.getTime()-c.ci.getTime())<=CI_WINDOW_EXACT;
      });
      // ถ้าระบุ ci มาแล้วไม่มี candidate ไหนอยู่ในช่วงวันที่เลย ห้ามเดา
      // (เดิม fallback ไปห้องแรกของชื่อซ้ำ ทำให้ได้ห้องผิดจากการจองเก่าคนละรอบ)
      return dc.length ? dc[0].room : null;
    }
    return cands[0].room; // ถ้าไม่มี CI → return ห้องแรก
  }

  // 1.5 CJK / substring match — ชื่อแขกจีนใน payout มักสั้นกว่าใน Sheet1 (เช่น
  // Airbnb payout ใช้ "佰顺" แต่ Sheet1 มี "佰顺 王" เต็ม) ทำให้ exact match (step 1)
  // พลาด และ fuzzy word-match (step 2) ก็พลาดด้วยเพราะ CJK token สั้น (≤2 ตัวอักษร)
  // เลยโดน filter ทิ้งตั้งแต่ p.length>2 จน parts กลายเป็น [] — เคส HMFTY4YTTK/佰顺
  // (ยกเลิกก่อนเช็คอิน) เป็นตัวอย่าง root cause นี้
  if (/[\u3400-\u9FFF]/.test(gk)) {
    var gkNoSpace=gk.replace(/\s+/g,'');
    var cjkCands=[];
    Object.keys(byGuest).forEach(function(k){
      var kNoSpace=k.replace(/\s+/g,'');
      if (kNoSpace&&gkNoSpace&&(kNoSpace.indexOf(gkNoSpace)>=0||gkNoSpace.indexOf(kNoSpace)>=0)) {
        cjkCands=cjkCands.concat(byGuest[k]);
      }
    });
    if (cjkCands.length) {
      if (ci) {
        var dcCjk=cjkCands.filter(function(c){
          return c.ci&&Math.abs(ci.getTime()-c.ci.getTime())<=CI_WINDOW_EXACT;
        });
        if (dcCjk.length) return dcCjk[0].room;
        // ไม่มี candidate ตรงช่วงวันที่ → ปล่อยตกไป step ถัดไป ไม่เดา
      } else if (cjkCands.length) {
        return cjkCands[0].room;
      }
    }
  }

  // 2. Fuzzy: แต่ละ word part ต้อง match "ทั้งคำ" กับคำใน key เท่านั้น (ลด threshold เป็น 1 ถ้าชื่อ part ยาวพอ)
  // เดิมใช้ k.indexOf(p)>=0 ซึ่งเป็น substring match ทำให้ false-positive ง่าย
  // (เช่น "ange" ไป match คำที่มี "ange" อยู่ข้างในโดยไม่ใช่คำเดียวกัน)
  var parts=gk.split(' ').filter(function(p){return p.length>2;});
  if (parts.length) {
    var best=null, bestScore=0;
    Object.keys(byGuest).forEach(function(k) {
      var kWords=k.split(' ');
      var score=0;
      parts.forEach(function(p){
        if (kWords.indexOf(p)>=0) score+=p.length; // ต้อง match ทั้งคำ ไม่ใช่ substring
      });
      if (score>bestScore) { bestScore=score; best=k; }
    });
    // threshold: ถ้า part ยาว ≥5 ตัวอักษร score 1 ก็พอ; ไม่งั้นต้อง ≥2 parts
    var longPart=parts.some(function(p){return p.length>=5;});
    var minScore=longPart?5:8; // score เป็น sum of lengths
    if (bestScore>=minScore&&best) {
      var cands=byGuest[best];
      if (ci) {
        var dc=cands.filter(function(c){
          return c.ci&&Math.abs(ci.getTime()-c.ci.getTime())<=CI_WINDOW_FUZZY;
        });
        // เช่นเดียวกับข้อ 1: มี ci แล้วไม่มี candidate ตรงช่วงวันที่ → ห้ามเดา ปล่อยให้ตกไป step 3/null
        return dc.length ? dc[0].room : null;
      }
      return cands[0].room;
    }
  }

  // 3. Date-only fallback — ชื่อแขกเปลี่ยนสิ้นเชิง (เช่น Airbnb เปลี่ยนชื่อที่แสดง/privacy mask)
  // ใช้ได้เฉพาะกรณี check-in ตรงกัน "เพียงห้องเดียว" ทั้งระบบ เพื่อกันจับคู่ผิด
  if (ci) {
    var dateMatches=[];
    Object.keys(byGuest).forEach(function(k){
      byGuest[k].forEach(function(c){
        if (c.ci && Math.abs(ci.getTime()-c.ci.getTime())<=CI_WINDOW_DATE) {
          dateMatches.push(c.room);
        }
      });
    });
    var uniqueRooms=dateMatches.filter(function(r,idx){return dateMatches.indexOf(r)===idx;});
    if (uniqueRooms.length===1) return uniqueRooms[0];
  }
  return null;
}

function normG(s) {
  var words = s.toString().toLowerCase()
    .replace(/[,\/\\]+/g,' ')
    .replace(/\s+/g,' ').trim()
    .split(' ');
  words.sort();
  return words.join(' ');
}

// ═══════════════════════════════════════════════════════════════
// APPLY MANUAL ROOM FIXES
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// REBUILD BANK_LEDGER
// ═══════════════════════════════════════════════════════════════
function rebuildBankLedger() {
  var ss=SpreadsheetApp.openById(MASTER_SHEET_ID);
  var srcSheet=ss.getSheetByName(TAB_NAME);
  var blSheet=ss.getSheetByName(BANK_LEDGER_TAB);
  if (!blSheet) blSheet=ss.insertSheet(BANK_LEDGER_TAB);
  if (!srcSheet||srcSheet.getLastRow()<2) return;

  var srcLast=srcSheet.getLastRow();
  var srcData=srcSheet.getRange(2,1,srcLast-1,HEADERS.length).getValues();
  var srcFmts=srcSheet.getRange(2,1,srcLast-1,HEADERS.length).getBackgrounds();

  var keepRows=[],keepFmts=[];
  srcData.forEach(function(row,i) {
    var ota   =(row[C.ota-1]   ||'').toString().trim();
    var notes =(row[C.notes-1] ||'').toString().trim();
    var status=(row[C.status-1]||'').toString().trim();
    var bid   =(row[C.bid-1]   ||'').toString().trim();
    if (!ota.startsWith('SCB')) return;                         // SCB only
    if (notes.startsWith('↳')) return;                         // exclude SCB sub-rows
    if (!status.startsWith('✅')) return;                       // exclude SCB unmatched (check status not notes)
    if (bid==='THB' || /^\d/.test(ota)) return;               // exclude summary/footer rows
    keepRows.push(row); keepFmts.push(srcFmts[i]);
  });

  blSheet.clearContents(); blSheet.clearFormats();
  var hRange=blSheet.getRange(1,1,1,HEADERS.length);
  hRange.setValues([HEADERS]);
  hRange.setBackground('#1a1a2e').setFontColor('#ffffff')
        .setFontWeight('bold').setFontSize(10)
        .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  blSheet.setFrozenRows(1);
  blSheet.showColumns(1, HEADERS.length);  // unhide all columns first
  [2,3,4,11,12].forEach(function(c){ blSheet.hideColumns(c); }); // hide OTA, Booking ID, Conf. Code, Commission, NET
  [110,110,180,140,200,80,105,105,55,110,115,110,200,300]
    .forEach(function(w,i){ blSheet.setColumnWidth(i+1,w); });

  if (keepRows.length>0) {
    var wr=blSheet.getRange(2,1,keepRows.length,HEADERS.length);
    wr.setValues(keepRows); wr.setBackgrounds(keepFmts);
    blSheet.getRange(2,10,keepRows.length,3).setNumberFormat('#,##0.00');
  }

  Logger.log('rebuildBankLedger: '+keepRows.length+' rows');
  ss.setActiveSheet(blSheet);

  // Build executive dashboard tab
  buildDashboardTab(ss, keepRows);
}

// ═══════════════════════════════════════════════════════════════
// DASHBOARD TAB — สรุปยอดรายรับผู้บริหาร
// ═══════════════════════════════════════════════════════════════
function buildDashboardTab(ss, keepRows) {
  var TAB = 'Dashboard';
  var sh  = ss.getSheetByName(TAB);
  if (!sh) sh = ss.insertSheet(TAB);
  sh.clearContents();
  sh.clearFormats();
  sh.getCharts().forEach(function(c){ sh.removeChart(c); });

  // ── OTA display names & colors ──────────────────────────────
  var OTA_META = {
    'Airbnb payout':           { short:'Airbnb',   hex:'#FF5A5F', light:'#fff0f0' },
    'Booking.com remittance':  { short:'Booking',  hex:'#003580', light:'#e8f0ff' },
    'Expedia remittance':      { short:'Expedia',  hex:'#FFB900', light:'#fffbe6' },
    'Trip.com settlement':     { short:'Trip.com', hex:'#1BA0E2', light:'#e6f7ff' }
  };

  // ── Parse keepRows into monthly/OTA buckets ──────────────────
  var monthly={}, months=[], otas=[], roomMap={};
  keepRows.forEach(function(row){
    var status=(row[C.status-1]||'').toString();
    var amt=parseAmt(row[C.net-1]);
    var dt=row[C.date-1];
    var room=(row[C.room-1]||'').toString().trim();
    var m=status.match(/Matched\s*-\s*(.+)$/);
    var ota=m?m[1].trim():'SCB';
    var d=dt instanceof Date?dt:new Date(dt);
    var mKey=isNaN(d.getTime())?'Unknown':(d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2));
    var key=mKey+'||'+ota;
    if(!monthly[key]) monthly[key]={amt:0,count:0,month:mKey,ota:ota};
    monthly[key].amt+=amt; monthly[key].count++;
    if(months.indexOf(mKey)<0) months.push(mKey);
    if(otas.indexOf(ota)<0) otas.push(ota);
    // per-room
    var rooms=room.split(',');
    rooms.forEach(function(rm){
      rm=rm.trim(); if(!rm||rm==='?') return;
      if(!roomMap[rm]) roomMap[rm]=0;
      roomMap[rm]+=amt/rooms.length;
    });
  });
  months.sort(); otas.sort();

  var monthTotals={};
  months.forEach(function(m){
    var t=0; otas.forEach(function(o){ var d=monthly[m+'||'+o]; if(d) t+=d.amt; });
    monthTotals[m]=t;
  });
  var grandTotal=0;
  months.forEach(function(m){ grandTotal+=monthTotals[m]; });

  // ── Column widths ────────────────────────────────────────────
  sh.setColumnWidth(1,160);
  sh.setColumnWidth(2,12);
  for(var ci=0;ci<otas.length;ci++) sh.setColumnWidth(3+ci,125);
  sh.setColumnWidth(3+otas.length,125);
  sh.setColumnWidth(3+otas.length+1,60);
  sh.setColumnWidth(3+otas.length+2,160);
  sh.setColumnWidth(3+otas.length+3,105);

  // ── TITLE ────────────────────────────────────────────────────
  var r=1;
  sh.getRange(r,1,1,3+otas.length+1).merge()
    .setValue('📊  สรุปยอดรายรับ — The Loft Living Space')
    .setBackground('#0d1b2a').setFontColor('#ffffff')
    .setFontWeight('bold').setFontSize(14)
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sh.setRowHeight(r,38); r++;

  var nowStr=Utilities.formatDate(new Date(),'Asia/Bangkok','d MMM yyyy HH:mm');
  sh.getRange(r,1,1,3+otas.length+1).merge()
    .setValue('อัปเดต: '+nowStr+'  •  ข้อมูล SCB bank reconciled')
    .setBackground('#1a2b3c').setFontColor('#adb5bd')
    .setFontSize(9).setHorizontalAlignment('center');
  sh.setRowHeight(r,18); r++;
  r++;

  // ── KPI CARDS ────────────────────────────────────────────────
  var curMonth=months[months.length-1]||'';
  var kpiData=[
    {label:'💰 รายรับรวม (THB)', value:grandTotal, fmt:'#,##0', bg:'#c8e6c9', tc:'#1b5e20'},
    {label:'📅 เดือนที่บันทึก',   value:months.length, fmt:'0', bg:'#bbdefb', tc:'#0d47a1'},
    {label:'🏦 จำนวนธุรกรรม',   value:keepRows.length, fmt:'0', bg:'#ffe0b2', tc:'#e65100'},
    {label:'📈 ล่าสุด '+(curMonth||'-'), value:curMonth?monthTotals[curMonth]:0, fmt:'#,##0', bg:'#f3e5f5', tc:'#4a148c'}
  ];
  kpiData.forEach(function(k,ki){
    var col=1+ki*2;
    sh.getRange(r,col).setValue(k.label).setBackground(k.bg).setFontColor('#555555').setFontSize(8).setFontWeight('bold').setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
    sh.getRange(r+1,col).setValue(k.value).setBackground(k.bg).setFontColor(k.tc).setFontSize(14).setFontWeight('bold').setNumberFormat(k.fmt).setHorizontalAlignment('center');
    sh.setColumnWidth(col,130);
    if(ki<kpiData.length-1) sh.setColumnWidth(col+1,10);
  });
  sh.setRowHeight(r,22); sh.setRowHeight(r+1,30);
  r+=3;

  // ── TABLE: รายรับแยกเดือน / OTA ─────────────────────────────
  sh.getRange(r,1,1,3+otas.length+1).merge()
    .setValue('รายรับแยกเดือน / OTA (THB)')
    .setBackground('#263238').setFontColor('#eceff1').setFontWeight('bold').setFontSize(10);
  sh.setRowHeight(r,22); r++;

  sh.getRange(r,1).setValue('เดือน').setBackground('#37474f').setFontColor('#ffffff').setFontWeight('bold').setFontSize(9);
  sh.getRange(r,2).setBackground('#37474f');
  otas.forEach(function(ota,i){
    var meta=OTA_META[ota]||{short:ota,hex:'#607d8b'};
    sh.getRange(r,3+i).setValue(meta.short).setBackground(meta.hex).setFontColor('#ffffff').setFontWeight('bold').setFontSize(9).setHorizontalAlignment('center');
  });
  sh.getRange(r,3+otas.length).setValue('รวม').setBackground('#37474f').setFontColor('#ffffff').setFontWeight('bold').setFontSize(9).setHorizontalAlignment('center');
  sh.getRange(r,3+otas.length+1).setValue('txn').setBackground('#37474f').setFontColor('#aaaaaa').setFontSize(8).setHorizontalAlignment('center');
  sh.setRowHeight(r,20);
  var dataStartRow=r; r++;

  var monthBg=['#f8f9fa','#ffffff'];
  months.forEach(function(m,mi){
    var bg=monthBg[mi%2];
    var txn=0; otas.forEach(function(o){ var d=monthly[m+'||'+o]; if(d) txn+=d.count; });
    sh.getRange(r,1).setValue(m).setBackground(bg).setFontWeight('bold').setFontSize(9);
    sh.getRange(r,2).setBackground(bg);
    otas.forEach(function(ota,i){
      var d=monthly[m+'||'+ota];
      var v=d?d.amt:0;
      var meta=OTA_META[ota]||{light:'#ffffff'};
      if(v>0){ sh.getRange(r,3+i).setValue(v).setNumberFormat('#,##0').setBackground(meta.light).setFontSize(9).setHorizontalAlignment('right'); }
      else    { sh.getRange(r,3+i).setValue('—').setBackground(bg).setFontColor('#cccccc').setFontSize(9).setHorizontalAlignment('center'); }
    });
    sh.getRange(r,3+otas.length).setValue(monthTotals[m]).setNumberFormat('#,##0').setBackground('#e8f5e9').setFontWeight('bold').setFontSize(9).setHorizontalAlignment('right');
    sh.getRange(r,3+otas.length+1).setValue(txn).setBackground(bg).setFontColor('#888').setFontSize(8).setHorizontalAlignment('center');
    sh.setRowHeight(r,18); r++;
  });

  // grand total row
  sh.getRange(r,1).setValue('💰 รวมทั้งหมด').setBackground('#1b5e20').setFontColor('#ffffff').setFontWeight('bold').setFontSize(9);
  sh.getRange(r,2).setBackground('#1b5e20');
  otas.forEach(function(ota,i){
    var t=0; months.forEach(function(m){ var d=monthly[m+'||'+ota]; if(d) t+=d.amt; });
    sh.getRange(r,3+i).setValue(t>0?t:'—').setBackground('#c8e6c9').setFontWeight('bold').setFontSize(9).setNumberFormat(t>0?'#,##0':'@').setHorizontalAlignment('right');
  });
  sh.getRange(r,3+otas.length).setValue(grandTotal).setNumberFormat('#,##0').setBackground('#a5d6a7').setFontWeight('bold').setFontSize(10).setHorizontalAlignment('right');
  sh.getRange(r,3+otas.length+1).setValue(keepRows.length).setBackground('#c8e6c9').setFontColor('#888').setFontSize(8).setHorizontalAlignment('center');
  sh.setRowHeight(r,22); r+=2;

  // ── OTA SHARE ────────────────────────────────────────────────
  sh.getRange(r,1,1,4).merge()
    .setValue('สัดส่วน OTA (% ของยอดรวม)').setBackground('#263238').setFontColor('#eceff1').setFontWeight('bold').setFontSize(10);
  sh.setRowHeight(r,22); r++;
  ['OTA','ยอดรวม','%',''].forEach(function(h,i){
    sh.getRange(r,1+i).setValue(h).setBackground('#37474f').setFontColor('#ffffff').setFontWeight('bold').setFontSize(9);
  });
  sh.setRowHeight(r,18); r++;
  otas.forEach(function(ota){
    var t=0; months.forEach(function(m){ var d=monthly[m+'||'+ota]; if(d) t+=d.amt; });
    var pct=grandTotal>0?t/grandTotal:0;
    var meta=OTA_META[ota]||{short:ota,hex:'#607d8b',light:'#f5f5f5'};
    var bar=''; var barLen=Math.round(pct*20);
    for(var b=0;b<barLen;b++) bar+='█'; for(var b=barLen;b<20;b++) bar+='░';
    sh.getRange(r,1).setValue(meta.short).setBackground(meta.light).setFontWeight('bold').setFontSize(9);
    sh.getRange(r,2).setValue(t).setNumberFormat('#,##0').setBackground(meta.light).setFontSize(9).setHorizontalAlignment('right');
    sh.getRange(r,3).setValue(pct).setNumberFormat('0.0%').setBackground(meta.light).setFontWeight('bold').setFontSize(9).setHorizontalAlignment('center');
    sh.getRange(r,4).setValue(bar).setFontColor(meta.hex).setFontFamily('Courier New').setFontSize(9).setBackground(meta.light);
    sh.setRowHeight(r,18); r++;
  });
  r++;

  // ── MOM GROWTH ───────────────────────────────────────────────
  if(months.length>=2){
    sh.getRange(r,1,1,4).merge()
      .setValue('Month-over-Month Growth').setBackground('#263238').setFontColor('#eceff1').setFontWeight('bold').setFontSize(10);
    sh.setRowHeight(r,22); r++;
    ['เดือน','ยอด','เปลี่ยนแปลง','%'].forEach(function(h,i){
      sh.getRange(r,1+i).setValue(h).setBackground('#37474f').setFontColor('#ffffff').setFontWeight('bold').setFontSize(9);
    });
    sh.setRowHeight(r,18); r++;
    months.forEach(function(m,mi){
      var cur=monthTotals[m];
      var prev=mi>0?monthTotals[months[mi-1]]:null;
      var delta=prev!=null?cur-prev:null;
      var pct=prev&&prev>0?delta/prev:null;
      var isUp=delta==null||delta>=0;
      var bg=delta==null?'#f8f9fa':(isUp?'#e8f5e9':'#ffebee');
      sh.getRange(r,1).setValue(m).setBackground(bg).setFontSize(9);
      sh.getRange(r,2).setValue(cur).setNumberFormat('#,##0').setBackground(bg).setFontSize(9).setHorizontalAlignment('right');
      sh.getRange(r,3).setValue(delta!=null?delta:'—').setNumberFormat(delta!=null?'+#,##0;-#,##0;0':'@').setBackground(bg).setFontColor(isUp?'#1b5e20':'#b71c1c').setFontWeight('bold').setFontSize(9).setHorizontalAlignment('right');
      sh.getRange(r,4).setValue(pct!=null?pct:'—').setNumberFormat(pct!=null?'+0.0%;-0.0%;0%':'@').setBackground(bg).setFontColor(isUp?'#1b5e20':'#b71c1c').setFontWeight('bold').setFontSize(9).setHorizontalAlignment('center');
      sh.setRowHeight(r,18); r++;
    });
    r++;
  }

  // ── TOP ROOMS ────────────────────────────────────────────────
  sh.getRange(r,1,1,3).merge()
    .setValue('รายรับแยกห้อง').setBackground('#263238').setFontColor('#eceff1').setFontWeight('bold').setFontSize(10);
  sh.setRowHeight(r,22); r++;
  ['ห้อง','ยอดรวม (THB)','%'].forEach(function(h,i){
    sh.getRange(r,1+i).setValue(h).setBackground('#37474f').setFontColor('#ffffff').setFontWeight('bold').setFontSize(9);
  });
  sh.setRowHeight(r,18); r++;
  var roomList=Object.keys(roomMap).sort(function(a,b){ return roomMap[b]-roomMap[a]; });
  var roomBgs=['#e3f2fd','#e8f5e9','#fff8e1','#fce4ec','#ede7f6','#e0f2f1','#fff3e0','#fafafa','#f3e5f5'];
  roomList.forEach(function(rm,ri){
    var amt=roomMap[rm]; var pct=grandTotal>0?amt/grandTotal:0;
    sh.getRange(r,1).setValue('ห้อง '+rm).setBackground(roomBgs[ri%roomBgs.length]).setFontWeight('bold').setFontSize(9);
    sh.getRange(r,2).setValue(amt).setNumberFormat('#,##0').setBackground(roomBgs[ri%roomBgs.length]).setFontSize(9).setHorizontalAlignment('right');
    sh.getRange(r,3).setValue(pct).setNumberFormat('0.0%').setBackground(roomBgs[ri%roomBgs.length]).setFontColor('#555').setFontSize(9).setHorizontalAlignment('center');
    sh.setRowHeight(r,18); r++;
  });
  r++;

  sh.setFrozenRows(3);
  sh.setTabColor('#1b5e20');
  Logger.log('buildDashboardTab: done, '+months.length+' months, '+keepRows.length+' rows');
}

// ═══════════════════════════════════════════════════════════════
// SORT
// ═══════════════════════════════════════════════════════════════
function sortPayoutByOTA(sheet) {
  if (!sheet) {
    var ss=SpreadsheetApp.openById(MASTER_SHEET_ID);
    sheet=ss.getSheetByName(TAB_NAME);
  }
  var lastRow=sheet.getLastRow();
  if (lastRow<=1) return;
  var lastCol=HEADERS.length;
  var dataRange=sheet.getRange(2,1,lastRow-1,lastCol);
  var values=dataRange.getValues();
  var bgs=dataRange.getBackgrounds();
  var fcs=dataRange.getFontColors();
  var fws=dataRange.getFontWeights();
  var fss=dataRange.getFontStyles();

  var rows=values.map(function(v,i){
    return{v:v,bg:bgs[i],fc:fcs[i],fw:fws[i],fs:fss[i]};
  });
  var OTA_ORDER={'Airbnb':1,'Booking.com':2,'Expedia':3,'Trip.com':4};
  rows.sort(function(a,b){
    var otaA=(a.v[C.ota-1]||'').toString();
    var otaB=(b.v[C.ota-1]||'').toString();
    function grp(o){ return OTA_ORDER[o]||(o.startsWith('SCB')?5:6); }
    var gA=grp(otaA),gB=grp(otaB);
    if (gA!==gB) return gA-gB;
    var dA=a.v[C.date-1] instanceof Date?a.v[C.date-1]:new Date(a.v[C.date-1]);
    var dB=b.v[C.date-1] instanceof Date?b.v[C.date-1]:new Date(b.v[C.date-1]);
    if (isNaN(dA)) dA=new Date(0); if (isNaN(dB)) dB=new Date(0);
    return otaA.startsWith('SCB')?dA-dB:dB-dA;
  });
  dataRange.setValues(rows.map(function(r){return r.v;}));
  dataRange.setBackgrounds(rows.map(function(r){return r.bg;}));
  dataRange.setFontColors(rows.map(function(r){return r.fc;}));
  dataRange.setFontWeights(rows.map(function(r){return r.fw;}));
  dataRange.setFontStyles(rows.map(function(r){return r.fs;}));
  sheet.getRange(2,10,lastRow-1,3).setNumberFormat('#,##0.00');

  // ✅ font reset: SCB sub-rows italic, total rows bold
  var lastR = sheet.getLastRow();
  if (lastR > 1) {
    var allData = sheet.getRange(2, 1, lastR-1, HEADERS.length).getValues();
    var mergedRefs2 = {};
    allData.forEach(function(row) {
      var ota = (row[C.ota-1] || '').toString().trim();
      var ref = (row[C.bid-1] || '').toString().trim();
      var conf = (row[C.conf-1] || '').toString().trim();
      if (ota.startsWith('SCB') && conf.indexOf(',') >= 0 && ref) mergedRefs2[ref] = true;
    });
    allData.forEach(function(row, i) {
      var notes = (row[C.notes-1] || '').toString();
      var ota = (row[C.ota-1] || '').toString().trim();
      var ref = (row[C.bid-1] || '').toString().trim();
      var conf = (row[C.conf-1] || '').toString().trim();
      var isSplit = ota.startsWith('SCB') && conf.indexOf(',') < 0 && mergedRefs2[ref];
      var rng = sheet.getRange(i+2, 1, 1, HEADERS.length);
      if (notes.startsWith('↳') || isSplit) {
        rng.setFontWeight('normal').setFontStyle('italic').setFontColor('#444444');
      } else if (ota.startsWith('SCB')) {
        rng.setFontWeight('bold').setFontStyle('normal').setFontColor('#000000');
      } else {
        rng.setFontWeight('normal').setFontStyle('normal').setFontColor('#000000');
      }
    });
  }
  Logger.log('sortPayoutByOTA: '+rows.length+' rows sorted');
}

// ═══════════════════════════════════════════════════════════════
// TRIP.COM SYNC
// ═══════════════════════════════════════════════════════════════
function fullSyncAndLedger() {
  var tripCount=syncTripCom();
  var ss=SpreadsheetApp.openById(MASTER_SHEET_ID);
  var paySheet=ss.getSheetByName(TAB_NAME);
  matchSCBtoOTA(paySheet);
  resolveManualExtranetHints(paySheet);
  matchExtranetSCB(paySheet);
  matchRoomFromSheet1();
  applyManualRoomFixes();
  syncSCBTotalRooms();
  rebuildBankLedger();
  SpreadsheetApp.getActiveSpreadsheet()
    .toast('Sync เสร็จ: Trip.com +'+tripCount+' | Bank_Ledger updated','Done',6);
}

function syncTripCom() {
  var sheet=setupSheet();
  var existing=getExistingIds(sheet);
  var newRows=[],seen={};
  var queries=[
    'from:noreply_htl@trip.com after:'+SEARCH_FROM,
    'subject:"ยืนยันหมายเลขการจอง" after:'+SEARCH_FROM,
    'subject:"Booking no" trip.com after:'+SEARCH_FROM,
    'subject:Fwd trip after:'+SEARCH_FROM,
  ];
  queries.forEach(function(q){
    GmailApp.search(q,0,100).forEach(function(t){
      t.getMessages().forEach(function(m){
        tryParseTripMsg(m,existing,seen,newRows);
        tryParseTripAttachments(m,existing,seen,newRows);
      });
    });
  });
  newRows.forEach(function(r){ appendRow(sheet,r); });
  Logger.log('syncTripCom: +'+newRows.length);
  return newRows.length;
}

function tryParseTripMsg(m,existing,seen,newRows){
  try {
    parseTripHtmlMsg(m).forEach(function(r){
      if (!existing.has(r.bookingId)&&!seen[r.bookingId]){
        newRows.push(r); existing.set(r.bookingId, Number(r.net)||0); seen[r.bookingId]=true;
      }
    });
  } catch(e){ Logger.log('ERR Trip body: '+e.message); }
}
function tryParseTripAttachments(m,existing,seen,newRows){
  try {
    var dt=fmtDate(m.getDate());
    m.getAttachments().forEach(function(att,ai){
      var aType=att.getContentType().toLowerCase();
      var aName=att.getName().toLowerCase();
      if (!/eml|message\/rfc822|octet-stream/.test(aType+aName)) return;
      try {
        var content=att.getDataAsString('UTF-8');
        parseTripText(stripHTML(content.replace(/=\r?\n/g,'').replace(/=3D/g,'=')),dt,m.getSubject())
          .forEach(function(r){
            if (!existing.has(r.bookingId)&&!seen[r.bookingId]){
              newRows.push(r); existing.set(r.bookingId, Number(r.net)||0); seen[r.bookingId]=true;
            }
          });
      } catch(e2){ Logger.log('ERR Trip att['+ai+']: '+e2.message); }
    });
  } catch(e){ Logger.log('ERR Trip atts: '+e.message); }
}
function parseTripHtmlMsg(m){
  var dt=fmtDate(m.getDate());
  var html=m.getBody()||m.getPlainBody();
  if (!html) return [];
  var text=stripHTML(html.replace(/=\r?\n/g,'').replace(/=3D/g,'='));
  if (!/Reservation no\.|หมายเลขการจอง|trip\.com/i.test(text)) return [];
  return parseTripText(text,dt,m.getSubject());
}

// ═══════════════════════════════════════════════════════════════
// MANUAL MATCH SCB → TRIP.COM
// ═══════════════════════════════════════════════════════════════
var TRIP_MANUAL_BATCHES = [
  { scbId:'SCB-2026-02-23-10756.33', tripIds:['1128145356180955'] },
  { scbId:'SCB-2026-02-25-4106.96',  tripIds:['1658109516118912'] },
  { scbId:'SCB-2026-03-05-3230.22',  tripIds:['1658109618839158'] },
  { scbId:'SCB-2026-03-27-1826.72',  tripIds:['1653712218028901'] },
  { scbId:'SCB-2026-04-09-2791.86',  tripIds:['1622926103974015'] },
  { scbId:'SCB-2026-05-05-5555.03',  tripIds:['1622926832063903','1622926832063939','1400825520948811'] },
  { scbId:'SCB-2026-06-25-12380.35', tripIds:['1578947342348802','1622928032878497','1622928101685164','1622928138476811','1653714323322744'] },
];

function manualMatchSCBtoTrip(){
  var ss=SpreadsheetApp.openById(MASTER_SHEET_ID);
  var sheet=ss.getSheetByName(TAB_NAME);
  if (!sheet) return;
  var last=sheet.getLastRow(); if (last<2) return;
  var data=sheet.getRange(2,1,last-1,HEADERS.length).getValues();

  var tripIndex={};
  data.forEach(function(row,i){
    if ((row[C.ota-1]||'').toString().trim()!=='Trip.com') return;
    var bid=(row[C.bid-1]||'').toString().trim(); if (!bid) return;
    tripIndex[bid]={rowIdx:i,net:parseAmt(row[C.net-1]),
                    guest:(row[C.guest-1]||'').toString(),
                    ci:row[C.ci-1],co:row[C.co-1],nights:row[C.nights-1],
                    room:(row[C.room-1]||'').toString()};
  });
  var scbIndex={};
  data.forEach(function(row,i){
    if (!(row[C.ota-1]||'').toString().startsWith('SCB')) return;
    scbIndex[(row[C.bid-1]||'').toString().trim()]=i;
  });

  // Pass 1: plan only — figure out which SCB row each batch replaces, and
  // which now-settled pending Trip.com rows ("รอ monthly settlement") need
  // to be marked โอนแล้ว in place. Nothing is written to the sheet yet.
  var scbReplacements=[];       // {row, inserts}
  var pendingRowsToUpdate=[];   // {row, note} for rows to mark โอนแล้ว
  var matched=0;

  TRIP_MANUAL_BATCHES.forEach(function(batch){
    var scbRowIdx=scbIndex[batch.scbId];
    if (scbRowIdx===undefined){ Logger.log('SCB not found: '+batch.scbId); return; }
    var scbNotes=(data[scbRowIdx][C.notes-1]||'').toString();
    if (scbNotes.indexOf('✅')===0){ Logger.log('Already matched: '+batch.scbId); return; }

    var detailByBid={};
    batch.tripIds.forEach(function(bid){
      if (tripIndex[bid]) detailByBid[bid]=tripIndex[bid];
    });

    var scbAmt =fmtAmt(data[scbRowIdx][C.net-1]);
    var scbDate=normalizeDate(data[scbRowIdx][C.date-1]||'');
    var scbOTA =(data[scbRowIdx][C.ota-1]||'').toString();
    var scbBid =(data[scbRowIdx][C.bid-1]||'').toString();

    var inserts=buildSCBRows(scbOTA,scbDate,scbBid,scbAmt,'x256221',
      batch.tripIds,
      batch.tripIds.map(function(b){ return tripIndex[b]?tripIndex[b].guest:'?'; }),
      batch.tripIds.map(function(b){ return tripIndex[b]?tripIndex[b].net.toFixed(2):'0'; }),
      {},detailByBid,'Trip.com settlement');

    scbReplacements.push({row:scbRowIdx+2, inserts:inserts});

    // Mark the original pending row for each booking this SCB payout just
    // settled — kept in the sheet, status flipped to โอนแล้ว, not deleted.
    // The ✅ Matched SCB row above still exists for rebuildBankLedger()/
    // Dashboard; getInvoiceToCreate_() already skips a row whose Conf. Code
    // shows up on a 'Matched' row elsewhere, so this can't double-invoice.
    var note='โอนแล้ว | SCB Trip.com settlement ref '+scbBid+' | Value Date: '+scbDate;
    batch.tripIds.forEach(function(bid){
      if (tripIndex[bid]) pendingRowsToUpdate.push({row:tripIndex[bid].rowIdx+2, note:note});
    });

    matched++;
  });

  // Pass 2: combine both kinds of operations (SCB replace, in-place status
  // update of settled pending rows) into one list, sorted by row number
  // descending, and execute top-down — same pattern matchSCBtoOTA uses —
  // so processing one operation never invalidates the row numbers of the
  // ones still queued. Update ops don't change row count so ordering among
  // themselves doesn't matter.
  var seenRow={};
  var ops=[];
  scbReplacements.forEach(function(rep){
    if (seenRow[rep.row]) return;
    seenRow[rep.row]=true;
    ops.push({row:rep.row, type:'scb', rep:rep});
  });
  pendingRowsToUpdate.forEach(function(u){
    if (seenRow[u.row]) return;
    seenRow[u.row]=true;
    ops.push({row:u.row, type:'update', note:u.note});
  });
  ops.sort(function(a,b){ return b.row-a.row; });

  ops.forEach(function(op){
    if (op.type==='update'){
      sheet.getRange(op.row, C.status).setValue('โอนแล้ว');
      var notesCell=sheet.getRange(op.row, C.notes);
      var existing=(notesCell.getValue()||'').toString();
      notesCell.setValue(existing ? (existing+' | '+op.note) : op.note);
      return;
    }
    sheet.deleteRow(op.row);
    var insertAt=op.row;
    op.rep.inserts.forEach(function(r,idx){
      sheet.insertRowBefore(insertAt+idx);
      var ri=insertAt+idx;
      sheet.getRange(ri,1,1,HEADERS.length).setValues([[
        r.date,r.ota,r.bookingId,r.confCode,
        r.guest,r.room,r.checkIn,r.checkOut,r.nights,
        r.total,r.commission,r.net,r.status,r.notes
      ]]);
      var bg=(r._isTotal||r._isSingle)?SCB_TOTAL_BG:SCB_SUB_BG;
      sheet.getRange(ri,1,1,HEADERS.length).setBackground(bg);
      if (r._isTotal||r._isSingle) sheet.getRange(ri,1,1,HEADERS.length).setFontWeight('bold');
      else sheet.getRange(ri,1,1,HEADERS.length).setFontStyle('italic').setFontColor('#444444');
      sheet.getRange(ri,10,1,3).setNumberFormat('#,##0.00');
    });
  });

  Logger.log('manualMatchSCBtoTrip: '+matched+' matched, '+pendingRowsToUpdate.length+' pending rows marked โอนแล้ว');
  SpreadsheetApp.getActiveSpreadsheet().toast('Match Trip.com: '+matched+' รายการ','Done',4);
}

// ═══════════════════════════════════════════════════════════════
// ONE-TIME CLEANUP: retire pending Trip.com rows that were already
// settled before the manualMatchSCBtoTrip() row-retirement fix went in.
// Finds every Trip.com booking id referenced inside a ✅ Matched / ↳ SCB
// row's Conf. Code column, then deletes any pending Trip.com row (not
// itself a ✅/↳ row) whose Booking ID matches one of those ids.
// Safe to re-run — if there's nothing stale left, it deletes 0 rows.
// ═══════════════════════════════════════════════════════════════
function cleanupStaleMatchedTripPendingRows() {
  var ss = SpreadsheetApp.openById(MASTER_SHEET_ID);
  var sheet = ss.getSheetByName(TAB_NAME);
  if (!sheet) { Logger.log('cleanupStaleMatchedTripPendingRows: sheet not found'); return; }
  var last = sheet.getLastRow();
  if (last < 2) return;
  var data = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();

  // Collect every Trip.com booking id that appears inside a ✅/↳ SCB row's
  // Conf. Code column (single-booking rows hold the raw id; multi-booking
  // total rows join several ids with ', '), plus that row's match info for
  // the note we'll attach.
  var settledIds = {};
  data.forEach(function(row) {
    var ota   = (row[C.ota-1]   || '').toString();
    var notes = (row[C.notes-1] || '').toString();
    if (!ota.startsWith('SCB')) return;
    if (notes.indexOf('✅') !== 0 && notes.indexOf('↳') !== 0) return;
    var bid  = (row[C.bid-1]  || '').toString().trim();
    var date = normalizeDate(row[C.date-1] || '');
    var conf = (row[C.conf-1] || '').toString();
    conf.split(',').forEach(function(c) {
      c = c.trim();
      if (c) settledIds[c] = 'โอนแล้ว | SCB Trip.com settlement ref ' + bid + ' | Value Date: ' + date;
    });
  });

  // Find pending Trip.com rows referencing those same ids and mark them
  // โอนแล้ว in place (never deleted — kept for record/re-check purposes).
  var toUpdate = [];
  var preview  = [];
  data.forEach(function(row, i) {
    var ota = (row[C.ota-1] || '').toString().trim();
    if (ota !== 'Trip.com') return;
    var status = (row[C.status-1] || '').toString();
    if (status.indexOf('✅') === 0 || status.indexOf('↳') === 0) return; // it's a matched row itself, skip
    if (status.indexOf('โอนแล้ว') === 0) return;                        // already marked, skip
    var bid = (row[C.bid-1] || '').toString().trim();
    if (bid && settledIds[bid]) {
      toUpdate.push({row: i + 2, note: settledIds[bid]});
      preview.push(bid + ' | ' + (row[C.guest-1]||'') + ' | ' + (row[C.net-1]||''));
    }
  });

  toUpdate.forEach(function(u) {
    sheet.getRange(u.row, C.status).setValue('โอนแล้ว');
    var notesCell = sheet.getRange(u.row, C.notes);
    var existing = (notesCell.getValue() || '').toString();
    notesCell.setValue(existing ? (existing + ' | ' + u.note) : u.note);
  });

  Logger.log('cleanupStaleMatchedTripPendingRows: marked ' + toUpdate.length + ' rows โอนแล้ว');
  Logger.log(preview.join('\n'));
  SpreadsheetApp.getActiveSpreadsheet().toast('Cleanup: mark โอนแล้ว ' + toUpdate.length + ' rows', 'Done', 5);
}

// ═══════════════════════════════════════════════════════════════
// SAFETY NET: flag Airbnb payout rows that claim 'โอนแล้ว' (money sent,
// per the payout email) but have sat unmatched against any SCB transfer
// for too long. Airbnb normally settles same-day as check-in, so if an
// Airbnb row is still un-matched (matchSCBtoOTA never found a
// corresponding SCB row for it) after AIRBNB_STALE_DAYS days, that's a
// real red flag — the money may never have actually landed in SCB.
//
// This does NOT delete or change the row's status — it stays 'โอนแล้ว'
// exactly as before, so invoice creation (PAYOUT_STATUSES_FOR_INVOICE)
// is untouched. It only appends a warning marker to the notes column
// and highlights the row, so it's visible when someone opens the sheet.
// Safe to re-run: rows already flagged aren't flagged twice, and rows
// that get matched later (status flips to ✅ Matched, or the row gets
// deleted by matchSCBtoOTA) simply stop showing up here on the next run.
// ═══════════════════════════════════════════════════════════════
var AIRBNB_STALE_DAYS   = 5;
var AIRBNB_STALE_MARK   = '⚠️ ยังไม่เจอ SCB match';
var AIRBNB_STALE_BG     = '#fff3cd';

function flagStaleUnmatchedAirbnbPayouts() {
  var ss = SpreadsheetApp.openById(MASTER_SHEET_ID);
  var sheet = ss.getSheetByName(TAB_NAME);
  if (!sheet) { Logger.log('flagStaleUnmatchedAirbnbPayouts: sheet not found'); return; }
  var last = sheet.getLastRow();
  if (last < 2) return;
  var data = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();

  var today = new Date();
  var flagged = [];

  data.forEach(function(row, i) {
    var ota = (row[C.ota-1] || '').toString().trim();
    if (ota !== 'Airbnb') return;

    var status = (row[C.status-1] || '').toString();
    if (status.indexOf('✅') === 0) return;              // already matched → fine
    if (status.indexOf('โอนแล้ว') !== 0) return;          // not a "money sent" row (e.g. refund/adjustment note differs) — adjust if needed

    var notes = (row[C.notes-1] || '').toString();
    if (notes.indexOf(AIRBNB_STALE_MARK) >= 0) return;    // already flagged, don't re-stack

    var detected = row[C.date-1];
    if (!detected) return;
    var detectedDate = (detected instanceof Date) ? detected : new Date(detected);
    if (isNaN(detectedDate.getTime())) return;

    var ageDays = Math.floor((today - detectedDate) / 86400000);
    if (ageDays < AIRBNB_STALE_DAYS) return;

    var r = i + 2;
    var newNotes = notes ? (notes + ' | ' + AIRBNB_STALE_MARK + ' (' + ageDays + ' วัน)')
                          : (AIRBNB_STALE_MARK + ' (' + ageDays + ' วัน)');
    sheet.getRange(r, C.notes).setValue(newNotes);
    sheet.getRange(r, 1, 1, HEADERS.length).setBackground(AIRBNB_STALE_BG);
    flagged.push((row[C.guest-1]||'') + ' | ฿' + (row[C.net-1]||'') + ' | ' + ageDays + ' วัน');
  });

  Logger.log('flagStaleUnmatchedAirbnbPayouts: flagged ' + flagged.length + ' rows');
  Logger.log(flagged.join('\n'));
  if (flagged.length > 0) {
    SpreadsheetApp.getActiveSpreadsheet().toast('⚠️ พบ Airbnb payout ' + flagged.length + ' รายการ ค้าง SCB match นานผิดปกติ', 'Warning', 6);
  }
}

// ═══════════════════════════════════════════════════════════════
// ONE-TIME RESTORE: bring back the 18 Trip.com rows that
// cleanupStaleMatchedTripPendingRows() deleted (2026-07-17, before the
// no-delete policy went in). Every field below was read straight off the
// still-existing ✅ Matched SCB rows those bookings settled against, so
// this is a faithful reconstruction, not a guess. Restored with status
// 'โอนแล้ว' (matching the current "never delete, mark settled" pattern)
// plus a note recording the SCB ref they matched against and that this
// row was restored. Run once from the Apps Script editor.
// ═══════════════════════════════════════════════════════════════
function restoreDeletedTripComRows() {
  var ss = SpreadsheetApp.openById(MASTER_SHEET_ID);
  var sheet = ss.getSheetByName(TAB_NAME);
  if (!sheet) { Logger.log('restoreDeletedTripComRows: sheet not found'); return; }

  var RESTORE_ROWS = [
    // [detectedDate, bookingId, guest, room, ci, co, net, scbBid, scbDate, origNote]
    ['2026-05-25','1658109618839158','Burke/Jake','300','2026-02-22','2026-02-28','3230.22','SCB-2026-03-05-3230.22','2026-03-05',
      'Non-refundable | Prepaid | Trip.com | Fwd Trip.com: Fwd Trip.com: ยืนยันหมายเลขการจอง #1658109618839158# แล้ว//Booking no. #1658109618839158# accepted#1658109618839158#'],
    ['2026-05-25','1653712218028901','Javid Osborne/Sarina','204','2026-03-17','2026-03-21','1826.72','SCB-2026-03-27-1826.72','2026-03-27',
      'Non-refundable | Prepaid | Trip.com | Fwd Trip.com: Fwd Trip.com: ยืนยันหมายเลขการจอง #1653712218028901# แล้ว//Booking no. #1653712218028901# accepted#1653712218028901#'],
    ['2026-05-25','1622926103974015','PARSAWANG/JIRANAN','204','2026-03-26','2026-04-01','2791.86','SCB-2026-04-09-2791.86','2026-04-09',
      'Non-refundable | Prepaid | Trip.com | Fwd Trip.com: Fwd Trip.com: ยืนยันหมายเลขการจอง #1622926103974015# แล้ว//Booking no. #1622926103974015# accepted#1622926103974015#'],
    ['2026-05-25','1622926832063903','BOONTUM/PAKPONG','300','2026-04-22','2026-04-25','1750.78','SCB-2026-05-05-5555.03','2026-05-05',
      'Non-refundable | Prepaid | Trip.com | Fwd Trip.com: Fwd Trip.com: Fwd: ยืนยันหมายเลขการจอง #1622926832063903# แล้ว//Booking no. #1622926832063903# accepted#1622926832063903#'],
    ['2026-05-25','1622926832063939','YAMKAMOL/METAWEE','204','2026-04-22','2026-04-25','2099.22','SCB-2026-05-05-5555.03','2026-05-05',
      'Non-refundable | Prepaid | Trip.com | Fwd Trip.com: Fwd Trip.com: ยืนยันหมายเลขการจอง #1622926832063939# แล้ว//Booking no. #1622926832063939# accepted#1622926832063939#'],
    ['2026-05-25','1400825520948811','NAM/SANG WON','108','2026-04-23','2026-04-26','1705.03','SCB-2026-05-05-5555.03','2026-05-05',
      'Non-refundable | Prepaid | Trip.com | Fwd Trip.com: Fwd Trip.com: ยืนยันหมายเลขการจอง #1400825520948811# แล้ว//Booking no. #1400825520948811# accepted#1400825520948811#'],
    ['2026-05-25','1658110928023978','OBMALEE/THIDA','204','2026-05-04','2026-05-09','1334.31','SCB-2026-05-18-1334.31','2026-05-18',
      'Non-refundable | Prepaid | Trip.com | Fwd Trip.com: Fwd Trip.com: ยืนยันหมายเลขการจอง #1658110928023978# แล้ว//Booking no. #1658110928023978# accepted#1658110928023978#'],
    ['2026-05-25','1622927451953412','Rattanabamrung/Araya','103','2026-05-18','2026-05-21','1717.56','SCB-2026-05-25-1717.56','2026-05-25',
      'Non-refundable | Prepaid | Trip.com | Fwd Trip.com: Fwd: Fwd: ยืนยันหมายเลขการจอง #1622927451953412# แล้ว//Booking no. #1622927451953412# accepted#1622927451953412#'],
    ['2026-05-25','1622927453858436','laosonti/aomsub,Rattanabamrung/Araya','103','2026-05-19','2026-05-22','1637.73','SCB-2026-05-28-1637.73','2026-05-28',
      'Non-refundable | Prepaid | Trip.com | Fwd Trip.com: noreply_htl@trip.com ยืนยันหมายเลขการจอง #1622927453858436#'],
    ['2026-05-25','1128147902481442','Shahid Hussain/Arqum','300','2026-05-14','2026-05-31','7529.75','SCB-2026-06-05-7529.75','2026-06-05',
      'Non-refundable | Prepaid | Trip.com | Fwd Trip.com: Fwd Trip.com: ยืนยันหมายเลขการจอง #1128147902481442# แล้ว//Booking no. #1128147902481442# accepted#1128147902481442#'],
    ['2026-06-05','1578947342348802','SU MYAT/AUNG','103','2026-06-03','2026-06-12','3003.63','SCB-2026-06-25-12380.35','2026-06-25',
      'Non-refundable | Prepaid | Trip.com | ประกาศ: ขอยกเว้นค่าธรรมเนียมการยกเลิกไม่สำเร็จ (หมายเลขการจอง 1578947342348802)//Notice: Cancellation fee waiver request failed (booking no. 1578947342348802)#1578947342348802#'],
    ['2026-06-12','1622928032878497','Boon/Pornpawit','103','2026-06-12','2026-06-16','2054.76','SCB-2026-06-25-12380.35','2026-06-25',
      'Non-refundable | Prepaid | Trip.com | ยืนยันหมายเลขการจอง #1622928032878497# แล้ว//Booking no. #1622928032878497# accepted#1622928032878497#'],
    ['2026-06-15','1622928101685164','Boon/Pornpawit','103','2026-06-16','2026-06-19','2175.99','SCB-2026-06-25-12380.35','2026-06-25',
      'Non-refundable | Prepaid | Trip.com | ยืนยันหมายเลขการจอง #1622928101685164# แล้ว//Booking no. #1622928101685164# accepted#1622928101685164#'],
    ['2026-06-16','1622928138476811','PATHONG/THANAPHACHARA','300','2026-06-16','2026-06-20','1905.72','SCB-2026-06-25-12380.35','2026-06-25',
      'Non-refundable | Prepaid | Trip.com | ประกาศ: ขอยกเว้นค่าธรรมเนียมการยกเลิกไม่สำเร็จ (หมายเลขการจอง 1622928138476811)//Notice: Cancellation fee waiver request failed (booking no. 1622928138476811)#1622928138476811#'],
    ['2026-06-09','1653714323322744','BUKBOON/THANAPORNPAN','204','2026-06-16','2026-06-21','3240.25','SCB-2026-06-25-12380.35','2026-06-25',
      'Non-refundable | Prepaid | Trip.com | ยืนยันหมายเลขการจอง #1653714323322744# แล้ว//Booking no. #1653714323322744# accepted#1653714323322744#'],
    ['2026-06-22','1167730507722950','BUNYACHANON/BHICHAYADA','108','2026-06-22','2026-06-29','2697.10','SCB-2026-07-06-2697.10','2026-07-06',
      'Non-refundable | Prepaid | Trip.com | ยืนยันหมายเลขการจอง #1167730507722950# แล้ว//Booking no. #1167730507722950# accepted#1167730507722950#'],
    ['2026-06-29','1622928602075634','LANDREAUGRASMUCK/SUPASUTA','300','2026-06-30','2026-07-05','2465.66','SCB-2026-07-08-2465.66','2026-07-08',
      'Non-refundable | Prepaid | Trip.com | ยืนยันหมายเลขการจอง #1622928602075634# แล้ว//Booking no. #1622928602075634# accepted#1622928602075634#'],
    ['2026-07-09','1622928831190171','Htet/Eaint Phoo','204','2026-07-10','2026-07-12','1880.52','SCB-2026-07-15-1880.52','2026-07-15',
      'Non-refundable | Prepaid | Trip.com | ยืนยันหมายเลขการจอง #1622928831190171# แล้ว//Booking no. #1622928831190171# accepted#1622928831190171#']
  ];

  var lastRow = sheet.getLastRow();
  var startRow = lastRow + 1;
  var values = RESTORE_ROWS.map(function(r) {
    var detectedDate=r[0], bid=r[1], guest=r[2], room=r[3], ci=r[4], co=r[5],
        net=r[6], scbBid=r[7], scbDate=r[8], origNote=r[9];
    var nights = Math.round((new Date(co) - new Date(ci)) / 86400000);
    var note = origNote + ' | โอนแล้ว | SCB Trip.com settlement ref ' + scbBid +
               ' | Value Date: ' + scbDate + ' | ⤴ restored ' +
               Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
    return [detectedDate,'Trip.com',bid,bid,guest,room,ci,co,nights,'','',net,'โอนแล้ว',note];
  });

  sheet.getRange(startRow, 1, values.length, HEADERS.length).setValues(values);
  sheet.getRange(startRow, 1, values.length, HEADERS.length).setBackground(OTA_BG['Trip.com']);
  sheet.getRange(startRow, 10, values.length, 3).setNumberFormat('#,##0.00');

  Logger.log('restoreDeletedTripComRows: restored ' + values.length + ' rows at row ' + startRow);
  SpreadsheetApp.getActiveSpreadsheet().toast('Restored ' + values.length + ' Trip.com rows', 'Done', 5);

  // Tidy up: re-sort and re-style so the restored rows land in the right
  // place instead of sitting appended at the bottom.
  sortPayoutByOTA(sheet);
  stylePayoutLog();
}

// ═══════════════════════════════════════════════════════════════
// DIAGNOSTIC: dump every row related to the 2026-07-04 SCB-17560.24
// payout (by bookingId, conf code, or guest name) as JSON so it can be
// inspected without direct sheet access. Run once, paste the log output.
// ═══════════════════════════════════════════════════════════════
function dumpNihel0704Rows() {
  var ss = SpreadsheetApp.openById(MASTER_SHEET_ID);
  var sheet = ss.getSheetByName(TAB_NAME);
  if (!sheet) { Logger.log('sheet not found'); return 'sheet not found'; }

  var last = sheet.getLastRow();
  var data = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();

  var confs = ['HMCCRTMXXP', 'HMKSR2SXRB', 'HMZKTN4AQ3', 'HMCTA5TJ35'];
  var names = ['Nihel', 'Leo Yang', 'Derek Wong', 'Stanley Modjadji'];

  var hits = [];
  data.forEach(function(row, i) {
    var bid   = (row[C.bid - 1]   || '').toString();
    var conf  = (row[C.conf - 1]  || '').toString();
    var guest = (row[C.guest - 1] || '').toString();
    var isHit = bid.indexOf('17560.24') >= 0 ||
                confs.some(function(c) { return conf.indexOf(c) >= 0; }) ||
                names.some(function(n) { return guest.indexOf(n) >= 0; });
    if (isHit) {
      hits.push({
        rowNum: i + 2,
        date: row[C.date - 1], ota: row[C.ota - 1], bid: bid, conf: conf,
        guest: guest, room: row[C.room - 1], ci: row[C.ci - 1], co: row[C.co - 1],
        nights: row[C.nights - 1], total: row[C.total - 1], comm: row[C.comm - 1],
        net: row[C.net - 1], status: row[C.status - 1], notes: row[C.notes - 1]
      });
    }
  });

  var out = JSON.stringify(hits, null, 2);
  Logger.log(out);
  return out;
}

// ═══════════════════════════════════════════════════════════════
// ONE-OFF FIX: 2026-07-04 Nihel adjustment mismatch (SCB-2026-07-04-17560.24)
// Root cause: parseAirbnbEmail() dropped the "-฿22.07 THB" Adjustment line
// (fixed above), so this backfills the missing row + the SCB match manually.
// Call once via: <webapp-url>?action=fixNihel0704   then delete this block.
// ═══════════════════════════════════════════════════════════════
function fixNihel0704Payout() {
  var ss = SpreadsheetApp.openById(MASTER_SHEET_ID);
  var sheet = ss.getSheetByName(TAB_NAME);
  if (!sheet) return 'sheet not found';

  var last = sheet.getLastRow();
  var data = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();

  // Guard: don't double-run
  var already = data.some(function(row) {
    return (row[C.bid - 1] || '').toString() === 'SCB-2026-07-04-17560.24' &&
           (row[C.status - 1] || '').toString().indexOf('✅') === 0;
  });
  if (already) return 'already fixed, skipped';

  // 1) Backfill the missing Nihel Airbnb adjustment row
  sheet.appendRow([
    '2026-07-04', 'Airbnb', 'ABB-HMCTA5TJ35-ADJ-20260710', 'HMCTA5TJ35',
    'Nihel', '113', '2026-05-03', '2026-07-10', 68,
    17560.24, '', -22.07,
    'โอนแล้ว (Adjustment)',
    'Adjustment | 2026-07-10 | Batch THB 17560.24 | ส่ง 2026-07-04'
  ]);

  // 2) Replace the pending SCB row with split + summary matched rows
  var pendingRowIdx = -1;
  for (var i = 0; i < data.length; i++) {
    if ((data[i][C.bid - 1] || '').toString() === 'SCB-2026-07-04-17560.24' &&
        (data[i][C.guest - 1] || '').toString().indexOf('รอ match') >= 0) {
      pendingRowIdx = i + 2; // +2: header row + 1-index
      break;
    }
  }
  if (pendingRowIdx === -1) return 'pending SCB row not found (already handled?)';

  sheet.deleteRow(pendingRowIdx);

  var splitRows = [
    ['2026-07-04','SCB (RIS)','SCB-2026-07-04-17560.24','HMCCRTMXXP','Stanley Modjadji','103','2026-06-30','2026-07-02',2,'','',3200,'','↳ Stanley Modjadji (HMCCRTMXXP) NET ฿3200.00 | Value Date: 2026-07-04'],
    ['2026-07-04','SCB (RIS)','SCB-2026-07-04-17560.24','HMKSR2SXRB','Derek Wong','205','2026-07-03','2026-07-10',7,'','',2996.17,'','↳ Derek Wong (HMKSR2SXRB) NET ฿2996.17 | Value Date: 2026-07-04'],
    ['2026-07-04','SCB (RIS)','SCB-2026-07-04-17560.24','HMZKTN4AQ3','Leo Yang','108','2026-07-03','2026-08-01',29,'','',11386.14,'','↳ Leo Yang (HMZKTN4AQ3) NET ฿11386.14 | Value Date: 2026-07-04'],
    ['2026-07-04','SCB (RIS)','SCB-2026-07-04-17560.24','HMCTA5TJ35','Nihel','113','2026-05-03','2026-07-10',68,'','',-22.07,'','↳ Nihel (HMCTA5TJ35) Adjustment NET -฿22.07 | Value Date: 2026-07-04'],
    ['2026-07-04','SCB (RIS)','SCB-2026-07-04-17560.24',
     'HMCCRTMXXP, HMKSR2SXRB, HMZKTN4AQ3, HMCTA5TJ35',
     'Stanley Modjadji, Derek Wong, Leo Yang, Nihel','103, 205, 108, 113',
     '2026-06-30','2026-08-01',32,17560.24,'',17560.24,
     '✅ Matched - Airbnb payout',
     '✅ Airbnb payout | Stanley Modjadji(HMCCRTMXXP) NET ฿3200 | Derek Wong(HMKSR2SXRB) NET ฿2996.17 | Leo Yang(HMZKTN4AQ3) NET ฿11386.14 | Nihel(HMCTA5TJ35) Adjustment -฿22.07 | Value Date: 2026-07-04']
  ];

  var startRow = pendingRowIdx;
  splitRows.forEach(function(r, idx) {
    sheet.insertRowBefore(startRow + idx);
    sheet.getRange(startRow + idx, 1, 1, HEADERS.length).setValues([r]);
    var isSummary = r[C.status - 1].toString().indexOf('✅') === 0;
    sheet.getRange(startRow + idx, 1, 1, HEADERS.length)
      .setBackground(isSummary ? SCB_TOTAL_BG : SCB_SUB_BG);
    if (isSummary) sheet.getRange(startRow + idx, 1, 1, HEADERS.length).setFontWeight('bold');
    else sheet.getRange(startRow + idx, 1, 1, HEADERS.length).setFontStyle('italic').setFontColor('#444444');
    sheet.getRange(startRow + idx, 10, 1, 3).setNumberFormat('#,##0.00');
  });

  SpreadsheetApp.getActiveSpreadsheet().toast('Fixed Nihel 2026-07-04 mismatch', 'Done', 5);
  return 'ok: backfilled Nihel adjustment + matched SCB-2026-07-04-17560.24';
}

// ═══════════════════════════════════════════════════════════════
// ONE-OFF FIX: 2026-07-05 stale duplicate row from before the
// parseAirbnbEmail() "Cancellation Fee" fix. The old broken parse
// mislabeled Moritz's cancellation row with Nicco Joselito Tan's
// homeLine/listLine/confCode (HMQ8C4C4DF), which then collided with
// the correctly re-parsed Nicco row and caused matchSCBtoOTA's bid
// dedup to skip Nicco's real +2996.07, leaving SCB-2026-07-05-2845.22
// stuck at "รอ match". This deletes the stale row and re-triggers
// matching. Call once via: <webapp-url>?action=fixNicco0705  then
// delete this block.
// ═══════════════════════════════════════════════════════════════
function fixNicco0705DuplicateRow() {
  var ss = SpreadsheetApp.openById(MASTER_SHEET_ID);
  var sheet = ss.getSheetByName(TAB_NAME);
  if (!sheet) return 'sheet not found';

  var last = sheet.getLastRow();
  var data = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();

  var targetRow = -1;
  for (var i = 0; i < data.length; i++) {
    var guest = (data[i][C.guest - 1] || '').toString().trim();
    var conf  = (data[i][C.conf - 1]  || '').toString().trim();
    var co    = normalizeDate(data[i][C.co - 1] || '');
    if (guest === 'Moritz' && conf === 'HMQ8C4C4DF' && co === '2026-07-11') {
      targetRow = i + 2; // header row + 1-index
      break;
    }
  }
  if (targetRow === -1) return 'stale row not found (already cleaned up?)';

  sheet.deleteRow(targetRow);
  matchSCBtoOTA(sheet);

  SpreadsheetApp.getActiveSpreadsheet().toast('Removed stale Moritz/HMQ8C4C4DF duplicate + rematched', 'Done', 5);
  return 'ok: deleted stale row at ' + targetRow + ', rematch triggered';
}

// ═══════════════════════════════════════════════════════════════
// doPost — trigger actions from external services (e.g. hotel-line-bot)
// ═══════════════════════════════════════════════════════════════
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action || '';
    if (action === 'styleSheet1') {
      styleSheet1();
      return ContentService.createTextOutput(JSON.stringify({ ok: true, action: 'styleSheet1' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (action === 'debugLHEmail') {
      // ดึง body ของ LH email 3 ฉบับล่าสุด ส่งกลับเป็น JSON
      var since = new Date();
      since.setMonth(since.getMonth() - 6);
      var sinceStr = Utilities.formatDate(since, 'GMT+7', 'yyyy/MM/dd');
      var threads = GmailApp.search('from:no-reply@app.littlehotelier.com after:' + sinceStr, 0, 3);
      var results = threads.map(function(thread) {
        var msg = thread.getMessages()[0];
        return {
          subject: msg.getSubject(),
          date: Utilities.formatDate(msg.getDate(), 'GMT+7', 'yyyy-MM-dd'),
          body: (msg.getPlainBody() || '').substring(0, 2000)
        };
      });
      return ContentService.createTextOutput(JSON.stringify({ ok: true, emails: results }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'unknown action: ' + action }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
function doGet(e){
  var p=e&&e.parameter?e.parameter:{};
  if (p.page==='dashboard'){
    return HtmlService.createHtmlOutputFromFile('LoftDashboard')
      .setTitle('The Loft — Reservations Dashboard')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  if (p.api==='1') return getDashboardData();
  // Tap-to-run from a phone browser (Sheets mobile app can't run Apps Script — see below)
  if (p.action==='debugConf') {
    var out=debugConfLookup_(p.conf||'');
    return ContentService.createTextOutput(JSON.stringify(out,null,2)).setMimeType(ContentService.MimeType.JSON);
  }
  if (p.action==='runMatchRoom') {
    var n=matchRoomFromSheet1();
    return HtmlService.createHtmlOutput(
      '<meta name="viewport" content="width=device-width">' +
      '<body style="font-family:sans-serif;padding:24px;font-size:18px">✅ matchRoomFromSheet1() เสร็จแล้ว — อัปเดต ' + n + ' แถว</body>'
    );
  }
  if (p.action==='fixNihel0704') {
    var msg = fixNihel0704Payout();
    return HtmlService.createHtmlOutput(
      '<meta name="viewport" content="width=device-width">' +
      '<body style="font-family:sans-serif;padding:24px;font-size:18px">✅ fixNihel0704Payout(): ' + msg + '</body>'
    );
  }
  if (p.action==='fixNicco0705') {
    var msg2 = fixNicco0705DuplicateRow();
    return HtmlService.createHtmlOutput(
      '<meta name="viewport" content="width=device-width">' +
      '<body style="font-family:sans-serif;padding:24px;font-size:18px">✅ fixNicco0705DuplicateRow(): ' + msg2 + '</body>'
    );
  }
  // Delegate BookingInvoiceTodo actions (getData, setBookingDone, setInvoiceDone, getAllDocs)
  if (p.action) {
    var out = handleRequest(p);
    return ContentService
      .createTextOutput(JSON.stringify(out))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return doGetOriginal(e);
}
function doGetOriginal(e){
  var ss=SpreadsheetApp.openById(MASTER_SHEET_ID);
  var sheet=ss.getSheetByName('Sheet1');
  var data=sheet.getDataRange().getValues();
  var bookings=[],ledger=[],summary={},mode='start';
  for (var i=0;i<data.length;i++){
    var row=data[i], c0=String(row[0]||'').trim();
    if (c0==='เลขห้อง'){mode='bookings';continue;}
    if (c0.indexOf('สรุปยอดรายรับ')>=0){mode='summary';continue;}
    if (c0==='วันที่ตรวจพบ'){mode='ledger';continue;}
    if (mode==='bookings'&&c0)
      bookings.push({room:c0,guest:String(row[1]||''),checkin:String(row[2]||''),
        checkout:String(row[3]||''),channel:String(row[4]||''),
        resId:String(row[5]||''),note:String(row[6]||'')});
    if (mode==='summary'&&c0&&row[1]){
      var val=String(row[1]).replace(/,/g,'').replace(/[^0-9.]/g,'');
      summary[c0]=parseFloat(val)||0;
    }
    if (mode==='ledger'){
      var bid=String(row[2]||'').trim(); if (!bid) continue;
      var isDup=false;
      for (var j=0;j<ledger.length;j++){ if(ledger[j].bookingId===bid){isDup=true;break;} }
      if (isDup) continue;
      ledger.push({date:String(row[0]||''),ota:String(row[1]||''),bookingId:bid,
        guest:String(row[4]||''),room:String(row[5]||''),
        checkin:String(row[6]||''),checkout:String(row[7]||''),
        nights:parseInt(row[8])||0,gross:parseFloat(String(row[9]).replace(/,/g,''))||0,
        commission:parseFloat(String(row[10]).replace(/,/g,''))||0,
        net:parseFloat(String(row[11]).replace(/,/g,''))||0,status:String(row[12]||'')});
    }
  }
  return ContentService.createTextOutput(JSON.stringify({bookings:bookings,ledger:ledger,summary:summary}))
    .setMimeType(ContentService.MimeType.JSON);
}
function getDashboardData(){
  var ss=SpreadsheetApp.openById(MASTER_SHEET_ID);
  var sheet1=ss.getSheetByName('Sheet1');
  var data1=sheet1.getDataRange().getValues();
  var bookings=[],mode='start';
  for (var i=0;i<data1.length;i++){
    var row=data1[i], c0=String(row[0]||'').trim();
    if (c0==='เลขห้อง'){mode='bookings';continue;}
    if (mode==='bookings'&&c0)
      bookings.push({room:c0,guest:String(row[1]||''),checkin:String(row[2]||''),
        checkout:String(row[3]||''),channel:String(row[4]||''),
        resId:String(row[5]||''),note:String(row[6]||'')});
  }
  var sheetL=ss.getSheetByName('Bank_Ledger');
  var dataL=sheetL.getDataRange().getValues();
  var ledger=[],seen={};
  for (var i=1;i<dataL.length;i++){
    var row=dataL[i], bid=String(row[2]||'').trim();
    if (!bid||seen[bid]) continue; seen[bid]=true;
    ledger.push({date:String(row[0]||''),ota:String(row[1]||''),bookingId:bid,
      guest:String(row[4]||''),room:String(row[5]||''),
      checkin:String(row[6]||''),checkout:String(row[7]||''),
      nights:parseInt(row[8])||0,gross:parseFloat(String(row[9]).replace(/,/g,''))||0,
      commission:parseFloat(String(row[10]).replace(/,/g,''))||0,
      net:parseFloat(String(row[11]).replace(/,/g,''))||0,status:String(row[12]||'')});
  }
  return ContentService.createTextOutput(JSON.stringify({bookings:bookings,ledger:ledger,summary:{}}))
    .setMimeType(ContentService.MimeType.JSON);
}
function getDashboardDataAsString(){ return getDashboardData().getContent(); }


// ═══════════════════════════════════════════════════════════════
// matchBookingComSCB — match SCB rows → Booking.com via BOOKING_COM_SCB_MAP
// รัน after matchSCBtoOTA (จะไม่ re-match rows ที่มี ✅ แล้ว)
// ═══════════════════════════════════════════════════════════════
function matchBookingComSCB(mapEntries) {
  var entries = mapEntries || BOOKING_COM_SCB_MAP;
  if (!entries.length) return;
  var ss = SpreadsheetApp.openById(MASTER_SHEET_ID);
  var sheet = ss.getSheetByName(TAB_NAME);
  if (!sheet) return;
  var last = sheet.getLastRow();
  if (last < 2) return;
  var data = sheet.getRange(2, 1, last-1, HEADERS.length).getValues();

  // index SCB rows by bid (exact) + by amount (fallback, สำหรับ fuzzy date match)
  var scbIndex = {};
  var scbByAmount = {};
  data.forEach(function(row, i) {
    var ota = (row[C.ota-1]||'').toString().trim();
    if (!ota.startsWith('SCB')) return;
    var bid = (row[C.bid-1]||'').toString().trim();
    var notes = (row[C.notes-1]||'').toString();
    var amt = fmtAmt(row[C.net-1]);
    var dt  = normalizeDate(row[C.date-1]);
    scbIndex[bid] = { rowIdx: i, notes: notes };
    (scbByAmount[amt] = scbByAmount[amt] || []).push({ bid: bid, date: dt, rowIdx: i, notes: notes });
  });

  // index Booking.com rows by bid
  // NOTE: rowIndex is tracked so that once a Booking.com row is consumed by a
  // successful SCB match, the ORIGINAL row can be retired too — otherwise it
  // sits forever with a stale "รอ Booking.com โอน" status even though the
  // payout was already reconciled on the SCB side (same root cause bug as
  // matchSCBtoOTA had for Airbnb/Trip.com/Expedia).
  var bkIndex = {};
  data.forEach(function(row, i) {
    var _bkOta=(row[C.ota-1]||'').toString().trim(); if (_bkOta!=='Booking.com'&&_bkOta!=='Booking') return;
    var bid = (row[C.bid-1]||'').toString().trim();
    bkIndex[bid] = {
      guest:  (row[C.guest-1]||'').toString().trim(),
      net:    fmtAmt(row[C.net-1]),
      ci:     row[C.ci-1],
      co:     row[C.co-1],
      nights: row[C.nights-1],
      room:   (row[C.room-1]||'').toString().trim(),
      rowIndex: i+2
    };
  });

  var matched = 0;
  entries.forEach(function(entry) {
    var scb = scbIndex[entry.scbId];
    if (!scb) {
      // Fallback: entry.scbId มักถูก auto-generate จากวันที่ใน Booking.com
      // Financial Report CSV (วัน Booking.com สั่งจ่าย) ซึ่งมักไม่ตรงกับวันที่
      // เงินเข้าบัญชี SCB จริง (bank clearing ใช้เวลา 2–7 วัน) ทำให้ exact bid
      // string ไม่ match กันเลยแม้ยอดจะตรงเป๊ะ — หา candidate ด้วยยอดเงิน
      // เดียวกัน ในช่วง ±7 วันจากวันที่ generate ไว้ แล้วเลือกอันที่วันใกล้สุด
      var m = /^SCB-(\d{4}-\d{2}-\d{2})-([\d.]+)$/.exec(entry.scbId);
      if (m) {
        var wantDate = m[1], wantAmt = fmtAmt(m[2]);
        var candidates = (scbByAmount[wantAmt] || []).filter(function(c) {
          if (c.notes.indexOf('✅') === 0) return false; // ตัดตัวที่ match ไปแล้ว
          var diff = Math.abs((new Date(c.date) - new Date(wantDate)) / 86400000);
          return diff <= 7;
        });
        if (candidates.length) {
          candidates.sort(function(a, b) {
            return Math.abs(new Date(a.date)-new Date(wantDate)) - Math.abs(new Date(b.date)-new Date(wantDate));
          });
          scb = { rowIdx: candidates[0].rowIdx, notes: candidates[0].notes };
          Logger.log('matchBookingComSCB: fuzzy-matched ' + entry.scbId + ' → SCB row date ' + candidates[0].date + ' (bid=' + candidates[0].bid + ')');
        }
      }
    }
    if (!scb) { Logger.log('matchBookingComSCB: SCB not found: ' + entry.scbId); return; }
    if (scb.notes.indexOf('✅') === 0) { Logger.log('matchBookingComSCB: already matched: ' + entry.scbId); return; }

    var scbRow  = data[scb.rowIdx];
    var scbAmt  = fmtAmt(scbRow[C.net-1]);
    var scbDate = dateStr(scbRow[C.date-1]);
    var scbOTA  = (scbRow[C.ota-1]||'').toString();
    var scbBid  = (scbRow[C.bid-1]||'').toString().trim();
    var acctM   = scb.notes.match(/x[\dX]+/);
    var scbAcct = acctM ? acctM[0] : 'x256221';

    var bids   = entry.bids;
    var guests = bids.map(function(b) { return bkIndex[b] ? bkIndex[b].guest : '?'; });
    // ใช้ nets จาก map ถ้าระบุ, ไม่งั้นใช้ net จาก sheet
    var nets   = entry.nets
      ? entry.nets.map(String)
      : bids.map(function(b) { return bkIndex[b] ? bkIndex[b].net : '0'; });

    var detailByBid = {};
    bids.forEach(function(b) { if (bkIndex[b]) detailByBid[b] = bkIndex[b]; });

    var insertRows = buildSCBRows(scbOTA, scbDate, scbBid, scbAmt, scbAcct,
      bids, guests, nets, {}, detailByBid, 'Booking.com remittance');

    // Combine the SCB row (delete+expand) with marking the original
    // Booking.com row(s) as settled — in place, not deleted — into one
    // descending-row-order pass, so row numbers never get invalidated
    // mid-run. The ✅ Matched SCB row still gets created for
    // rebuildBankLedger()/Dashboard; getInvoiceToCreate_() already skips
    // any row whose Conf. Code shows up on a 'Matched' row elsewhere, so
    // keeping both rows can't cause a duplicate invoice.
    var sr = scb.rowIdx + 2;
    var matchNote = 'โอนแล้ว | SCB Booking.com remittance ref ' + scbBid + ' | Value Date: ' + scbDate;
    var originalRows = bids
      .map(function(b) { return bkIndex[b] ? bkIndex[b].rowIndex : null; })
      .filter(function(r) { return r && r !== sr; });

    var seenRow = {};
    var ops = [{ row: sr, type: 'scb' }];
    seenRow[sr] = true;
    originalRows.forEach(function(r) {
      if (seenRow[r]) return;
      seenRow[r] = true;
      ops.push({ row: r, type: 'update' });
    });
    ops.sort(function(a, b) { return b.row - a.row; });

    ops.forEach(function(op) {
      if (op.type === 'update') {
        sheet.getRange(op.row, C.status).setValue('โอนแล้ว');
        var notesCell = sheet.getRange(op.row, C.notes);
        var existing = (notesCell.getValue() || '').toString();
        notesCell.setValue(existing ? (existing + ' | ' + matchNote) : matchNote);
        return;
      }
      sheet.deleteRow(op.row);
      insertRows.forEach(function(r, idx) {
        sheet.insertRowBefore(op.row + idx);
        sheet.getRange(op.row+idx, 1, 1, HEADERS.length).setValues([[
          r.date, r.ota, r.bookingId, r.confCode,
          r.guest, r.room, r.checkIn, r.checkOut, r.nights,
          r.total, r.commission, r.net, r.status, r.notes
        ]]);
        var bg = (r._isTotal || r._isSingle) ? SCB_TOTAL_BG : SCB_SUB_BG;
        sheet.getRange(op.row+idx, 1, 1, HEADERS.length).setBackground(bg);
        if (r._isTotal || r._isSingle) {
          sheet.getRange(op.row+idx, 1, 1, HEADERS.length).setFontWeight('bold');
        } else {
          sheet.getRange(op.row+idx, 1, 1, HEADERS.length)
            .setFontWeight('normal').setFontStyle('italic').setFontColor('#444444');
        }
        sheet.getRange(op.row+idx, 10, 1, 3).setNumberFormat('#,##0.00');
      });
    });
    matched++;
    Logger.log('matchBookingComSCB: matched ' + entry.scbId + ' → ' + bids.join(', ') + ' (marked โอนแล้ว on ' + originalRows.length + ' original row(s))');
  });
  Logger.log('matchBookingComSCB: ' + matched + ' SCB rows matched');
  if (matched > 0) SpreadsheetApp.getActiveSpreadsheet()
    .toast('Booking.com match: ' + matched + ' รายการ', 'Done', 4);
}

// ═══════════════════════════════════════════════════════════════
// BOOKING.COM FINANCIAL REPORT — CSV attachment parser
// อีเมล "Booking.com Monthly/Weekly Financial Report" (ส่งมาเป็นระยะ)
// มี CSV แนบ ("Payout_from_YYYY-MM-DD_until_YYYY-MM-DD.csv") ที่มีครบ:
// Gross amount / Commission / Payments Service Fee / VAT / Transaction amount
// (= net จริงต่อ reservation) และแถว "(Payout)" ที่บอก Payout amount+date+bank
// → แม่นกว่า parseLHEmail มาก (LH confirmation email ไม่มี fee/VAT เลย
//   ทำให้ net ที่คำนวณจาก total-commission เพี้ยนเสมอ)
// ═══════════════════════════════════════════════════════════════
function parseBookingComFinancialReport(msg) {
  var subj = msg.getSubject() || '';
  if (!/Financial Report/i.test(subj)) return { reservations: [], payouts: [] };

  var atts = msg.getAttachments();
  var csvAtt = null;
  for (var i = 0; i < atts.length; i++) {
    if (/^Payout_from.*\.csv$/i.test(atts[i].getName())) { csvAtt = atts[i]; break; }
  }
  if (!csvAtt) return { reservations: [], payouts: [] };

  var content = csvAtt.getDataAsString('UTF-8');
  var data = Utilities.parseCsv(content);
  if (!data || data.length < 2) return { reservations: [], payouts: [] };

  var header = data[0], col = {};
  header.forEach(function(h, i) { col[h.trim()] = i; });

  var reservations = [], payouts = [];
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    if (!row || row.length < 2) continue;
    var type = (row[col['Type/Transaction type']] || '').trim();
    var stmtDesc = (row[col['Statement Descriptor']] || '').trim();

    if (type === '(Payout)') {
      payouts.push({
        stmtDesc: stmtDesc,
        amount:   parseAmt(row[col['Payout amount']]),
        date:     (row[col['Payout date']] || '').trim(),
        bank:     (row[col['Bank account']] || '').trim()
      });
      continue;
    }
    if (type !== 'Reservation') continue;

    var net = parseAmt(row[col['Transaction amount']]);
    if (!net) continue; // ข้ามแถวที่ไม่มีผลกระทบทางการเงิน (เช่น cancel ที่ไม่มีค่าปรับ)

    reservations.push({
      stmtDesc:   stmtDesc,
      bid:        (row[col['Reference number']] || '').trim(),
      ci:         (row[col['Check-in date']]  || '').trim(),
      co:         (row[col['Check-out date']] || '').trim(),
      status:     (row[col['Reservation status']] || '').trim(),
      gross:      parseAmt(row[col['Gross amount']]),
      commission: parseAmt(row[col['Commission']]),
      fee:        parseAmt(row[col['Payments Service Fee']]),
      vat:        parseAmt(row[col['VAT']]),
      net:        net
    });
  }
  return { reservations: reservations, payouts: payouts };
}

// ═══════════════════════════════════════════════════════════════
// syncBookingComFinancialReports — entry point
// 1) หา email "Financial Report" ล่าสุด, parse CSV
// 2) แก้ net/commission ของ Booking.com rows ที่มีอยู่แล้วใน Payout_Income_Log
//    ให้ตรงกับตัวเลขจริงจาก Booking.com (แทนค่าที่ parseLHEmail คำนวณผิด)
// 3) auto-build entries (scbId + bids + nets ต่อ payout) แล้วส่งเข้า
//    matchBookingComSCB() เพื่อ match กับ SCB transfer โดยไม่ต้องเติม
//    BOOKING_COM_SCB_MAP ด้วยมืออีกต่อไป
// ═══════════════════════════════════════════════════════════════
function syncBookingComFinancialReports(sinceOverride) {
  var ss = SpreadsheetApp.openById(MASTER_SHEET_ID);
  var sheet = ss.getSheetByName(TAB_NAME);
  if (!sheet) return;

  // sinceOverride lets frequent/hourly callers (dailyEmailSync) scan a narrow
  // recent window instead of the full history that manual audits (quickReformat,
  // fullRebuild) still use via SEARCH_FROM. Booking.com reports can lag the stay
  // date by a couple weeks, so callers should pass a buffer, not just "yesterday".
  var threads = GmailApp.search(
    'from:noreply@booking.com subject:"Financial Report" after:' + (sinceOverride || SEARCH_FROM), 0, 50);

  var allReservations = [], allPayouts = [];
  threads.forEach(function(t) {
    t.getMessages().forEach(function(m) {
      try {
        var parsed = parseBookingComFinancialReport(m);
        allReservations = allReservations.concat(parsed.reservations);
        allPayouts = allPayouts.concat(parsed.payouts);
      } catch (e) { Logger.log('ERR syncBookingComFinancialReports parse: ' + e.message); }
    });
  });
  if (!allPayouts.length) { Logger.log('syncBookingComFinancialReports: ไม่พบ report ใหม่'); return; }

  // ── 1) แก้ net/commission ของ row ที่มีอยู่แล้วให้ตรงกับ CSV ──────
  var last = sheet.getLastRow();
  if (last >= 2) {
    var data = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
    var bidRowIdx = {};
    data.forEach(function(row, i) {
      var ota = (row[C.ota - 1] || '').toString().trim();
      if (ota !== 'Booking.com' && ota !== 'Booking') return;
      var bid = (row[C.bid - 1] || '').toString().trim();
      if (bid) bidRowIdx[bid] = i;
    });
    allReservations.forEach(function(res) {
      var idx = bidRowIdx[res.bid];
      if (idx === undefined) return; // ยังไม่มี prepaid row (parseLHEmail ยังไม่เจอ) ข้ามไปก่อน
      var sr = idx + 2;
      sheet.getRange(sr, C.total).setValue(res.gross);
      sheet.getRange(sr, C.comm).setValue(
        Math.round((Math.abs(res.commission) + Math.abs(res.fee)) * 100) / 100);
      sheet.getRange(sr, C.net).setValue(res.net);
      sheet.getRange(sr, C.notes).setValue(
        'via Booking.com Financial Report | Gross ฿' + res.gross +
        ' | Commission ฿' + res.commission + ' | Payments Fee ฿' + res.fee +
        ' | VAT ฿' + res.vat + ' | NET ฿' + res.net);
    });
  }

  // ── 2) group reservations ตาม stmtDesc → auto-build BOOKING_COM_SCB_MAP entries ──
  var byDesc = {};
  allReservations.forEach(function(res) {
    (byDesc[res.stmtDesc] = byDesc[res.stmtDesc] || []).push(res);
  });

  var autoEntries = [];
  allPayouts.forEach(function(p) {
    var group = byDesc[p.stmtDesc] || [];
    if (!group.length) return;
    autoEntries.push({
      scbId: 'SCB-' + p.date + '-' + fmtAmt(p.amount),
      bids:  group.map(function(g) { return g.bid; }),
      nets:  group.map(function(g) { return fmtAmt(g.net); })
    });
  });

  if (autoEntries.length) matchBookingComSCB(autoEntries);
  Logger.log('syncBookingComFinancialReports: ' + allReservations.length +
    ' reservations แก้ไข, ' + autoEntries.length + ' payout entries ส่ง match');
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
function makeRow(ota,date,bid,conf,guest,room,ci,co,nights,total,comm,net,status,notes){
  return{ota:ota,date:date,bookingId:bid,confCode:conf,
         guest:guest,room:room,checkIn:ci,checkOut:co,nights:nights,
         total:total,commission:comm,net:net,status:status,notes:notes,
         _isTotal:false,_isSingle:false};
}
function gRe(body,re){var m=re.exec(body);return m?m[1].trim():'';}
function fmtDate(d){return Utilities.formatDate(d,'Asia/Bangkok','yyyy-MM-dd');}
function parseAmt(s){return parseFloat((s||'0').toString().replace(/,/g,''))||0;}
function fmtAmt(s){return parseAmt(s).toFixed(2);}
function nightsBetween(d1,d2){
  if(!d1||!d2) return '';
  var n=Math.round((new Date(d2)-new Date(d1))/86400000);
  return n>0?n:'';
}
function slashToISO(s) {
  var p = s.split('/');
  if (p.length !== 3) return s;
  // Airbnb ส่งมาเป็น m/d/yyyy
  return p[2] + '-' + p[0].padStart(2,'0') + '-' + p[1].padStart(2,'0');
}
function lhDateToISO(s){
  var MO={Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',
          Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
  var p=s.split('-');
  return p.length===3?p[2]+'-'+(MO[p[1]]||'00')+'-'+p[0].padStart(2,'0'):s;
}
function tripDateToISO(s){
  var MO={January:'01',February:'02',March:'03',April:'04',May:'05',June:'06',
          July:'07',August:'08',September:'09',October:'10',November:'11',December:'12',
          Jan:'01',Feb:'02',Mar:'03',Apr:'04',Jun:'06',Jul:'07',Aug:'08',
          Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
  if (!s) return '';
  s=s.toString().replace(/,/g,'').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  var m1=s.match(/([A-Za-z]+)\s+(\d{1,2})\s+(\d{4})/);
  if (m1) return m1[3]+'-'+(MO[m1[1]]||'00')+'-'+m1[2].padStart(2,'0');
  var m2=s.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (m2) return m2[3]+'-'+(MO[m2[2]]||'00')+'-'+m2[1].padStart(2,'0');
  return '';
}
function thaiDateToISO(s){
  if (!s) return '';
  var THAI_MO={'ม.ค.':'01','ก.พ.':'02','มี.ค.':'03','เม.ย.':'04',
               'พ.ค.':'05','มิ.ย.':'06','ก.ค.':'07','ส.ค.':'08',
               'ก.ย.':'09','ต.ค.':'10','พ.ย.':'11','ธ.ค.':'12'};
  var m=s.match(/(\d{1,2})\s+([\u0E00-\u0E7F\.]+)\s+(\d{4})/);
  if (m){ var mo=THAI_MO[m[2]]; if (mo) return m[3]+'-'+mo+'-'+m[1].padStart(2,'0'); }
  return tripDateToISO(s);
}

function roomFromText(s){
  if (!s) return '?';
  s=s.toString().toLowerCase().trim();
  // ── ชื่อประเภทห้อง → เลขห้อง (ambiguous = ?) ──────────────────
  if (/retro/.test(s))    return '108';
  if (/luxury/.test(s))   return '300';
  // ห้องที่ชื่อเดียวมีหลายเลข → ต้อง fallback ให้ matchRoomFromSheet1 จัดการ
  // แต่ถ้า s มีเลขห้องด้วย เช่น "103 Elegance" → จับเลขก่อน
  // จับเลขห้องเฉพาะที่รู้จัก (whitelist) ป้องกัน false positive เช่น 967 จาก listing text
  var KNOWN_ROOMS = ['103','108','113','203','204','205','210','214','300','363'];
  // \b กันไม่ให้จับ "103" จากตัวเลข listing ID ยาวๆ เช่น (1036340279802824887)
  // ผิดพลาดเป็นเลขห้อง — ต้องเป็น token 3 หลักโดดๆ เท่านั้น
  var numFirst=s.match(/\b(\d{3})\b/);
  if (numFirst && KNOWN_ROOMS.indexOf(numFirst[1])>=0) return numFirst[1];
  // ชื่อประเภทที่ไม่มีเลข → คืน ? ให้ match ทีหลัง
  if (/elegance|legacy|allure|radiance|serene|greenery|rhythm|cosy|private apartment|mycondo/.test(s)) return '?';
  return '?';
}
function cleanRoom(r) {
  if (!r && r !== 0) return '?';
  return r.toString().replace(/\.0$/, '').trim() || '?';
}
function isValidRoom(r){
  if (!r) return false;
  var s=cleanRoom(r);
  if (!s||s==='?') return false;
  return /^\d[\d\/,\s]*$/.test(s);
}
function prevMonth(ym){
  var y=parseInt(ym.substring(0,4)),m=parseInt(ym.substring(5,7));
  m--; if(m<1){m=12;y--;} return y+'-'+(m<10?'0':'')+m;
}
function nextMonth(ym){
  var y=parseInt(ym.substring(0,4)),m=parseInt(ym.substring(5,7));
  m++; if(m>12){m=1;y++;} return y+'-'+(m<10?'0':'')+m;
}
// ═══════════════════════════════════════════════════════════════
// STYLE: Payout_Income_Log — reapply สีทุก row ตาม OTA + SCB logic
// เรียกหลัง sort ทุกครั้ง เพื่อแก้สีเพี้ยนหลัง rebuild/rematch
// ═══════════════════════════════════════════════════════════════
function stylePayoutLog() {
  var ss    = SpreadsheetApp.openById(MASTER_SHEET_ID);
  var sheet = ss.getSheetByName(TAB_NAME);
  if (!sheet) { Logger.log('stylePayoutLog: ไม่พบ tab'); return; }

  // ── Header row ────────────────────────────────────────────────
  sheet.getRange(1, 1, 1, HEADERS.length)
    .setBackground('#1a1a2e').setFontColor('#ffffff')
    .setFontWeight('bold').setFontSize(10)
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var data = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();

  // Identify SCB ref codes that have a "merged" row (multiple comma-separated Booking IDs).
  // The other rows sharing that same SCB ref but with a single Booking ID are split/sub-rows
  // and should be styled like the ↳ sub-rows, not as SCB total rows.
  var mergedRefs = {};
  data.forEach(function(row) {
    var ota = (row[C.ota-1] || '').toString().trim();
    var ref = (row[C.bid-1] || '').toString().trim();
    var conf = (row[C.conf-1] || '').toString().trim();
    if (ota.startsWith('SCB') && conf.indexOf(',') >= 0 && ref) {
      mergedRefs[ref] = true;
    }
  });
  function isSplitSubRow(row) {
    var ota = (row[C.ota-1] || '').toString().trim();
    var ref = (row[C.bid-1] || '').toString().trim();
    var conf = (row[C.conf-1] || '').toString().trim();
    return ota.startsWith('SCB') && conf.indexOf(',') < 0 && mergedRefs[ref];
  }

  // Build background array row-by-row
  var bgs = [];
  data.forEach(function(row) {
    var ota    = (row[C.ota-1]    || '').toString().trim();
    var status = (row[C.status-1] || '').toString().trim();
    var notes  = (row[C.notes-1]  || '').toString().trim();

    var rowBg;
    // Resolution rows
    if (status.indexOf('Resolution') >= 0) {
      rowBg = RES_BG;
    }
    // SCB sub-rows (↳ prefix in notes, or split row of a merged SCB batch)
    else if (notes.startsWith('↳') || isSplitSubRow(row)) {
      rowBg = SCB_SUB_BG;
    }
    // SCB total / single rows
    else if (ota.startsWith('SCB')) {
      rowBg = SCB_TOTAL_BG;
    }
    // OTA rows
    else {
      var k = Object.keys(OTA_BG).find(function(k) { return ota.includes(k); });
      rowBg = k ? OTA_BG[k] : '#ffffff';
    }

    // All 14 columns same background
    bgs.push(new Array(HEADERS.length).fill(rowBg));
  });

  sheet.getRange(2, 1, lastRow - 1, HEADERS.length).setBackgrounds(bgs);

  // ── Font overrides — batch arrays to avoid per-row API calls ──
  var fWeights = [], fStyles = [], fColors = [];
  data.forEach(function(row) {
    var ota   = (row[C.ota-1]   || '').toString().trim();
    var notes = (row[C.notes-1] || '').toString().trim();
    var fw, fs, fc;
    if (notes.startsWith('↳') || isSplitSubRow(row)) {
      fw = 'normal'; fs = 'italic'; fc = '#444444';
    } else if (ota.startsWith('SCB')) {
      fw = 'bold';   fs = 'normal'; fc = '#000000';
    } else {
      fw = 'normal'; fs = 'normal'; fc = '#000000';
    }
    var emptyRow = new Array(HEADERS.length);
    fWeights.push(emptyRow.fill(fw));
    fStyles.push(emptyRow.fill(fs));
    fColors.push(emptyRow.fill(fc));
  });
  var dataRng = sheet.getRange(2, 1, lastRow - 1, HEADERS.length);
  dataRng.setFontWeights(fWeights);
  dataRng.setFontStyles(fStyles);
  dataRng.setFontColors(fColors);

  // Number format for amount columns
  sheet.getRange(2, 10, lastRow - 1, 3).setNumberFormat('#,##0.00');

  Logger.log('stylePayoutLog: ' + (lastRow - 1) + ' rows styled');
}

function setupSheet(){
  var ss=SpreadsheetApp.openById(MASTER_SHEET_ID);
  var sheet=ss.getSheetByName(TAB_NAME);
  if (!sheet) sheet=ss.insertSheet(TAB_NAME);
  var hRange=sheet.getRange(1,1,1,HEADERS.length);
  hRange.setValues([HEADERS]);
  hRange.setBackground('#1a1a2e').setFontColor('#ffffff')
        .setFontWeight('bold').setFontSize(10)
        .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  sheet.setFrozenRows(1);
  sheet.showColumns(1, HEADERS.length);  // unhide all columns
  [110,110,180,140,200,80,105,105,55,110,115,110,200,300]
    .forEach(function(w,i){sheet.setColumnWidth(i+1,w);});
  // Force date columns to ISO format for all existing + future rows
  var maxRow = Math.max(sheet.getLastRow(), 2);
  [C.date, C.ci, C.co].forEach(function(col){
    sheet.getRange(2, col, maxRow, 1).setNumberFormat('yyyy-mm-dd');
  });
  return sheet;
}
function clearDataRows(sheet){
  var last=sheet.getLastRow();
  if (last>1) sheet.getRange(2,1,last-1,HEADERS.length).clearContent().clearFormat();
}
function getExistingIds(sheet){
  var last=sheet.getLastRow();
  if (last<2) return new Map();
  var vals=sheet.getRange(2,3,last-1,2).getValues(); // col C=bookingId, col D=confCode (unused here)
  // col L (net) = column 12, offset from col C = col 3 → need cols C and L
  // re-fetch with correct columns: C=3, L=12 → getRange(2,3,last-1,10) gives C..L
  var bidCol=sheet.getRange(2,3,last-1,1).getValues().flat();
  var netCol=sheet.getRange(2,12,last-1,1).getValues().flat();
  var map=new Map();
  for(var i=0;i<bidCol.length;i++){
    var b=bidCol[i]; if(!b) continue;
    b=String(b);
    if(!map.has(b)) map.set(b, Number(netCol[i])||0);
  }
  return map;
}
// helper: ถ้า Airbnb bookingId ชน + net ต่างกัน → auto-suffix เพื่อไม่ต้อง whitelist
function resolveAirbnbBid(bid, net, existing){
  if(!existing.has(bid)) return bid;            // ไม่ชน → ใช้ bid เดิม
  var existingNet=existing.get(bid);
  if(Math.abs(existingNet - net)<0.02) return null; // ชน + net เหมือน → dup จริง → skip
  // ชน + net ต่าง → extension/split payout → สร้าง suffix ใหม่
  var suffix='-EXT-'+(net*100).toFixed(0);
  var newBid=bid+suffix;
  // ถ้า newBid มีอยู่แล้ว และ net เหมือน → dup ของ split นี้ → skip
  if(existing.has(newBid)&&Math.abs(existing.get(newBid)-net)<0.02) return null;
  // กัน loop ถ้ามีซ้ำกันอีก (net ต่างกันจริงๆ)
  var attempt=0;
  while(existing.has(newBid)&&attempt<10){
    attempt++; newBid=bid+suffix+'-'+attempt;
  }
  return newBid;
}
function appendRow(sheet,row){
  var r=sheet.getLastRow()+1;
  var roomVal = (row.room||'').toString().replace(/\.0$/, '').trim();
  sheet.getRange(r,1,1,HEADERS.length).setValues([[
    row.date,row.ota,row.bookingId,row.confCode,
    row.guest,roomVal,row.checkIn,row.checkOut,row.nights,
    row.total,row.commission,row.net,row.status,row.notes
  ]]);
  sheet.getRange(r,C.date).setNumberFormat('yyyy-mm-dd');
  sheet.getRange(r,C.ci).setNumberFormat('yyyy-mm-dd');
  sheet.getRange(r,C.co).setNumberFormat('yyyy-mm-dd');
  sheet.getRange(r,C.bid).setNumberFormat('@');
  sheet.getRange(r,C.conf).setNumberFormat('@');
  var bg;
  if ((row.status||'').indexOf('Resolution')>=0) {
    bg=RES_BG;
  } else {
    var k=Object.keys(OTA_BG).find(function(k){return(row.ota||'').includes(k);});
    bg=k?OTA_BG[k]:null;
  }
  if (bg) sheet.getRange(r,1,1,HEADERS.length).setBackground(bg);
  sheet.getRange(r,10,1,3).setNumberFormat('#,##0.00');
}
function stripHTML(html){
  return html
    .replace(/<\/?(tr|td|th|div|p|br|li|h[1-6])[^>]*>/gi,'\n')
    .replace(/<[^>]+>/g,'')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&nbsp;/g,' ').replace(/&#x27;/g,"'")
    .replace(/[^\S\n]+/g,' ').replace(/\n{3,}/g,'\n\n');
}

// ═══════════════════════════════════════════════════════════════
// DEBUG HELPERS
// ═══════════════════════════════════════════════════════════════
function debugSCBQuery(){
  var threads=GmailApp.search('from:No_reply_scbbusinessalert@scb.co.th after:2026/05/01',0,10);
  Logger.log('พบ threads: '+threads.length);
  threads.forEach(function(t){
    t.getMessages().forEach(function(m){
      Logger.log('Subject: '+m.getSubject()+' | Date: '+m.getDate());
      Logger.log('Body(300): '+stripHTML(m.getBody()).substring(0,300));
    });
  });
}
function debugTripQuery(){
  var queries=['from:noreply_htl@trip.com after:2026/01/01',
               'subject:"ยืนยันหมายเลขการจอง" after:2026/01/01'];
  queries.forEach(function(q){
    var t=GmailApp.search(q,0,10);
    Logger.log('"'+q+'" → '+t.length+' threads');
    t.slice(0,2).forEach(function(thread){
      thread.getMessages().forEach(function(m){
        Logger.log('  '+m.getSubject()+' | '+m.getFrom());
      });
    });
  });
}
function listSheets(){
  var ss=SpreadsheetApp.openById(MASTER_SHEET_ID);
  ss.getSheets().forEach(function(sh,i){
    Logger.log('Sheet '+i+': ['+sh.getName()+'] rows='+sh.getLastRow());
  });
}
function testBankLedger(){
  var ss=SpreadsheetApp.openById(MASTER_SHEET_ID);
  var sheet=ss.getSheetByName('Bank_Ledger');
  var data=sheet.getDataRange().getValues();
  for (var i=0;i<Math.min(3,data.length);i++)
    Logger.log('ROW '+i+': '+JSON.stringify(data[i]));
}
function debugExpediaMatch(){
  var ss=SpreadsheetApp.openById(MASTER_SHEET_ID);
  var sheet=ss.getSheetByName(TAB_NAME);
  var data=sheet.getDataRange().getValues();
  var hdr=data[0].map(function(h){return h.toString().trim();});
  var iOTA=hdr.indexOf('OTA'), iNet=hdr.indexOf('NET (THB)');
  var iDate=hdr.indexOf('วันที่ตรวจพบ');
  Logger.log('=== Expedia rows ===');
  for (var i=1;i<data.length;i++){
    if ((data[i][iOTA]||'').toString().trim()!=='Expedia') continue;
    Logger.log('row '+(i+1)+' | net='+data[i][iNet]+' | date='+data[i][iDate]);
  }
}
function debugUnresolvedRooms(){
  var ss=SpreadsheetApp.openById(MASTER_SHEET_ID);
  var sheet=ss.getSheetByName(TAB_NAME);
  if (!sheet) return;
  var last=sheet.getLastRow(); if (last<2) return;
  var data=sheet.getRange(2,1,last-1,HEADERS.length).getValues();
  var count=0;
  data.forEach(function(row,i){
    var room=(row[C.room-1]||'').toString().trim();
    if (room==='?'||!isValidRoom(room)) {
      Logger.log('ROW '+(i+2)+' | '+
        (row[C.ota-1]||'')+'  | guest: '+(row[C.guest-1]||'')+
        ' | bid: '+(row[C.bid-1]||'')+
        ' | ci: '+(row[C.ci-1]||''));
      count++;
    }
  });
  Logger.log('Total unresolved rooms: '+count);
}



// ═══════════════════════════════════════════════════════════════
// OVERRIDE: syncSCBTotalRooms — skip total rows whose bid is in MANUAL_ROOM_FIXES
function applyManualRoomFixes() {
  var ss = SpreadsheetApp.openById(MASTER_SHEET_ID);
  var paySheet = ss.getSheetByName(TAB_NAME);
  if (!paySheet) return;
  var last = paySheet.getLastRow();
  if (last < 2) return;

  var data = paySheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
  var pH = paySheet.getRange(1, 1, 1, HEADERS.length).getValues()[0]
           .map(function(h) { return h.toString().trim(); });
  var pBid   = pH.indexOf('Booking ID');
  var pConf  = pH.indexOf('Conf. Code');
  var pRoom  = pH.indexOf('ห้อง') >= 0 ? pH.indexOf('ห้อง') : pH.indexOf('เลขห้อง');
  var pNotes = pH.indexOf('หมายเหตุ');
  var pOTA   = pH.indexOf('OTA');
  var pGuest = pH.indexOf('ชื่อแขก');

  // bid+conf room lookup built from the curated single-guest entries in
  // MANUAL_ROOM_FIXES (these map one specific conf code to one verified
  // room and are not order-dependent). Used below to auto-derive a total
  // row's multi-room string from its หมายเหตุ field's guest(conf) order —
  // which is written once at row-creation time and never reshuffled,
  // unlike the room column itself — instead of trusting a separately
  // hand-typed comma-joined room string that can silently fall out of
  // sync with the guest order.
  var confRoomMap = {};
  MANUAL_ROOM_FIXES.forEach(function(fx) {
    if (fx.bid && fx.conf && fx.conf.indexOf(',') < 0 && fx.room && fx.room.indexOf(',') < 0) {
      confRoomMap[fx.bid + '|' + fx.conf] = fx.room;
    }
  });

  function deriveTotalRoomFromNotes(bidVal, notesText) {
    var confs = [];
    var re = /\(([^)]+)\)/g, m;
    while ((m = re.exec(notesText))) confs.push(m[1].trim());
    if (confs.length < 2) return null;
    var rooms = [];
    for (var k = 0; k < confs.length; k++) {
      var r = confRoomMap[bidVal + '|' + confs[k]];
      if (!r) return null; // missing a mapping → don't guess, fall back to old logic
      if (rooms.indexOf(r) < 0) rooms.push(r);
    }
    return rooms.join(', ');
  }

  var fixed = 0;

  for (var i = 0; i < data.length; i++) {
    var notesVal = (data[i][pNotes] || '').toString().trim();
    var otaVal   = (data[i][pOTA]   || '').toString().trim();
    if (otaVal.startsWith('SCB') && notesVal.startsWith('\u21b3')) continue;  // skip sub-rows

    var curRoom = (data[i][pRoom] || '').toString().trim();
    var bid   = (data[i][pBid]   || '').toString().trim();
    var conf  = (data[i][pConf]  || '').toString().trim();
    var guest = (data[i][pGuest] || '').toString().trim();

    // total row (multi-conf): derive room order from หมายเหตุ first —
    // this is immune to row-sort-order bugs and hand-typed-string typos.
    if (conf.indexOf(',') >= 0) {
      var derived = deriveTotalRoomFromNotes(bid, notesVal);
      if (derived && derived !== curRoom) {
        paySheet.getRange(i + 2, pRoom + 1).setValue(derived);
        data[i][pRoom] = derived;
        fixed++;
        Logger.log('applyManualRoomFixes: row '+(i+2)+' bid="'+bid+'" [from หมายเหตุ] '+curRoom+' → '+derived);
        continue;
      }
      if (derived) continue; // already correct, skip fix-list loop below
      // derivation failed (some conf missing from confRoomMap) → fall through to old fix-list logic
    }

    for (var fi = 0; fi < MANUAL_ROOM_FIXES.length; fi++) {
      var fix = MANUAL_ROOM_FIXES[fi];
      var matched = false;
      // bid+conf: ใช้ fix ที่ระบุทั้ง bid และ conf → match เฉพาะ row นั้น (sub-row specific)
      // ห้ามแตะ total row (conf ที่มีหลาย values คั่น comma) ด้วยกฎนี้ เว้นแต่ fix.conf
      // จะเป็น string เดียวกับ conf เต็มของ total row พอดี (i.e. ตั้งใจ fix total row จริงๆ)
      if (!matched && fix.bid && fix.conf && bid === fix.bid) {
        var curConfList = conf.split(',').map(function(s){return s.trim();});
        var curIsTotalRow = curConfList.length > 1;
        if (curIsTotalRow) {
          if (conf === fix.conf) matched = true;
        } else if (conf === fix.conf || curConfList.indexOf(fix.conf) >= 0) {
          matched = true;
        }
      }
      // conf-only หรือ bid-only หรือ guest-only
      if (!matched && !fix.conf && fix.bid && bid && bid === fix.bid) {
        // bid-only fix → ใช้กับ total row เท่านั้น (sub-rows มี conf เดี่ยว ไม่ใช่ comma list)
        var isSubRow = otaVal.startsWith('SCB') && conf && conf.indexOf(',') < 0 && bid === fix.bid && !notesVal.startsWith('\u2705 Matched');
        if (!isSubRow) matched = true;
      }
      if (!matched && fix.conf && !fix.bid && conf) {
        var confList = conf.split(',').map(function(s){return s.trim();});
        // conf-only fix: ห้ามแตะ total row (conf ที่มีหลาย values = total row)
        var isTotalRow = confList.length > 1;
        if (!isTotalRow && (conf === fix.conf || confList.indexOf(fix.conf) >= 0)) matched = true;
      }
      if (!matched && fix.guest && guest && guest.toLowerCase() === fix.guest.toLowerCase()) matched = true;
      if (!matched) continue;

      var isMultiFix = fix.room.indexOf(',') >= 0;
      var isMultiCur = curRoom.indexOf(',') >= 0;

      // skip only if: current room is valid single AND fix is also single AND room is a known valid room
      // always overwrite if: room is '?' / invalid, OR fix is multi, OR current is wrong multi, OR room not in known list
      var KNOWN_ROOMS = ['103','108','113','203','204','205','210','214','300','363'];
      var curRoomKnown = KNOWN_ROOMS.indexOf(curRoom) >= 0;
      if (isValidRoom(curRoom) && curRoomKnown && !isMultiFix && !isMultiCur) continue;

      if (curRoom === fix.room) break; // already correct, no write needed
      paySheet.getRange(i + 2, pRoom + 1).setValue(fix.room);
      data[i][pRoom] = fix.room;
      fixed++;
      Logger.log('applyManualRoomFixes: row '+(i+2)+' bid="'+bid+'" conf="'+conf+'" '+curRoom+' → '+fix.room);
      break;
    }
  }
  Logger.log('applyManualRoomFixes: ' + fixed + ' rows fixed');
}

// ═══════════════════════════════════════════════════════════════
// ONE-TIME FIX: normalize "Booking.com" → "Booking" in Sheet1 col E
function fixBookingComChannel() {
  var ss = SpreadsheetApp.openById(MASTER_SHEET_ID);
  var sh = ss.getSheetByName('Sheet1');
  if (!sh) return;
  var data = sh.getDataRange().getValues();
  var fixed = 0;
  for (var i = 1; i < data.length; i++) {
    if ((data[i][4]||'').toString().trim() === 'Booking.com') {
      sh.getRange(i+1, 5).setValue('Booking');
      fixed++;
    }
  }
  styleSheet1();
  Logger.log('fixBookingComChannel: fixed ' + fixed + ' rows');
}

// OVERRIDE: styleSheet1 — fix room color match (number→type) + รอยืนยัน
// ═══════════════════════════════════════════════════════════════
function styleSheet1(){
  var ss=SpreadsheetApp.openById(MASTER_SHEET_ID);
  var sh=ss.getSheetByName('Sheet1');
  if (!sh){ Logger.log('ไม่พบ Sheet1'); return; }

  var lastRow, lastCol=8;

  // ── Step 1: Deduplicate "รอยืนยัน" rows ที่ conf ซ้ำกับ row ที่มีห้องจริงแล้ว ──
  lastRow=sh.getLastRow();
  if (lastRow>1){
    var dupData=sh.getRange(2,1,lastRow-1,lastCol).getValues();
    var realConfs={};
    dupData.forEach(function(row){
      var room=String(row[0]||'').trim();
      var resId=String(row[5]||'').trim();
      if(room && room!=='รอยืนยัน'){
        realConfs[resId.replace(/-\d{8}$/,'')]=true;
      }
    });
    var toDelete=[];
    dupData.forEach(function(row,i){
      if(String(row[0]||'').trim()==='รอยืนยัน'){
        var base=String(row[5]||'').trim().replace(/-\d{8}$/,'');
        if(realConfs[base]) toDelete.push(i+2);
      }
    });
    toDelete.sort(function(a,b){return b-a;});
    toDelete.forEach(function(r){sh.deleteRow(r);});
  }

  // ── Step 2: Normalize date columns C(เช็คอิน), D(เช็คเอาท์), H(วันจอง) → YYYY-MM-DD ──
  lastRow=sh.getLastRow();
  if (lastRow>1){
    // Force all 3 date columns to text format so GAS won't re-interpret strings as dates
    sh.getRange(2,3,lastRow-1,1).setNumberFormat('@STRING@');
    sh.getRange(2,4,lastRow-1,1).setNumberFormat('@STRING@');
    sh.getRange(2,8,lastRow-1,1).setNumberFormat('@STRING@');
    var allData=sh.getRange(2,1,lastRow-1,lastCol).getValues();
    var changed=false;
    allData.forEach(function(row){
      // date column indices: 2=เช็คอิน, 3=เช็คเอาท์, 7=วันจอง
      [2,3,7].forEach(function(ci){
        var cur=row[ci];
        var normalized=normalizeSheetDate_(cur);
        if(normalized && normalized!==String(cur||'').trim()){
          row[ci]=normalized;
          changed=true;
        }
      });
    });
    if(changed) sh.getRange(2,1,lastRow-1,lastCol).setValues(allData);
  }

  // ── Step 3: Sort by col H (วันจอง) ascending ──
  lastRow=sh.getLastRow();
  if (lastRow>2){
    var dr=sh.getRange(2,1,lastRow-1,lastCol);
    var srows=dr.getValues();
    srows.sort(function(a,b){
      function norm(v){
        if(!v) return '9999-12-31';
        if(v instanceof Date) return Utilities.formatDate(v,'GMT+7','yyyy-MM-dd');
        var s=String(v);
        return s.indexOf('T')>-1 ? Utilities.formatDate(new Date(s),'GMT+7','yyyy-MM-dd') : s.substring(0,10);
      }
      var da=norm(a[7]),db=norm(b[7]);
      return da<db?-1:da>db?1:0;
    });
    dr.setValues(srows);
  }

  // ── Step 4: Apply formatting — อ่านข้อมูลใหม่หลัง sort เสร็จแล้ว ──
  lastRow=sh.getLastRow();
  sh.clearFormats();
  if(lastRow<1) return;

  // column widths + header
  sh.setColumnWidth(1,160);sh.setColumnWidth(2,180);sh.setColumnWidth(3,110);
  sh.setColumnWidth(4,110);sh.setColumnWidth(5,100);sh.setColumnWidth(6,220);
  sh.setColumnWidth(7,200);sh.setColumnWidth(8,110);
  sh.getRange(1,1,1,lastCol)
    .setBackground('#1a1a2e').setFontColor('#ffffff').setFontWeight('bold')
    .setFontSize(11).setHorizontalAlignment('center').setVerticalAlignment('middle');
  sh.getRange(1,1,1,lastCol).setValues([['เลขห้อง','ชื่อแขก','เช็คอิน','เช็คเอาท์','Channel','ResId','Note','วันจอง']]);
  sh.setRowHeight(1,36);
  sh.setFrozenRows(1);

  var ROOM_TYPE_MAP={
    '103':'elegance','108':'retro','113':'legacy',
    '203':'allure','204':'elegance','205':'allure',
    '209':'radiance','210':'radiance','214':'legacy','300':'luxury','363':'mycondo'
  };
  var ROOM_COLORS={
    'luxury'  :{bg:'#fff3cd',font:'#856404'},
    'retro'   :{bg:'#d1ecf1',font:'#0c5460'},
    'elegance':{bg:'#d4edda',font:'#155724'},
    'allure'  :{bg:'#e2d9f3',font:'#4a235a'},
    'legacy'  :{bg:'#fde8d8',font:'#7d3c0a'},
    'radiance':{bg:'#d0f0fc',font:'#0a4d6e'},
    'mycondo' :{bg:'#e8e0d4',font:'#5a4a32'},
    'cancel'  :{bg:'#f8d7da',font:'#721c24'},
    'ยกเลิก'  :{bg:'#f8d7da',font:'#721c24'},
    'no show' :{bg:'#ffeeba',font:'#856404'},
    'รอยืนยัน':{bg:'#e2e3e5',font:'#383d41'}
  };
  var CHANNEL_COLORS={
    'airbnb'  :{bg:'#ff5a5f',font:'#ffffff'},
    'booking' :{bg:'#003580',font:'#ffffff'},
    'expedia' :{bg:'#ffc72c',font:'#333333'},
    'trip'    :{bg:'#00aaff',font:'#ffffff'},
    'direct'  :{bg:'#28a745',font:'#ffffff'},
    'dbk'     :{bg:'#28a745',font:'#ffffff'},
    'extranet':{bg:'#6c5ce7',font:'#ffffff'}
  };

  // อ่านข้อมูลทั้งหมดหลัง sort — single read สำหรับ styling
  if(lastRow<2) return;
  var styleData=sh.getRange(2,1,lastRow-1,lastCol).getValues();

  styleData.forEach(function(row,i){
    var r=i+2;
    var cv=String(row[0]||'').trim();
    var cvL=cv.toLowerCase();
    var ch=String(row[4]||'').trim();
    var note=String(row[6]||'').trim();
    var fullRow=sh.getRange(r,1,1,lastCol);

    // base row
    fullRow.setBackground(r%2===0?'#f8f9fa':'#ffffff')
           .setFontColor('#333333').setFontSize(10).setVerticalAlignment('middle');
    sh.setRowHeight(r,26);

    // สถานะพิเศษ
    if(cvL.indexOf('cancel')>=0||cvL.indexOf('ยกเลิก')>=0){
      fullRow.setBackground(ROOM_COLORS['cancel'].bg).setFontColor(ROOM_COLORS['cancel'].font);
    } else if(cvL.indexOf('no show')>=0){
      fullRow.setBackground(ROOM_COLORS['no show'].bg).setFontColor(ROOM_COLORS['no show'].font);
      sh.getRange(r,1).setFontWeight('bold');
    } else if(cv==='รอยืนยัน'){
      fullRow.setBackground(ROOM_COLORS['รอยืนยัน'].bg).setFontColor(ROOM_COLORS['รอยืนยัน'].font);
      sh.getRange(r,1).setFontStyle('italic');
    } else {
      // สีตามเลขห้อง (col A)
      var roomNum=cv.split(/\s+/)[0];
      var typeName=ROOM_TYPE_MAP[roomNum];
      if(typeName && ROOM_COLORS[typeName]){
        sh.getRange(r,1,1,2)
          .setBackground(ROOM_COLORS[typeName].bg)
          .setFontColor(ROOM_COLORS[typeName].font)
          .setFontWeight('bold');
      }
    }

    // สีตาม Channel (col E) — apply ทุก row ยกเว้น cancel/รอยืนยัน ก็โอเค
    var chL=ch.toLowerCase();
    var chColor=null;
    Object.keys(CHANNEL_COLORS).forEach(function(k){
      if(chL.indexOf(k)>=0) chColor=CHANNEL_COLORS[k];
    });
    if(chColor){
      sh.getRange(r,5).setBackground(chColor.bg).setFontColor(chColor.font)
        .setFontWeight('bold').setHorizontalAlignment('center');
    }

    // Note highlight
    if(note) sh.getRange(r,7).setBackground('#fff8e1').setFontColor('#5d4037').setFontStyle('italic');
  });

  // col H วันจอง — center + small gray
  sh.getRange(2,8,lastRow-1,1).setHorizontalAlignment('center').setFontColor('#666666').setFontSize(9);
  // col C-D center
  sh.getRange(2,3,lastRow-1,2).setHorizontalAlignment('center');
  // borders
  sh.getRange(1,1,lastRow,lastCol).setBorder(true,true,true,true,false,false,'#cccccc',SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange(2,1,lastRow-1,lastCol).setBorder(false,false,false,false,false,true,'#e0e0e0',SpreadsheetApp.BorderStyle.SOLID);

  SpreadsheetApp.flush();
  Logger.log('styleSheet1: เสร็จแล้ว rows='+(lastRow-1));
}

// ═══════════════════════════════════════════════════════════════
// OVERRIDE v2: syncSCBTotalRooms — skip by bid OR conf
// ═══════════════════════════════════════════════════════════════
function syncSCBTotalRooms() {
  var ss = SpreadsheetApp.openById(MASTER_SHEET_ID);
  var sheet = ss.getSheetByName(TAB_NAME);
  if (!sheet) return;
  var last = sheet.getLastRow();
  if (last < 2) return;
  var data = sheet.getRange(2, 1, last-1, HEADERS.length).getValues();
  var pOTA   = C.ota-1;
  var pRoom  = C.room-1;
  var pNotes = C.notes-1;
  var pBid   = C.bid-1;
  var pConf  = C.conf-1;
  var fixed  = 0;

  // build lookup: bid and conf → room
  var manualBids  = {};
  var manualConfs = {};
  MANUAL_ROOM_FIXES.forEach(function(fx) {
    if (fx.bid)  manualBids[fx.bid]   = fx.room;
    if (fx.conf) manualConfs[fx.conf] = fx.room;
  });

  var i = 0;
  while (i < data.length) {
    var ota   = (data[i][pOTA]   || '').toString().trim();
    var notes = (data[i][pNotes] || '').toString().trim();
    if (ota.startsWith('SCB') && !notes.startsWith('\u21b3')) {
      var bid  = (data[i][pBid]  || '').toString().trim();
      var conf = (data[i][pConf] || '').toString().trim();

      // skip if bid OR conf is pinned in MANUAL_ROOM_FIXES
      if (manualBids[bid] !== undefined || manualConfs[conf] !== undefined) {
        Logger.log('syncSCBTotalRooms: skip manual-fixed bid=' + bid + ' conf=' + conf);
        var j = i + 1;
        while (j < data.length) {
          var sn = (data[j][pNotes] || '').toString().trim();
          var so = (data[j][pOTA]   || '').toString().trim();
          if (!so.startsWith('SCB') || !sn.startsWith('\u21b3')) break;
          j++;
        }
        i = j;
        continue;
      }

      // collect rooms from sub-rows ONLY, keyed by guest name so we can
      // re-align them to the total row's guest order below (sub-rows can
      // get physically reordered by sortPayoutByOTA, independent of the
      // guest order baked into the total row's "ชื่อแขก"/note columns —
      // joining by scan order alone causes guest[i] ↔ room[i] mismatches).
      var rooms = [];
      var roomByGuest = {};
      var totalNet = parseFloat((data[i][C.net-1]||'0').toString().replace(/,/g,''))||0;
      var totalRoom = (data[i][pRoom] || '').toString().trim();
      var totalGuestField = (data[i][C.guest-1] || '').toString().trim();
      var j = i + 1;
      while (j < data.length) {
        var subNotes = (data[j][pNotes] || '').toString().trim();
        var subOTA   = (data[j][pOTA]   || '').toString().trim();
        var subNet   = parseFloat((data[j][C.net-1]||'0').toString().replace(/,/g,''))||0;
        // sub-row: same SCB OTA, same bid, net < total, starts with ↳ OR ✅ (old format)
        if (!subOTA.startsWith('SCB')) break;
        var subBid = (data[j][pBid]||'').toString().trim();
        if (subBid !== bid) break;
        var isSubRow = subNotes.startsWith('\u21b3') || 
                       (subNotes.startsWith('\u2705') && subNet < totalNet - 0.01);
        if (!isSubRow) break;
        var subRoom = (data[j][pRoom] || '').toString().trim();
        if (subRoom && subRoom !== '?' && !subRoom.includes(',') && rooms.indexOf(subRoom) < 0) rooms.push(subRoom);
        var subGuest = (data[j][C.guest-1] || '').toString().trim();
        if (subGuest && subRoom && subRoom !== '?' && !(subGuest in roomByGuest)) roomByGuest[subGuest] = subRoom;
        j++;
      }
      var hadSubRows = (j > i + 1);
      if (hadSubRows && rooms.length > 1) {
        // re-derive room order from the total row's existing guest order
        // (falls back to scan order for any guest we couldn't match)
        var guestOrder = totalGuestField ? totalGuestField.split(',').map(function(g){ return g.trim(); }) : [];
        var orderedRooms = [];
        guestOrder.forEach(function(g) {
          var r = roomByGuest[g];
          if (r && orderedRooms.indexOf(r) < 0) orderedRooms.push(r);
        });
        // append any rooms we couldn't align via guest name (safety net)
        rooms.forEach(function(r) { if (orderedRooms.indexOf(r) < 0) orderedRooms.push(r); });
        var merged = orderedRooms.length === rooms.length ? orderedRooms.join(', ') : rooms.join(', ');
        if (merged !== totalRoom) {
          sheet.getRange(i+2, pRoom+1).setValue(merged);
          data[i][pRoom] = merged;
          fixed++;
          Logger.log('syncSCBTotalRooms: row '+(i+2)+' → '+merged);
        }
      }
      i = j;
    } else {
      i++;
    }
  }
  Logger.log('syncSCBTotalRooms: '+fixed+' rows updated');
}

// ═══════════════════════════════════════════════════════════════
// OVERRIDE: matchSCBtoOTA — match Airbnb by net sum (not gross total)
// ═══════════════════════════════════════════════════════════════
function normalizeDate(v) {
  if (v instanceof Date) return Utilities.formatDate(v,'Asia/Bangkok','yyyy-MM-dd');
  var s = v.toString().trim();
  var sl = s.split('/');
  if (sl.length===3 && sl[2].length===4)
    return sl[2]+'-'+sl[0].padStart(2,'0')+'-'+sl[1].padStart(2,'0');
  return s.substring(0,10);
}
function matchSCBtoOTA(sheet) {
  if (!sheet) { var ss=SpreadsheetApp.openById(MASTER_SHEET_ID); sheet=ss.getSheetByName(TAB_NAME); }
  if (!sheet) { Logger.log('matchSCBtoOTA: sheet not found'); return; }
  var last=sheet.getLastRow();
  if (last<2) return;
  var data=sheet.getRange(2,1,last-1,HEADERS.length).getValues();

  var detailByConf={}, detailByBid={};
  data.forEach(function(row) {
    var ota =(row[C.ota-1]||'').toString().trim();
    var conf=(row[C.conf-1]||'').toString().trim();
    var bid =(row[C.bid-1]||'').toString().trim();
    if (ota.startsWith('SCB')) return;
    var roomRaw=(row[C.room-1]||'').toString().trim();
    var guestRaw=(row[C.guest-1]||'').toString().trim();
    var entry={
      guest: guestRaw,
      room:  isValidRoom(roomRaw)?cleanRoom(roomRaw):'?',
      ci:    row[C.ci-1], co:row[C.co-1],
      nights:row[C.nights-1], net:fmtAmt(row[C.net-1])
    };
    if (conf&&(/^[A-Z0-9]{6,14}$/.test(conf)||/^\d{10,20}$/.test(conf))) detailByConf[conf]=entry;
    if (bid) detailByBid[bid]=entry;
    var gk2=normG(guestRaw);
    if (gk2) detailByBid['guest:'+gk2]=entry;
  });

  // Build Airbnb batches keyed by NET SUM (not gross total)
  // Group rows by payout date window (same day) → sum nets
  // NOTE: rowIndex (1-based sheet row) is tracked on every entry so that once a
  // batch is consumed by a successful SCB match, the ORIGINAL Airbnb/Trip.com/
  // Expedia row(s) can be deleted too — otherwise they sit forever with a stale
  // "รอ..." status even though the money has already been reconciled on the SCB
  // side (this was the root cause of rows staying stuck in Pending Match).
  var airbnbByDate={};  // date → [{conf,guest,net,total,rowIndex}]
  // dedup by bookingId — ไม่ใช่ confCode เพราะ conf เดียวกันมีหลาย payout ได้ (multi-payout)
  var _airbnbSeenBid={};
  data.forEach(function(row,i) {
    var ota=(row[C.ota-1]||'').toString().trim();
    if (ota!=='Airbnb') return;
    var net=parseFloat((row[C.net-1]||0).toString().replace(/,/g,''))||0;
    var bt =parseFloat((row[C.total-1]||0).toString().replace(/,/g,''))||0;
    if (!net) return;
    var bid =(row[C.bid-1]||'').toString().trim();
    var conf=(row[C.conf-1]||'').toString().trim();
    if (bid && _airbnbSeenBid[bid]) return;
    if (bid) _airbnbSeenBid[bid]=true;
    var raw=row[C.date-1];
    var dt=normalizeDate(raw);
    if (!airbnbByDate[dt]) airbnbByDate[dt]=[];
    airbnbByDate[dt].push({
      conf:conf,
      guest:(row[C.guest-1]||'').toString(),
      net:net, total:bt,
      netStr:fmtAmt(row[C.net-1]),
      rowIndex:i+2
    });
  });

  // Build batches: group all rows per date → sum nets
  // Also build cross-date batches (Airbnb บางครั้ง payout รวมหลายวัน)
  var airbnbBatches={};
  var allDates=Object.keys(airbnbByDate).sort();

  // Single-date batches
  allDates.forEach(function(dt) {
    var rows=airbnbByDate[dt];
    var netSum=0; rows.forEach(function(r){netSum+=r.net;});
    var netSumStr=(Math.round(netSum*100)/100).toFixed(2);
    var key=netSumStr+'|'+dt+'|Airbnb';
    airbnbBatches[key]={
      guests:rows.map(function(r){return r.guest;}),
      confs: rows.map(function(r){return r.conf;}),
      nets:  rows.map(function(r){return r.netStr;}),
      rowIndices: rows.map(function(r){return r.rowIndex;}),
      date:dt, total:netSumStr
    };
    // Also key by gross total for single-booking payouts
    if (rows.length===1) {
      var grossStr=(Math.round(rows[0].total*100)/100).toFixed(2);
      var gkey=grossStr+'|'+dt+'|Airbnb';
      if (!airbnbBatches[gkey]) airbnbBatches[gkey]=airbnbBatches[key];
    }
    // Individual per-conf keys: SCB บางครั้งโอนแยกรายการ (เช่น -RES-, -EXT-)
    // ใส่ key สำหรับแต่ละ row เดี่ยวๆ ด้วย เพื่อให้ match 1-to-1 ได้
    rows.forEach(function(r) {
      var ikey=r.netStr+'|'+dt+'|Airbnb';
      if (!airbnbBatches[ikey]) {
        airbnbBatches[ikey]={
          guests:[r.guest], confs:[r.conf], nets:[r.netStr],
          rowIndices:[r.rowIndex],
          date:dt, total:r.netStr
        };
      }
    });
  });

  // Multi-date batches: รวม 2–7 วันติดกัน (Airbnb บางครั้ง batch หลาย CI date รวมกัน)
  for (var di=0; di<allDates.length; di++) {
    var combined=[]; var comboNet=0;
    for (var dj=di; dj<Math.min(di+7, allDates.length); dj++) {
      var drows=airbnbByDate[allDates[dj]];
      drows.forEach(function(r){combined.push(r); comboNet+=r.net;});
      if (dj>di) { // ≥2 วัน
        var comboStr=(Math.round(comboNet*100)/100).toFixed(2);
        var ckey=comboStr+'|'+allDates[di]+'|Airbnb';
        if (!airbnbBatches[ckey]) {
          airbnbBatches[ckey]={
            guests:combined.map(function(r){return r.guest;}),
            confs: combined.map(function(r){return r.conf;}),
            nets:  combined.map(function(r){return r.netStr;}),
            rowIndices: combined.map(function(r){return r.rowIndex;}),
            date:allDates[di], total:comboStr
          };
        }
      }
    }
  }

  var tripNets={}, expediaNets={};
  // collect individual rows by month+OTA
  var tripByMonth={}, expedByMonth={};
  data.forEach(function(row,i) {
    var ota=(row[C.ota-1]||'').toString().trim();
    var net=parseFloat((row[C.net-1]||0).toString().replace(/,/g,''))||0;
    if (!net) return;
    var raw=row[C.date-1];
    var dt=normalizeDate(raw);
    var mon=dt.substring(0,7);
    var entry={
      guest:(row[C.guest-1]||'').toString(),
      bid:  (row[C.bid-1]||'').toString(),
      net:  net, netStr:fmtAmt(row[C.net-1]),
      rowIndex:i+2
    };
    if (ota==='Trip.com') {
      // individual net key (same as before)
      var nk=fmtAmt(row[C.net-1])+'|'+mon+'|Trip.com';
      if (!tripNets[nk]) tripNets[nk]={guests:[],bids:[],nets:[],rowIndices:[],total:fmtAmt(row[C.net-1]),ota:'Trip.com'};
      tripNets[nk].guests.push(entry.guest);
      tripNets[nk].bids.push(entry.bid);
      tripNets[nk].nets.push(entry.netStr);
      tripNets[nk].rowIndices.push(entry.rowIndex);
      // accumulate for batch sum
      if (!tripByMonth[mon]) tripByMonth[mon]=[];
      tripByMonth[mon].push(entry);
    } else if (ota==='Expedia') {
      var ek=fmtAmt(row[C.net-1])+'|'+mon+'|Expedia';
      if (!expediaNets[ek]) expediaNets[ek]={guests:[],bids:[],nets:[],rowIndices:[],total:fmtAmt(row[C.net-1]),ota:'Expedia'};
      expediaNets[ek].guests.push(entry.guest);
      expediaNets[ek].bids.push(entry.bid);
      expediaNets[ek].nets.push(entry.netStr);
      expediaNets[ek].rowIndices.push(entry.rowIndex);
      if (!expedByMonth[mon]) expedByMonth[mon]=[];
      expedByMonth[mon].push(entry);
    }
  });

  // Trip.com batch sums: รวมทุก booking ในเดือนเดียวกัน (Trip.com บางครั้งโอนรวม)
  Object.keys(tripByMonth).forEach(function(mon) {
    var rows=tripByMonth[mon];
    if (rows.length<2) return;
    var sumNet=0; rows.forEach(function(r){sumNet+=r.net;});
    var sumStr=(Math.round(sumNet*100)/100).toFixed(2);
    var bk=sumStr+'|'+mon+'|Trip.com';
    if (!tripNets[bk]) {
      tripNets[bk]={
        guests:rows.map(function(r){return r.guest;}),
        bids:  rows.map(function(r){return r.bid;}),
        nets:  rows.map(function(r){return r.netStr;}),
        rowIndices: rows.map(function(r){return r.rowIndex;}),
        total: sumStr, ota:'Trip.com'
      };
    }
  });
  Object.keys(expedByMonth).forEach(function(mon) {
    var rows=expedByMonth[mon];
    if (rows.length<2) return;
    var sumNet=0; rows.forEach(function(r){sumNet+=r.net;});
    var sumStr=(Math.round(sumNet*100)/100).toFixed(2);
    var bk=sumStr+'|'+mon+'|Expedia';
    if (!expediaNets[bk]) {
      expediaNets[bk]={
        guests:rows.map(function(r){return r.guest;}),
        bids:  rows.map(function(r){return r.bid;}),
        nets:  rows.map(function(r){return r.netStr;}),
        rowIndices: rows.map(function(r){return r.rowIndex;}),
        total: sumStr, ota:'Expedia'
      };
    }
  });

  // Pre-build set of SCB bids already matched (any row with ✅ or ↳ in notes)
  var matchedScbBids={};
  data.forEach(function(row){
    var ota  =(row[C.ota-1]  ||'').toString();
    var notes=(row[C.notes-1]||'').toString();
    var bid  =(row[C.bid-1]  ||'').toString();
    if (!ota.startsWith('SCB')) return;
    if (notes.indexOf('✅')===0 || notes.indexOf('↳')===0) matchedScbBids[bid]=true;
  });

  var replacements=[];
  // rowIndex(es) of the now-settled Airbnb/Trip.com/Expedia rows, kept in the
  // sheet — NOT deleted. Each entry also carries the match note so the row can
  // be updated in place (status → 'โอนแล้ว') instead of retired. The ✅ Matched
  // SCB summary row is still created (rebuildBankLedger()/Dashboard read from
  // it), and getInvoiceToCreate_() already skips any row whose Conf. Code
  // shows up on a 'Matched' row elsewhere, so this can't double-invoice.
  var originalRowsToUpdate=[];
  data.forEach(function(row,i) {
    var ota  =(row[C.ota-1]  ||'').toString();
    var notes=(row[C.notes-1]||'').toString();
    var bid  =(row[C.bid-1]  ||'').toString();
    if (!ota.startsWith('SCB')) return;
    if (matchedScbBids[bid]) return;  // entire bid already matched/expanded

    var scbAmt =fmtAmt(row[C.net-1]);
    var rawD   =row[C.date-1];
    var scbDate=normalizeDate(rawD);
    var scbOTA =(row[C.ota-1]||'').toString();
    var scbBid =(row[C.bid-1]||'').toString().trim();
    var acctM  =(row[C.notes-1]||'').toString().match(/x[\dX]+/);
    var scbAcct=acctM?acctM[0]:'x256221';

    function noteFor(payType){ return 'โอนแล้ว | SCB '+payType+' ref '+scbBid+' | Value Date: '+scbDate; }

    var matchKey=null;
    Object.keys(airbnbBatches).forEach(function(k) {
      if (matchKey) return;
      var b=airbnbBatches[k];
      if (b.total!==scbAmt) return;
      var diff=Math.round((new Date(scbDate)-new Date(b.date))/86400000);
      if (diff>=-3&&diff<=14) matchKey=k;
    });
    if (matchKey) {
      var b=airbnbBatches[matchKey];
      replacements.push({deleteRow:i+2,
        insertRows:buildSCBRows(scbOTA,scbDate,scbBid,scbAmt,scbAcct,
          b.confs,b.guests,b.nets,detailByConf,{},'Airbnb payout')});
      var note=noteFor('Airbnb payout');
      if (b.rowIndices) b.rowIndices.forEach(function(r){ originalRowsToUpdate.push({row:r, note:note}); });
      delete airbnbBatches[matchKey]; return;
    }

    var scbMon=scbDate.substring(0,7);
    var tripKeys=[scbAmt+'|'+scbMon+'|Trip.com',
                  scbAmt+'|'+prevMonth(scbMon)+'|Trip.com',
                  scbAmt+'|'+nextMonth(scbMon)+'|Trip.com'];
    for (var ti=0;ti<tripKeys.length;ti++) {
      var b=tripNets[tripKeys[ti]];
      if (!b||!b.guests.length) continue;
      replacements.push({deleteRow:i+2,
        insertRows:buildSCBRows(scbOTA,scbDate,scbBid,scbAmt,scbAcct,
          b.bids,b.guests,b.nets,{},detailByBid,'Trip.com settlement')});
      var noteT=noteFor('Trip.com settlement');
      if (b.rowIndices) b.rowIndices.forEach(function(r){ originalRowsToUpdate.push({row:r, note:noteT}); });
      delete tripNets[tripKeys[ti]]; return;
    }

    var expKeys=[scbAmt+'|'+scbMon+'|Expedia',
                 scbAmt+'|'+prevMonth(scbMon)+'|Expedia',
                 scbAmt+'|'+nextMonth(scbMon)+'|Expedia'];
    for (var ei=0;ei<expKeys.length;ei++) {
      var b=expediaNets[expKeys[ei]];
      if (!b||!b.guests.length) continue;
      replacements.push({deleteRow:i+2,
        insertRows:buildSCBRows(scbOTA,scbDate,scbBid,scbAmt,scbAcct,
          b.bids,b.guests,b.nets,{},detailByBid,'Expedia remittance')});
      var noteE=noteFor('Expedia remittance');
      if (b.rowIndices) b.rowIndices.forEach(function(r){ originalRowsToUpdate.push({row:r, note:noteE}); });
      delete expediaNets[expKeys[ei]]; return;
    }
  });

  Logger.log('matchSCBtoOTA: '+replacements.length+' SCB rows to expand, '+originalRowsToUpdate.length+' original OTA rows to mark โอนแล้ว');

  // Combine both kinds of operations (SCB delete+insert, and in-place status
  // update of the now-settled original OTA rows) into one list, sorted by row
  // number descending, so that operating top-down never invalidates the row
  // numbers of not-yet-processed operations. Update ops don't change the row
  // count so ordering among themselves doesn't matter — only relative to the
  // 'scb' delete+insert ops. De-dupe defensively.
  var seenRow={};
  var ops=[];
  replacements.forEach(function(rep){
    if (seenRow[rep.deleteRow]) return;
    seenRow[rep.deleteRow]=true;
    ops.push({row:rep.deleteRow, type:'scb', rep:rep});
  });
  originalRowsToUpdate.forEach(function(u){
    if (seenRow[u.row]) return;
    seenRow[u.row]=true;
    ops.push({row:u.row, type:'update', note:u.note});
  });
  ops.sort(function(a,b){ return b.row-a.row; });

  ops.forEach(function(op) {
    if (op.type==='update') {
      sheet.getRange(op.row, C.status).setValue('โอนแล้ว');
      var notesCell=sheet.getRange(op.row, C.notes);
      var existing=(notesCell.getValue()||'').toString();
      notesCell.setValue(existing ? (existing+' | '+op.note) : op.note);
      return;
    }
    sheet.deleteRow(op.row);
    var insertAt=op.row;
    op.rep.insertRows.forEach(function(r,idx) {
      sheet.insertRowBefore(insertAt+idx);
      var ri=insertAt+idx;
      sheet.getRange(ri,1,1,HEADERS.length).setValues([[
        r.date,r.ota,r.bookingId,r.confCode,
        r.guest,r.room,r.checkIn,r.checkOut,r.nights,
        r.total,r.commission,r.net,r.status,r.notes
      ]]);
      var bg=r._isTotal?SCB_TOTAL_BG:(r._isSingle?SCB_TOTAL_BG:SCB_SUB_BG);
      sheet.getRange(ri,1,1,HEADERS.length).setBackground(bg);
      if (r._isTotal||r._isSingle) {
        sheet.getRange(ri,1,1,HEADERS.length).setFontWeight('bold');
      } else {
        sheet.getRange(ri,1,1,HEADERS.length)
          .setFontWeight('normal').setFontStyle('italic').setFontColor('#444444');
      }
      sheet.getRange(ri,10,1,3).setNumberFormat('#,##0.00');
    });
  });
  Logger.log('matchSCBtoOTA: done');
}

// ═══════════════════════════════════════════════════════════════
// MATCH SCB → Direct/Extranet booking (จ่ายตรงกับโรงแรม ไม่มี OTA email)
// ใช้กับ booking ใน Sheet1 ที่ channel = 'Extranet' (resId ขึ้นต้น 'EXP-')
// ซึ่งไม่มี OTA payout email ให้ match แบบ matchSCBtoOTA เลย — ต้อง match
// ตรงกับ Sheet1 โดยใช้ช่วงวันที่เช็คอิน/เช็คเอาท์แทนยอดเงิน (batch/net sum)
// รัน "หลัง" matchSCBtoOTA + matchBookingComSCB เสมอ เพราะแถวที่ยัง
// guest==='รอ match' หมายความว่าไม่มี OTA ไหน match ได้เลย
// ═══════════════════════════════════════════════════════════════
function matchExtranetSCB(sheet) {
  if (!sheet) { var ss0=SpreadsheetApp.openById(MASTER_SHEET_ID); sheet=ss0.getSheetByName(TAB_NAME); }
  if (!sheet) { Logger.log('matchExtranetSCB: sheet not found'); return; }
  var last=sheet.getLastRow();
  if (last<2) return;

  var ss=SpreadsheetApp.openById(MASTER_SHEET_ID);
  var s1=ss.getSheets()[0];
  var s1Data=s1.getDataRange().getValues();

  // หา header row ('เลขห้อง') เหมือน matchRoomFromSheet1
  var s1HR=0;
  for (var i=0;i<s1Data.length;i++) {
    if (s1Data[i].join('').indexOf('เลขห้อง')>=0) { s1HR=i; break; }
  }

  var data=sheet.getRange(2,1,last-1,HEADERS.length).getValues();

  // resId ที่ถูก match ไปแล้ว (เก็บไว้ใน notes ตอน match สำเร็จ)
  var alreadyMatchedResId={};
  data.forEach(function(row){
    var notes=(row[C.notes-1]||'').toString();
    var m=notes.match(/resId=([^\s|]+)/);
    if (m) alreadyMatchedResId[m[1]]=true;
  });

  // รวบรวม booking channel Extranet จาก Sheet1 ที่ยังไม่เคย match
  var extranetBookings=[];
  for (var i=s1HR+1;i<s1Data.length;i++) {
    var row=s1Data[i];
    var roomRaw=(row[0]||'').toString().trim();
    if (!roomRaw) continue;
    var channel=(row[4]||'').toString().trim();
    var resId  =(row[5]||'').toString().trim();
    if (channel!=='Extranet'||!resId) continue;
    if (alreadyMatchedResId[resId]) continue;
    var roomNum=roomRaw.match(/^(\d+)/);
    if (!roomNum) continue;
    var ci=normalizeSheetDate_(row[2]);
    var co=normalizeSheetDate_(row[3]);
    if (!ci||!co) continue;
    extranetBookings.push({
      room:roomNum[1],
      guest:(row[1]||'').toString().trim(),
      ci:ci, co:co, resId:resId
    });
  }
  if (!extranetBookings.length) { Logger.log('matchExtranetSCB: no unmatched Extranet bookings'); return; }

  var WINDOW_DAYS=5;

  // ── เก็บ SCB rows ที่ยัง unmatched ก่อน แล้วค่อยหา candidate ทั้งสองทาง ──
  // (เดิม bug: loop ทีละแถว SCB แล้ว auto-match ทันทีถ้าเจอ booking candidate
  // เดียว โดยไม่เช็คว่า booking นั้นมี SCB row อื่นที่ใกล้เคียงกว่า/เข้าเงื่อนไข
  // เดียวกันอยู่ด้วยหรือเปล่า → แถวที่ถูกประมวลผลก่อน (ไม่จำเป็นว่าใช่ตัวจริง)
  // จะ "ชิง" match booking ไปก่อน ทำให้แถวที่ถูกต้องจริงเหลือ 0 candidate)
  var scbRows=[];
  for (var r=0;r<data.length;r++) {
    var row=data[r];
    var ota  =(row[C.ota-1]  ||'').toString().trim();
    if (!ota.startsWith('SCB')) continue;
    var guest =(row[C.guest-1] ||'').toString().trim();
    var status=(row[C.status-1]||'').toString().trim();
    if (guest!=='รอ match') continue;   // ถูก match ไปแล้วโดย matchSCBtoOTA/matchBookingComSCB
    if (status.indexOf('⚠️')===0) continue; // ถูก flag ไว้ให้ตรวจสอบมือแล้ว รอบก่อนหน้า
    scbRows.push({
      dataRow: r,
      amt:  fmtAmt(row[C.net-1]),
      date: normalizeDate(row[C.date-1])
    });
  }
  if (!scbRows.length) { Logger.log('matchExtranetSCB: no unmatched SCB rows'); return; }

  // candidate booking index(es) ต่อ SCB row
  scbRows.forEach(function(s){
    s.bookingIdx=[];
    extranetBookings.forEach(function(b,bi){
      var diffCi=Math.abs(Math.round((new Date(s.date)-new Date(b.ci))/86400000));
      var diffCo=Math.abs(Math.round((new Date(s.date)-new Date(b.co))/86400000));
      if (diffCi<=WINDOW_DAYS || diffCo<=WINDOW_DAYS) s.bookingIdx.push(bi);
    });
  });

  // candidate SCB row index(es) ต่อ booking (ทิศทางกลับ)
  var bookingToScb={};
  scbRows.forEach(function(s,si){
    s.bookingIdx.forEach(function(bi){
      (bookingToScb[bi]=bookingToScb[bi]||[]).push(si);
    });
  });

  var matched=0, flagged=0;
  scbRows.forEach(function(s){
    if (s.bookingIdx.length===0) return; // ไม่มี candidate เลย ปล่อยเป็น รอ match ต่อไป
    var uniqueAndMutual = s.bookingIdx.length===1
      && bookingToScb[s.bookingIdx[0]].length===1;

    if (uniqueAndMutual) {
      var b=extranetBookings[s.bookingIdx[0]];
      var nts=nightsBetween(b.ci,b.co);
      var note='✅ Direct/Extranet Pay | '+b.guest+' resId='+b.resId+' | NET ฿'+s.amt+' | Value Date: '+s.date;
      sheet.getRange(s.dataRow+2,C.guest,1,1).setValue(b.guest);
      sheet.getRange(s.dataRow+2,C.room,1,1).setValue(b.room);
      sheet.getRange(s.dataRow+2,C.ci,1,1).setValue(b.ci);
      sheet.getRange(s.dataRow+2,C.co,1,1).setValue(b.co);
      if (nts) sheet.getRange(s.dataRow+2,C.nights,1,1).setValue(nts);
      sheet.getRange(s.dataRow+2,C.status,1,1).setValue('✅ Matched - Direct/Extranet');
      sheet.getRange(s.dataRow+2,C.notes,1,1).setValue(note);
      matched++;
    } else {
      // ไม่ mutual-unique: booking นี้มี SCB candidate มากกว่า 1 แถว
      // หรือ SCB แถวนี้ match ได้หลาย booking → ห้ามเดา ต้องตรวจสอบมือ
      sheet.getRange(s.dataRow+2,C.status,1,1)
        .setValue('⚠️ รอตรวจสอบ Direct/Extranet ('+s.bookingIdx.length+' candidates)');
      flagged++;
    }
  });
  Logger.log('matchExtranetSCB: '+matched+' matched, '+flagged+' flagged for manual review');
  if (matched>0 || flagged>0) {
    SpreadsheetApp.getActiveSpreadsheet()
      .toast('Direct/Extranet match: '+matched+' matched, '+flagged+' ต้องตรวจสอบมือ','Done',5);
  }
}

// ═══════════════════════════════════════════════════════════════
// ONE-OFF FIX (2026-07-16): revert the SCB-2026-07-14-681.38 row that
// matchExtranetSCB's older (buggy) version wrongly matched to Natphatsorn's
// booking (the REAL match is SCB-2026-07-15-5514.83, checkout day exact).
// Resets it back to raw pending state so both rows get correctly flagged
// by the fixed matchExtranetSCB() for manual review instead.
// ═══════════════════════════════════════════════════════════════
function revertBadDirectExtranetMatch_20260716() {
  var ss=SpreadsheetApp.openById(MASTER_SHEET_ID);
  var sheet=ss.getSheetByName(TAB_NAME);
  if (!sheet) { Logger.log('sheet not found'); return; }
  var last=sheet.getLastRow();
  var data=sheet.getRange(2,1,last-1,HEADERS.length).getValues();
  var reverted=0;
  data.forEach(function(row,i){
    var bid=(row[C.bid-1]||'').toString().trim();
    if (bid!=='SCB-2026-07-14-681.38') return;
    var r=i+2;
    sheet.getRange(r,C.guest,1,1).setValue('รอ match');
    sheet.getRange(r,C.room,1,1).setValue('?');
    sheet.getRange(r,C.ci,1,1).setValue('');
    sheet.getRange(r,C.co,1,1).setValue('');
    sheet.getRange(r,C.nights,1,1).setValue('');
    sheet.getRange(r,C.status,1,1).setValue('เงินเข้าบัญชี x256221');
    sheet.getRange(r,C.notes,1,1).setValue('via SCB Transfer | เงินโอนเข้าบัญชี');
    reverted++;
  });
  Logger.log('revertBadDirectExtranetMatch_20260716: '+reverted+' row(s) reverted');
}

// ═══════════════════════════════════════════════════════════════
// MANUAL OVERRIDE: resolveManualExtranetHints
// ใช้เมื่อ matchExtranetSCB() flag แถวว่า "⚠️ รอตรวจสอบ" (มีหลาย candidate
// เกินจะเดาเอง) — พี่แค่พิมพ์ "resId=EXP-xxxxx" ทับลงในช่อง หมายเหตุ ของ
// แถว SCB ที่ถูกต้องจริง แล้วรันฟังก์ชันนี้ (หรือ quickReformat/fullSyncAndLedger
// ที่เรียกฟังก์ชันนี้ให้อัตโนมัติ) — ระบบจะไปดึง guest/room/ci/co/nights จาก
// Sheet1 ตาม resId นั้นมาเติมให้ครบเองทั้งหมด ไม่ต้องพิมพ์ทีละช่อง
// ═══════════════════════════════════════════════════════════════
function resolveManualExtranetHints(sheet) {
  if (!sheet) { var ss0=SpreadsheetApp.openById(MASTER_SHEET_ID); sheet=ss0.getSheetByName(TAB_NAME); }
  if (!sheet) { Logger.log('resolveManualExtranetHints: sheet not found'); return; }
  var last=sheet.getLastRow();
  if (last<2) return;

  var ss=SpreadsheetApp.openById(MASTER_SHEET_ID);
  var s1=ss.getSheets()[0];
  var s1Data=s1.getDataRange().getValues();
  var s1HR=0;
  for (var i=0;i<s1Data.length;i++) {
    if (s1Data[i].join('').indexOf('เลขห้อง')>=0) { s1HR=i; break; }
  }
  var byResId={};
  for (var i=s1HR+1;i<s1Data.length;i++) {
    var row=s1Data[i];
    var resId=(row[5]||'').toString().trim();
    if (!resId) continue;
    var roomRaw=(row[0]||'').toString().trim();
    var roomNum=roomRaw.match(/^(\d+)/);
    byResId[resId]={
      room: roomNum?roomNum[1]:'?',
      guest:(row[1]||'').toString().trim(),
      ci: normalizeSheetDate_(row[2]),
      co: normalizeSheetDate_(row[3])
    };
  }

  var data=sheet.getRange(2,1,last-1,HEADERS.length).getValues();
  var resolved=0;
  data.forEach(function(row,i){
    var ota=(row[C.ota-1]||'').toString().trim();
    if (!ota.startsWith('SCB')) return;
    // รับได้ทั้ง "resId=XXX" เดี่ยวๆ หรือ "resId=XXX" ต่อท้ายข้อความอื่น
    var notes=(row[C.notes-1]||'').toString().trim();
    var m=notes.match(/resId\s*=\s*([A-Za-z0-9_-]+)/i);
    if (!m) return;
    if (notes.indexOf('✅ Direct/Extranet Pay')===0) return; // resolve ไปแล้ว ข้าม
    var resId=m[1];
    var b=byResId[resId];
    if (!b) { Logger.log('resolveManualExtranetHints: resId ไม่พบใน Sheet1: '+resId); return; }
    var r=i+2;
    var scbAmt =fmtAmt(row[C.net-1]);
    var scbDate=normalizeDate(row[C.date-1]);
    var nts=nightsBetween(b.ci,b.co);
    var note='✅ Direct/Extranet Pay | '+b.guest+' resId='+resId+' | NET ฿'+scbAmt+' | Value Date: '+scbDate;
    sheet.getRange(r,C.guest,1,1).setValue(b.guest);
    sheet.getRange(r,C.room,1,1).setValue(b.room);
    sheet.getRange(r,C.ci,1,1).setValue(b.ci);
    sheet.getRange(r,C.co,1,1).setValue(b.co);
    if (nts) sheet.getRange(r,C.nights,1,1).setValue(nts);
    sheet.getRange(r,C.status,1,1).setValue('✅ Matched - Direct/Extranet');
    sheet.getRange(r,C.notes,1,1).setValue(note);
    resolved++;
  });
  Logger.log('resolveManualExtranetHints: '+resolved+' row(s) resolved from manual resId hint');
  if (resolved>0) SpreadsheetApp.getActiveSpreadsheet()
    .toast('Manual resId match: '+resolved+' resolved','Done',4);
}

// ═══════════════════════════════════════════════════════════════
// runAirbnbEmailParse — fetch + parse Airbnb payout emails → upsert rows
// ═══════════════════════════════════════════════════════════════
function runAirbnbEmailParse() {
  var ss = SpreadsheetApp.openById(MASTER_SHEET_ID);
  var sheet = ss.getSheetByName(TAB_NAME);
  var rows = fetchAirbnbPayouts();
  Logger.log('runAirbnbEmailParse: fetched '+rows.length+' Airbnb rows from email');
  if (!rows.length) { Logger.log('ไม่พบ payout email ใหม่'); return; }

  var last = sheet.getLastRow();
  var existing = last > 1 ? sheet.getRange(2,1,last-1,HEADERS.length).getValues() : [];
  var existingConfs = {};
  var existingBids  = {};
  existing.forEach(function(r) {
    var c = (r[C.conf-1]||'').toString().trim();
    var b = (r[C.bid-1] ||'').toString().trim();
    if (c) existingConfs[c] = true;
    if (b) existingBids[b]  = true;
  });

  var added = 0;
  rows.forEach(function(r) {
    var conf = (r.confCode   ||'').toString().trim();
    var bid  = (r.bookingId  ||'').toString().trim();
    // dedup ด้วย bid เท่านั้น — bid ถูก generate unique ทุก payout (ABB-CONF, ABB-CONF-EXT-DATE, ABB-CONF-RES-DATE)
    // ไม่ใช้ conf dedup อีกต่อไป เพราะ booking เดียวกันอาจมีหลาย payout (extension, resolution, installment)
    if (existingBids[bid]) {
      Logger.log('skip dup: '+conf+' / '+bid);
      return;
    }
    sheet.appendRow([
      r.date, r.ota, r.bookingId, r.confCode,
      r.guest, r.room, r.checkIn, r.checkOut, r.nights,
      r.total, r.commission, r.net, r.status, r.notes
    ]);
    existingConfs[conf] = true;
    existingBids[bid]   = true;
    added++;
    Logger.log('added: '+conf+' | '+r.guest+' | net='+r.net);
  });
  if (added > 0) {
    matchRoomFromSheet1();
    applyManualRoomFixes();
    sortPayoutByOTA(sheet);
  }
  Logger.log('runAirbnbEmailParse: '+added+' rows added');
}

// ═══════════════════════════════════════════════════════════════
// FILL MISSING CI/CO FROM AIRBNB EMAIL
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// FILL CI/CO FROM HARDCODED PATCH — SCB total rows ที่ map ได้จาก conf
// ═══════════════════════════════════════════════════════════════
function fillMissingCiCoFromPatch() {
  var ss    = SpreadsheetApp.openById(MASTER_SHEET_ID);
  var sheet = ss.getSheetByName(TAB_NAME);
  var data  = sheet.getDataRange().getValues();
  var h     = data[0].map(function(v){ return v.toString().trim(); });
  var pBID  = h.indexOf('Booking ID');
  var pCI   = h.indexOf('เช็คอิน');
  var pCO   = h.indexOf('เช็คเอาท์');
  var pN    = h.indexOf('คืน');

  var CI_CO_PATCH = {
    'SCB-2026-03-08-400.17':   {ci:'2026-03-03', co:'2026-03-06', nights:3},
    'SCB-2026-03-18-700.00':   {ci:'2026-03-16', co:'2026-03-27', nights:11},
    'SCB-2026-03-18-4684.48':  {ci:'2026-03-16', co:'2026-03-27', nights:11},
    'SCB-2026-03-21-15105.30': {ci:'2026-02-19', co:'2026-05-03', nights:73},
    'SCB-2026-03-22-3670.00':  {ci:'2026-02-28', co:'2026-03-20', nights:20},
    'SCB-2026-03-30-13497.52': {ci:'2026-03-28', co:'2026-04-29', nights:32},
    'SCB-2026-04-11-2800.05':  {ci:'2026-02-19', co:'2026-05-03', nights:73},
    'SCB-2026-04-12-823.71':   {ci:'2026-03-31', co:'2026-04-13', nights:13},
    'SCB-2026-04-21-3760.79':  {ci:'2026-03-31', co:'2026-04-13', nights:13},
    'SCB-2026-04-22-2000.00':  {ci:'2026-03-31', co:'2026-04-13', nights:13},
    'SCB-2026-06-02-6507.53':  {ci:'2026-05-31', co:'2026-06-15', nights:15},
    'SCB-2026-06-08-2989.93':  {ci:'2026-05-31', co:'2026-06-15', nights:15}
  };

  var updated = 0;
  for (var i = 1; i < data.length; i++) {
    var bid = (data[i][pBID] || '').toString().trim();
    var p   = CI_CO_PATCH[bid];
    if (!p) continue;
    var ci  = data[i][pCI]; var co = data[i][pCO];
    if (ci && co) continue;  // already filled
    sheet.getRange(i+1, pCI+1).setValue(p.ci);
    sheet.getRange(i+1, pCO+1).setValue(p.co);
    if (!data[i][pN]) sheet.getRange(i+1, pN+1).setValue(p.nights);
    updated++;
    Logger.log('fillMissingCiCoFromPatch: ' + bid + ' ci=' + p.ci + ' co=' + p.co);
  }
  Logger.log('fillMissingCiCoFromPatch: ' + updated + ' rows filled');
}

// ═══════════════════════════════════════════════════════════════
// FILL MISSING CI/CO FROM OTHER ROW WITH SAME BOOKING ID
// ═══════════════════════════════════════════════════════════════
function fillMissingCiCoFromBookingID() {
  var ss    = SpreadsheetApp.openById(MASTER_SHEET_ID);
  var sheet = ss.getSheetByName(TAB_NAME);
  var data  = sheet.getDataRange().getValues();
  var h     = data[0].map(function(v){ return v.toString().trim(); });
  var pBID  = h.indexOf('Booking ID');
  var pCI   = h.indexOf('เช็คอิน');
  var pCO   = h.indexOf('เช็คเอาท์');
  var pN    = h.indexOf('คืน');

  // Build map: bookingID -> {ci, co, nights} from rows that already have CI/CO
  var bidMap = {};
  for (var i = 1; i < data.length; i++) {
    var ci = data[i][pCI], co = data[i][pCO];
    if (!ci || !co) continue;
    var bidRaw = (data[i][pBID] || '').toString();
    bidRaw.split(',').forEach(function(b) {
      b = b.trim();
      if (b && !bidMap[b]) bidMap[b] = { ci: ci, co: co, nights: data[i][pN] };
    });
  }

  var updated = 0;
  for (var i = 1; i < data.length; i++) {
    var ci = data[i][pCI], co = data[i][pCO];
    if (ci && co) continue;
    var bidRaw = (data[i][pBID] || '').toString();
    var bids = bidRaw.split(',').map(function(b){ return b.trim(); }).filter(Boolean);
    if (bids.length > 1) continue; // merged multi-booking settlement row, no single CI/CO applies
    var info = null;
    for (var j = 0; j < bids.length; j++) {
      if (bidMap[bids[j]]) { info = bidMap[bids[j]]; break; }
    }
    if (!info) continue;
    sheet.getRange(i+1, pCI+1).setValue(info.ci);
    sheet.getRange(i+1, pCO+1).setValue(info.co);
    if (!data[i][pN] && info.nights) sheet.getRange(i+1, pN+1).setValue(info.nights);
    updated++;
    Logger.log('fillMissingCiCoFromBookingID: bid=' + bidRaw + ' ci=' + info.ci + ' co=' + info.co);
  }
  Logger.log('fillMissingCiCoFromBookingID: ' + updated + ' rows filled');
}

function fillMissingCiCoFromEmail() {
  var ss        = SpreadsheetApp.openById(MASTER_SHEET_ID);
  var sheet     = ss.getSheetByName(TAB_NAME);
  var data      = sheet.getDataRange().getValues();
  var h         = data[0].map(function(v){ return v.toString().trim(); });
  var pOTA  = h.indexOf('OTA');
  var pConf = h.indexOf('Conf. Code');
  var pCI   = h.indexOf('เช็คอิน');
  var pCO   = h.indexOf('เช็คเอาท์');
  var pN    = h.indexOf('คืน');

  // Early-exit: ถ้าไม่มีแถว Airbnb ที่ขาด CI/CO เลย ก็ไม่ต้องเสียเวลา Gmail
  // search + parse อีเมลนับร้อยฉบับทุกรอบที่ trigger รัน (เดิมรีบิลด์
  // emailMap ใหม่หมดทุกครั้งแม้ไม่มีอะไรให้ fill เลย — เป็นสาเหตุหลักที่ทำให้
  // script วิ่งเกิน 6 นาที)
  var missingRows = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if ((row[pOTA] || '').toString().trim() !== 'Airbnb') continue;
    if (row[pCI] && row[pCO]) continue;
    var conf = (row[pConf] || '').toString().trim();
    if (!conf) continue;
    missingRows.push(i);
  }
  if (!missingRows.length) {
    Logger.log('fillMissingCiCoFromEmail: 0 rows missing ci/co — skip Gmail search');
    return;
  }

  // Build map: confCode -> {ci, co} from Airbnb payout emails
  // ใช้ relative date window (ย้อนหลัง 6 เดือน) แทน hardcode 'after:2026/01/01'
  // เดิมวันที่ตายตัวทำให้ search window โตขึ้นเรื่อยๆ ทุกวันที่ผ่านไป
  var since = new Date();
  since.setMonth(since.getMonth() - 6);
  var sinceStr = Utilities.formatDate(since, 'Asia/Bangkok', 'yyyy/MM/dd');


  var emailMap = {};
  var threads = GmailApp.search(
    'from:automated@airbnb.com subject:"sent a payout" after:' + sinceStr, 0, 200
  );
  threads.forEach(function(t) {
    t.getMessages().forEach(function(m) {
      try {
        var rows = parseAirbnbEmail(m);
        rows.forEach(function(r) {
          var conf = (r.confCode || '').toString().trim();
          if (conf && r.checkIn && r.checkOut && !emailMap[conf]) {
            emailMap[conf] = { ci: r.checkIn, co: r.checkOut, nights: r.nights || nightsBetween(r.checkIn, r.checkOut) };
          }
        });
      } catch(e) { Logger.log('fillMissingCiCo email err: ' + e.message); }
    });
  });
  Logger.log('fillMissingCiCoFromEmail: email map built, ' + Object.keys(emailMap).length + ' confs');

  var updated = 0;
  missingRows.forEach(function(i) {
    var row  = data[i];
    var conf = (row[pConf] || '').toString().trim();
    var info = emailMap[conf];
    if (!info) return;
    sheet.getRange(i + 1, pCI + 1).setValue(info.ci);
    sheet.getRange(i + 1, pCO + 1).setValue(info.co);
    if (!row[pN]) sheet.getRange(i + 1, pN + 1).setValue(info.nights);
    updated++;
    Logger.log('fillMissingCiCo: filled conf=' + conf + ' ci=' + info.ci + ' co=' + info.co);
  });
  Logger.log('fillMissingCiCoFromEmail: ' + updated + ' rows filled');
}

// ═══════════════════════════════════════════════════════════════
// fixBookingDatesFromEmail()
// ค้นหาอีเมล LH/Trip/Expedia/Airbnb ย้อนหลัง 6 เดือน
// match กับ row ใน Sheet1 ด้วย guestKey + checkIn date
// bulk-update col H (วันจอง) ให้เป็นวันที่รับอีเมล = วันจองจริง
// ═══════════════════════════════════════════════════════════════
// ─── debug: dump body ของ LH email เพื่อดู format จริง ───
// ⚠️ อ่านอีเมลเท่านั้น ไม่เรียก parseLHEmail ไม่ส่ง LINE ทุกกรณี
function debugLHEmailBody() {
  var since = new Date();
  since.setMonth(since.getMonth() - 6);
  var sinceStr = Utilities.formatDate(since, 'GMT+7', 'yyyy/MM/dd');
  // ค้นเฉพาะ LH new reservation — ไม่ใช้ fn ใดๆ ที่ส่ง LINE
  var threads = GmailApp.search(
    'from:no-reply@app.littlehotelier.com after:' + sinceStr, 0, 3
  );
  threads.forEach(function(thread, ti) {
    var msg = thread.getMessages()[0];
    Logger.log('=== #' + (ti+1) + ' subject: ' + msg.getSubject());
    Logger.log('date: ' + Utilities.formatDate(msg.getDate(),'GMT+7','yyyy-MM-dd'));
    // plain body เท่านั้น — ไม่เรียก function อื่น
    var body = msg.getPlainBody() || msg.getBody().replace(/<[^>]+>/g,'');
    Logger.log(body.substring(0, 2000));
    Logger.log('=== END #' + (ti+1) + ' ===');
  });
}

function fixBookingDatesFromEmail() {
  var ss = SpreadsheetApp.openById(MASTER_SHEET_ID);
  var sh = ss.getSheetByName('Sheet1');
  if (!sh) { Logger.log('Sheet1 not found'); return; }

  var lastRow = sh.getLastRow();
  if (lastRow < 2) { Logger.log('No data rows'); return; }

  var data = sh.getRange(2, 1, lastRow - 1, 8).getValues();

  function gKey(name) {
    return (name || '').toLowerCase().replace(/[^a-z]/g, '').substring(0, 10);
  }
  function toYMD(v) {
    if (!v) return '';
    if (v instanceof Date) return Utilities.formatDate(v, 'GMT+7', 'yyyy-MM-dd');
    return String(v).substring(0, 10);
  }

  // ── ดึงอีเมลทุกประเภทจาก LH + Airbnb (ย้อนหลัง 6 เดือน) ──
  var since = new Date();
  since.setMonth(since.getMonth() - 6);
  var sinceStr = Utilities.formatDate(since, 'GMT+7', 'yyyy/MM/dd');

  var queries = [
    'from:no-reply@app.littlehotelier.com after:' + sinceStr,
    'from:automated@airbnb.com subject:"Reservation confirmed" after:' + sinceStr,
  ];

  // emailMap: guestKey → [{bookDate, checkIn, name}]
  var emailMap = {};

  function addEntry(key, bookDate, checkIn, name) {
    if (!key || !bookDate) return;
    if (!emailMap[key]) emailMap[key] = [];
    emailMap[key].push({ bookDate: bookDate, checkIn: checkIn, name: name });
  }

  queries.forEach(function(q) {
    var threads = GmailApp.search(q, 0, 500);
    Logger.log('query: ' + q + ' → ' + threads.length + ' threads');
    threads.forEach(function(thread) {
      thread.getMessages().forEach(function(msg) {
        var subj = msg.getSubject() || '';
        if (/cancell?ation|ยกเลิก/i.test(subj)) return;

        var bookDate = Utilities.formatDate(msg.getDate(), 'GMT+7', 'yyyy-MM-dd');
        var body = msg.getPlainBody() || '';

        // ── parse guest name + checkIn จาก body ──
        var guest = '', checkIn = '';

        // วันจอง = วันที่รับอีเมล New Reservation (msg.getDate())
        // ไม่ต้อง parse checkIn จาก body เลย
        var bookedM = body.match(
          /([A-Z\u00C0-\u024F][^\n]+?)\s+booked the\s/i
        );
        if (bookedM) {
          guest = bookedM[1].trim();
        }

        if (!guest || guest.length < 2) return;
        var key = gKey(guest);
        addEntry(key, bookDate, checkIn, guest);
      });
    });
  });

  Logger.log('Email map keys: ' + Object.keys(emailMap).length);

  // ── Set col H Plain text ก่อน ──
  sh.getRange(2, 8, lastRow - 1, 1).setNumberFormat('@STRING@');

  var updated = 0, notFound = [];

  data.forEach(function(row, i) {
    var guest = String(row[1] || '').trim();
    var resId = String(row[5] || '').trim();
    var ciStr = toYMD(row[2]);
    var key   = gKey(guest);
    var candidates = emailMap[key] || [];

    if (candidates.length === 0) { notFound.push(resId + '(' + guest + ')'); return; }

    // เลือก email ที่ bookDate ก่อนหรือตรงกับ checkIn และใกล้ checkIn มากสุด
    // (แขกจองก่อนเข้าพักเสมอ — ใช้ bookDate = วันรับ email เป็นวันจองจริง)
    var best = null, bestDiff = Infinity;
    candidates.forEach(function(c) {
      var diff = (new Date(ciStr) - new Date(c.bookDate)) / 86400000; // days before checkIn
      if (diff >= 0 && diff < bestDiff) { bestDiff = diff; best = c; }
    });
    // fallback: ถ้าไม่มีที่ก่อน checkIn (late booking / same day) ใช้ที่ใกล้สุด
    if (!best) {
      candidates.forEach(function(c) {
        var diff = Math.abs((new Date(ciStr) - new Date(c.bookDate)) / 86400000);
        if (diff < bestDiff) { bestDiff = diff; best = c; }
      });
    }

    if (best) {
      sh.getRange(i + 2, 8).setValue(best.bookDate);
      updated++;
      Logger.log('✅ ' + resId + ' | ' + guest + ' → bookDate=' + best.bookDate);
    } else {
      notFound.push(resId + '(' + guest + ')');
    }
  });

  Logger.log('Updated: ' + updated + ' / ' + data.length);
  if (notFound.length) Logger.log('Not found (' + notFound.length + '): ' + notFound.slice(0,20).join(', '));

  // ── Sort by col H ascending ──
  if (lastRow > 2) {
    var dr = sh.getRange(2, 1, lastRow - 1, 8);
    var rows = dr.getValues();
    rows.sort(function(a, b) {
      var da = String(a[7] || '9999-12-31').substring(0, 10);
      var db = String(b[7] || '9999-12-31').substring(0, 10);
      return da < db ? -1 : da > db ? 1 : 0;
    });
    dr.setValues(rows);
  }

  SpreadsheetApp.flush();
  Logger.log('fixBookingDatesFromEmail: done');
}


// ═══════════════════════════════════════════════════════════════
// GITHUB EXPORT
// ═══════════════════════════════════════════════════════════════
function exportToGitHub() {
  var ss     = SpreadsheetApp.openById(MASTER_SHEET_ID);
  var token  = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  var repo   = 'theloftlivingspace-droid/payout-income-log';
  var branch = 'main';

  var files = [
    { sheet: 'Payout_Income_Log', path: 'data/payout_income_log.json' },
    { sheet: 'Bank_Ledger',       path: 'data/bank_ledger.json'       },
    { sheet: 'Sheet1',            path: 'data/sheet1.json'            }
  ];

  files.forEach(function(f) {
    var sheet = ss.getSheetByName(f.sheet);
    if (!sheet) { Logger.log('exportToGitHub: sheet not found: ' + f.sheet); return; }
    var data    = sheet.getDataRange().getValues();

    // Serialize Date objects as YYYY-MM-DD (Bangkok time) instead of letting
    // JSON.stringify() emit ISO Z strings which shift the date by -7 hours
    var serialized = data.map(function(row) {
      return row.map(function(cell) {
        if (cell instanceof Date) {
          return Utilities.formatDate(cell, 'GMT+7', 'yyyy-MM-dd');
        }
        // แปลง string M/D/YYYY หรือ M/D/YY → YYYY-MM-DD
        if (typeof cell === 'string' && /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(cell.trim())) {
          var parts = cell.trim().split('/');
          var m = parseInt(parts[0]), d = parseInt(parts[1]), y = parseInt(parts[2]);
          if (y < 100) y += 2000;
          return y + '-' + ('0'+m).slice(-2) + '-' + ('0'+d).slice(-2);
        }
        return cell;
      });
    });

    var json    = JSON.stringify(serialized);
    var encoded = Utilities.base64Encode(json, Utilities.Charset.UTF_8);

    var apiUrl = 'https://api.github.com/repos/' + repo + '/contents/' + f.path;
    var headers = { Authorization: 'token ' + token, 'Content-Type': 'application/json' };

    // Get current SHA (ถ้าไฟล์มีอยู่แล้ว)
    var sha = '';
    try {
      var getRes = UrlFetchApp.fetch(apiUrl, { headers: headers, muteHttpExceptions: true });
      if (getRes.getResponseCode() === 200) {
        sha = JSON.parse(getRes.getContentText()).sha;
      }
    } catch(e) { Logger.log('exportToGitHub SHA error: ' + e.message); }

    // Push
    var payload = { message: 'Auto-export: ' + f.sheet, content: encoded, branch: branch };
    if (sha) payload.sha = sha;
    try {
      var res = UrlFetchApp.fetch(apiUrl, {
        method: 'put',
        headers: headers,
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });
      Logger.log('exportToGitHub ' + f.sheet + ': HTTP ' + res.getResponseCode());
    } catch(e) { Logger.log('exportToGitHub push error: ' + e.message); }
  });
}


// ═══════════════════════════════════════════════════════════════
// RESTORE FROM GITHUB — คืนข้อมูลจาก JSON backup
// รันเมื่อ sheet หาย หรือต้องการ rollback
// ═══════════════════════════════════════════════════════════════
function restoreFromGitHub() {
  var token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN')
              || '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';
  var repo  = 'theloftlivingspace-droid/payout-income-log';
  var ss    = SpreadsheetApp.openById(MASTER_SHEET_ID);

  var files = [
    { path: 'data/payout_income_log.json', tabName: TAB_NAME },
    { path: 'data/bank_ledger.json',       tabName: BANK_LEDGER_TAB }
  ];

  files.forEach(function(f) {
    try {
      var url = 'https://api.github.com/repos/' + repo + '/contents/' + f.path;
      var res = UrlFetchApp.fetch(url, {
        headers: { Authorization: 'token ' + token },
        muteHttpExceptions: true
      });
      if (res.getResponseCode() !== 200) {
        Logger.log('restoreFromGitHub: HTTP ' + res.getResponseCode() + ' for ' + f.path);
        return;
      }
      var meta    = JSON.parse(res.getContentText());
      var decoded = Utilities.newBlob(Utilities.base64Decode(meta.content)).getDataAsString();
      var data    = JSON.parse(decoded);
      if (!data || data.length < 2) { Logger.log('restoreFromGitHub: empty data for ' + f.tabName); return; }

      // Get or create sheet
      var sheet = ss.getSheetByName(f.tabName);
      if (!sheet) sheet = ss.insertSheet(f.tabName);
      sheet.clearContents();
      sheet.clearFormats();

      // Write all rows at once
      var numRows = data.length;
      var numCols = data[0].length;
      sheet.getRange(1, 1, numRows, numCols).setValues(data);

      // Parse dates back (ISO strings → Date objects)
      var dateColIndices = [];
      var header = data[0];
      ['วันที่ตรวจพบ','เช็คอิน','เช็คเอาท์'].forEach(function(col) {
        var idx = header.indexOf(col);
        if (idx >= 0) dateColIndices.push(idx);
      });
      if (dateColIndices.length && numRows > 1) {
        for (var r = 1; r < numRows; r++) {
          dateColIndices.forEach(function(ci) {
            var v = data[r][ci];
            if (v && typeof v === 'string' && v.match(/^\d{4}-\d{2}-\d{2}/)) {
              var d = new Date(v);
              if (!isNaN(d.getTime())) {
                sheet.getRange(r+1, ci+1).setValue(d);
              }
            }
          });
        }
      }

      Logger.log('restoreFromGitHub: ' + f.tabName + ' restored ' + numRows + ' rows');
    } catch(e) {
      Logger.log('restoreFromGitHub ERROR ' + f.tabName + ': ' + e.message);
    }
  });

  // Re-apply formatting
  stylePayoutLog();
  styleSheet1();
  rebuildBankLedger();  // re-apply ledger colors & summary (reads from Payout_Income_Log)
  SpreadsheetApp.getActiveSpreadsheet().toast('Restore เสร็จ — ข้อมูลกลับมาแล้ว', 'Done', 6);
  Logger.log('restoreFromGitHub: complete');
}

// ═══════════════════════════════════════════════════════════════
// PATCH: fixUnmatchedRows
// - ลบ รอ match ก่อน 2026-03-05
// - Match รายการที่ระบุตัวได้จาก receipts/sheet1/email
// ═══════════════════════════════════════════════════════════════
function fixUnmatchedRows() {
  var ss    = SpreadsheetApp.openById(MASTER_SHEET_ID);
  var sheet = ss.getSheetByName('Payout_Income_Log');
  var data  = sheet.getDataRange().getValues();

  // column indices (0-based)
  var C_DATE=0, C_OTA=1, C_BID=2, C_CONF=3, C_GUEST=4, C_ROOM=5,
      C_CI=6, C_CO=7, C_N=8, C_AMT=9, C_COMM=10, C_NET=11, C_STATUS=12, C_NOTE=13;

  var cutoff = new Date('2026-03-05');

  // ── 1. collect rows to DELETE (pre-Mar05 รอ match) ──────────────
  var toDelete = [];
  for (var i = data.length - 1; i >= 1; i--) {
    var row = data[i];
    var status = (row[C_STATUS] || '').toString();
    if (status.indexOf('รอ match') === -1 && status !== 'เงินเข้าบัญชี x256221') continue;
    var d = parseDate_(row[C_DATE]);
    if (!d) continue;
    if (d < cutoff) toDelete.push(i + 1); // 1-indexed sheet row
  }
  // delete from bottom up (already reversed)
  toDelete.forEach(function(r) { sheet.deleteRow(r); });
  Logger.log('fixUnmatchedRows: deleted ' + toDelete.length + ' pre-Mar05 rows');

  // reload after deletions
  data = sheet.getDataRange().getValues();

  // ── 2. match map: BookingID → {conf, guest, room, ci, co, nights, net, status, note} ──
  var matchMap = {

    // 辉宫 Gong Hui (HMKSMSFWQJ) — 4 installments
    'SCB-2026-04-02-1923.36': {
      conf:'HMKSMSFWQJ', guest:'辉 宫 Gong Hui', room:'300',
      ci:'2026-04-01', co:'2026-04-13', nights:12, net:1923.36,
      status:'✅ Matched - Airbnb payout',
      note:'✅ Airbnb payout | 辉 宫(HMKSMSFWQJ) NET ฿1923.36 | Value Date: 2026-04-02'
    },
    'SCB-2026-04-07-2126.89': {
      conf:'HMKSMSFWQJ', guest:'辉 宫 Gong Hui', room:'300',
      ci:'2026-04-01', co:'2026-04-13', nights:12, net:2126.89,
      status:'✅ Matched - Airbnb payout',
      note:'✅ Airbnb payout | 辉 宫(HMKSMSFWQJ) NET ฿2126.89 | Value Date: 2026-04-07'
    },
    'SCB-2026-04-09-2201.90': {
      conf:'HMKSMSFWQJ', guest:'辉 宫 Gong Hui', room:'300',
      ci:'2026-04-01', co:'2026-04-13', nights:12, net:2201.90,
      status:'✅ Matched - Airbnb payout',
      note:'✅ Airbnb payout | 辉 宫(HMKSMSFWQJ) NET ฿2201.90 | Value Date: 2026-04-09'
    },
    'SCB-2026-04-21-943.21': {
      conf:'HMKSMSFWQJ', guest:'辉 宫 Gong Hui', room:'300',
      ci:'2026-04-01', co:'2026-04-13', nights:12, net:943.21,
      status:'✅ Matched - Airbnb payout',
      note:'✅ Airbnb payout | 辉 宫(HMKSMSFWQJ) NET ฿943.21 | Value Date: 2026-04-21'
    },

    // ALLARD Angélique — Booking.com → SCB Transfer Apr07
    'SCB-2026-04-07-980.93': {
      conf:'BKC-allardangl-20260330', guest:'ALLARD Angélique', room:'203',
      ci:'2026-03-30', co:'2026-04-01', nights:2, net:980.93,
      status:'✅ Matched - Booking.com remittance',
      note:'✅ Booking.com remittance | ALLARD Angélique NET ฿980.93 | Value Date: 2026-04-07'
    },

    // Ngân Nguyễn Thị (HM49DKJYBR) — initial payout Apr17
    'SCB-2026-04-17-4823.58': {
      conf:'HM49DKJYBR', guest:'Ngân Nguyễn Thị', room:'113',
      ci:'2026-04-16', co:'2026-04-25', nights:9, net:4823.58,
      status:'✅ Matched - Airbnb payout',
      note:'✅ Airbnb payout | Ngân Nguyễn Thị(HM49DKJYBR) NET ฿4823.58 | Value Date: 2026-04-17'
    },

    // Dave Casey (HMAXNAECPJ) — initial payout May16 (before checkout)
    'SCB-2026-05-16-1169.49': {
      conf:'HMAXNAECPJ', guest:'Dave Casey', room:'108',
      ci:'2026-05-15', co:'2026-05-17', nights:2, net:1169.49,
      status:'✅ Matched - Airbnb payout',
      note:'✅ Airbnb payout | Dave Casey(HMAXNAECPJ) NET ฿1169.49 | Value Date: 2026-05-16'
    },

    // Natthaphon Pakhothanang — Booking.com remittance May26
    'SCB-2026-05-26-1423.79': {
      conf:'BKC-natthaphon-20260513', guest:'Natthaphon Pakhothanang', room:'103',
      ci:'2026-05-13', co:'2026-05-15', nights:2, net:1423.79,
      status:'✅ Matched - Booking.com remittance',
      note:'✅ Booking.com remittance | Natthaphon Pakhothanang NET ฿1423.79 | Value Date: 2026-05-26'
    },

    // Trip.com confirmed matches
    'SCB-2026-03-27-1826.72': {
      conf:'1653712218028901', guest:'Javid Osborne/Sarina', room:'204',
      ci:'2026-03-17', co:'2026-03-21', nights:4, net:1826.72,
      status:'✅ Matched - Trip.com settlement',
      note:'✅ Trip.com settlement | Javid Osborne/Sarina(1653712218028901) NET ฿1826.72 | Value Date: 2026-03-27'
    },
    'SCB-2026-05-05-5555.03': {
      conf:'1622926832063903, 1622926832063939, 1400825520948811',
      guest:'BOONTUM/PAKPONG, YAMKAMOL/METAWEE, NAM/SANG WON',
      room:'300, 204, 108',
      ci:'', co:'', nights:'',
      net:5555.03,
      status:'✅ Matched - Trip.com settlement',
      note:'✅ Trip.com settlement | BOONTUM/PAKPONG(1622926832063903) ฿1750.78 | YAMKAMOL/METAWEE(1622926832063939) ฿2099.22 | NAM/SANG WON(1400825520948811) ฿1705.03 | Value Date: 2026-05-05'
    },

    // ── Early Mar — email ไม่ได้ parse, hardcode จาก invoice ─────
    'SCB-2026-03-02-14599.29': {
      conf:'HMR38XW4Z3, HMQDZAHYBE', guest:'Rica Chanel, Egor Lebedev', room:'300, 205',
      ci:'', co:'', nights:'', net:14599.29,
      status:'✅ Matched - Airbnb payout',
      note:'✅ Airbnb payout | Rica Chanel(HMR38XW4Z3) room 300 + Egor Lebedev(HMQDZAHYBE) room 205 | Value Date: 2026-03-02'
    },
    'SCB-2026-03-04-18195.32': {
      conf:'', guest:'Shaokun Zhang', room:'300',
      ci:'', co:'', nights:'', net:18195.32,
      status:'✅ Matched - Expedia remittance',
      note:'✅ Expedia remittance | Shaokun Zhang room 300 | Value Date: 2026-03-04'
    },
    'SCB-2026-03-04-997.34': {
      conf:'HM529FX8QH', guest:'Gabriel Carletto Cousseau', room:'214',
      ci:'', co:'', nights:'', net:997.34,
      status:'✅ Matched - Airbnb payout',
      note:'✅ Airbnb payout | Gabriel Carletto Cousseau(HM529FX8QH) room 214 | Value Date: 2026-03-04'
    },
    'SCB-2026-03-12-1396.26': {
      conf:'', guest:'Songwut Heraphiwatthana', room:'113',
      ci:'', co:'', nights:'', net:1396.26,
      status:'✅ Matched - Expedia remittance',
      note:'✅ Expedia remittance | Songwut Heraphiwatthana room 113 | Value Date: 2026-03-12'
    },
    'SCB-2026-03-21-15105.30': {
      conf:'HMP9HW25EN', guest:'Hélèm Saouchi', room:'363',
      ci:'', co:'', nights:'', net:15105.30,
      status:'✅ Matched - Airbnb payout',
      note:'✅ Airbnb payout | Hélèm Saouchi(HMP9HW25EN) room 363 | Value Date: 2026-03-21'
    },
    'SCB-2026-03-30-13497.52': {
      conf:'HM8QEMEYDM', guest:'Amir Hayes', room:'205',
      ci:'', co:'', nights:'', net:13497.52,
      status:'✅ Matched - Airbnb payout',
      note:'✅ Airbnb payout | Amir Hayes(HM8QEMEYDM) room 205 | Value Date: 2026-03-30'
    }
  };

  // ── 3. apply matches ──────────────────────────────────────────
  var updated = 0;
  // reload again after potential deletions
  data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var bid = (data[i][C_BID] || '').toString().trim();
    var m   = matchMap[bid];
    if (!m) continue;
    var r = i + 1;
    if (m.conf)   sheet.getRange(r, C_CONF+1).setValue(m.conf);
    if (m.guest)  sheet.getRange(r, C_GUEST+1).setValue(m.guest);
    if (m.room)   sheet.getRange(r, C_ROOM+1).setValue(m.room);
    if (m.ci)     sheet.getRange(r, C_CI+1).setValue(m.ci);
    if (m.co)     sheet.getRange(r, C_CO+1).setValue(m.co);
    if (m.nights !== '') sheet.getRange(r, C_N+1).setValue(m.nights);
    if (m.net)    sheet.getRange(r, C_NET+1).setValue(m.net);
                  sheet.getRange(r, C_STATUS+1).setValue(m.status);
                  sheet.getRange(r, C_NOTE+1).setValue(m.note);
    updated++;
    Logger.log('fixUnmatchedRows: matched ' + bid);
  }
  Logger.log('fixUnmatchedRows: updated ' + updated + ' rows');
  SpreadsheetApp.flush();
}

function parseDate_(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  var s = v.toString().trim();
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}




// ═══════════════════════════════════════════════════════════════
// AUTO-STYLE Sheet1 on edit — แก้ปัญหาเพิ่ม/ยกเลิก booking แล้ว style ไม่ run
// ต้องรัน createSheet1EditTrigger() ครั้งเดียวใน Apps Script editor เพื่อติดตั้ง trigger
// ═══════════════════════════════════════════════════════════════
function onEditStyleSheet1(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet();
    if (sh.getName() !== 'Sheet1') return;
    if (e.range.getRow() === 1) return; // แก้แค่ header ไม่ต้อง restyle

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) {
      Logger.log('onEditStyleSheet1: ชีตล็อกอยู่ (edit อื่นกำลังรัน) — ข้าม');
      return;
    }
    try {
      styleSheet1();
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    Logger.log('onEditStyleSheet1 ERROR: ' + err.message);
  }
}

function createSheet1EditTrigger() {
  var ss = SpreadsheetApp.openById(MASTER_SHEET_ID);
  ScriptApp.getProjectTriggers()
    .filter(function(t){ return t.getHandlerFunction() === 'onEditStyleSheet1'; })
    .forEach(function(t){ ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('onEditStyleSheet1')
    .forSpreadsheet(ss)
    .onEdit()
    .create();
  Logger.log('Trigger: onEdit(Sheet1) → styleSheet1() ติดตั้งเรียบร้อย');
}

// ═══════════════════════════════════════════════════════════════
// ONE-OFF FIX: 2026-07-06 Moritz Reinhold Resolution Payout
// Backfills checkIn/checkOut/nights that were left blank by the
// Resolution Payout parsing bug (fixed in parseAirbnbEmail above).
// Run once from the Apps Script editor, then delete/ignore this fn.
// ═══════════════════════════════════════════════════════════════
function fixMoritzResolutionDates() {
  var ss = SpreadsheetApp.openById(MASTER_SHEET_ID);
  var sh = ss.getSheetByName(TAB_NAME);
  var data = sh.getDataRange().getValues();

  var targets = {
    'ABB-HMM2KX89SS-RES-20260706': true,
    'SCB-2026-07-06-1296.26': true
  };
  var ci = new Date('2026-07-04T00:00:00');
  var co = new Date('2026-07-07T00:00:00');
  var nights = 3;

  var fixed = [];
  for (var r = 1; r < data.length; r++) {
    var bid = String(data[r][C.bid - 1] || '').trim();
    if (!targets[bid]) continue;
    sh.getRange(r + 1, C.ci).setValue(ci);
    sh.getRange(r + 1, C.co).setValue(co);
    sh.getRange(r + 1, C.nights).setValue(nights);
    fixed.push(bid + ' (row ' + (r + 1) + ')');
  }

  Logger.log('fixMoritzResolutionDates: fixed ' + fixed.length + ' rows: ' + fixed.join(', '));
  return fixed;
}
