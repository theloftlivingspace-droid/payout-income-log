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
  { conf:'HM3A89NS8M', room:'214' },  // Josh Cadle
  { conf:'HM529FX8QH', room:'214' },  // Gabriel Carletto
  { conf:'HMMWTMN5QS', room:'113' },  // Lona Lee
  { conf:'HMCBAE24X2', room:'214' },  // Gabriel Carletto
  { conf:'HMDKRWE9ST', room:'214' },  // Laurent Pierre Noguer
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
];

// ═══════════════════════════════════════════════════════════════
// ENTRY POINTS
// ═══════════════════════════════════════════════════════════════
function fullRebuild() {
  var sheet = setupSheet();
  clearDataRows(sheet);
  var airbnbRows = fetchAirbnbPayouts();
  var lhRows     = fetchLittleHotelierBookings();
  var tripRows   = fetchTripComBookings();
  var scbRows    = fetchSCBAlerts().filter(function(r){
    return (r.date||'') >= '2026-03-01';
  });

  var all = [].concat(airbnbRows, lhRows, tripRows, scbRows);
  var seen = {}, unique = [];
  all.forEach(function(r) {
    if (!seen[r.bookingId]) { seen[r.bookingId] = true; unique.push(r); }
  });

  var order = {'Airbnb':1,'Booking.com':2,'Expedia':3,'Trip.com':4};
  unique.sort(function(a,b) {
    var oa = order[a.ota]||5, ob = order[b.ota]||5;
    return oa !== ob ? oa-ob : (a.date||'').localeCompare(b.date||'');
  });

  unique.forEach(function(r){ appendRow(sheet, r); });
  matchSCBtoOTA(sheet);
  matchRoomFromSheet1();
  applyManualRoomFixes();
  sortPayoutByOTA(sheet);
  rebuildBankLedger();

  var msg = 'Rebuild เสร็จ: Airbnb='+airbnbRows.length+' LH='+lhRows.length+
            ' Trip='+tripRows.length+' SCB='+scbRows.length+
            ' | Bank_Ledger updated';
  Logger.log(msg);
  SpreadsheetApp.getActiveSpreadsheet().toast(msg, 'Done', 8);
}

function rematch() {
  var ss = SpreadsheetApp.openById(MASTER_SHEET_ID);
  var sheet = ss.getSheetByName(TAB_NAME);
  matchSCBtoOTA(sheet);
  matchRoomFromSheet1();
  applyManualRoomFixes();
  SpreadsheetApp.getActiveSpreadsheet().toast('Rematch เสร็จ', 'Done', 3);
}

function dailyEmailSync() {
  var yday = new Date(); yday.setDate(yday.getDate()-1);
  var since = Utilities.formatDate(yday,'Asia/Bangkok','yyyy/MM/dd');
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
          if (!existing.has(r.bookingId)) { newRows.push(r); existing.add(r.bookingId); }
        }); } catch(e){ Logger.log('ERR: '+e.message); }
      });
    });
  });

  newRows.forEach(function(r){ appendRow(sheet,r); });
  matchSCBtoOTA(sheet);
  matchRoomFromSheet1();
  applyManualRoomFixes();
  sortPayoutByOTA(sheet);
  rebuildBankLedger();

  Logger.log('daily: +'+newRows.length+' new rows | Bank_Ledger rebuilt');
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
  var rows = [], seen = {};
  GmailApp.search(q, 0, limit).forEach(function(t) {
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
    var gam = ln.match(/^(.+?)\s{2,}[฿\u0e3f]([\d,]+\.\d+)\s*THB$/i);
    if (!gam) { i++; continue; }
    var guest = gam[1].trim();
    var net   = gam[2].replace(/,/g,'');
    if (!guest||guest.length<2) { i++; continue; }
    if (/^(Total paid|Details|Bank account|Airbnb account|Get help|View)/i.test(guest)) { i++; continue; }

    var homeLine='',listLine='',confCode='';
    var checkIn='',checkOut='',isRes=false,resDate='';
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
      } else if (homeLine&&!listLine&&nl.indexOf('(')>=0) {
        listLine=nl;
      } else if (homeLine&&!listLine&&!confCode&&/^The Loft|Loft|loft/i.test(nl)) {
        listLine=nl;
      } else if ((homeLine||listLine)&&!confCode&&/^[A-Z0-9]{8,12}$/.test(nl)) {
        confCode=nl; break;
      } else if (homeLine&&!confCode&&!listLine&&/^[A-Z0-9]{8,12}$/.test(nl)) {
        confCode=nl; break;
      }
    }

    var bookingId = confCode
      ? 'ABB-'+confCode+(isRes?'-RES-'+dt.replace(/-/g,''):'')
      : 'ABB-'+dt.replace(/-/g,'')+'-'+rows.length+(isRes?'-RES':'');

    rows.push(makeRow('Airbnb',dt,bookingId,confCode,
      guest, roomFromText(listLine),
      checkIn,checkOut,
      checkIn&&checkOut?nightsBetween(checkIn,checkOut):'',
      batchTotal,'',net,
      isRes?'โอนแล้ว (Resolution Payout)':'โอนแล้ว',
      isRes
        ?'Resolution Payout | '+resDate+' | Batch THB '+batchTotal+' | ส่ง '+dt
        :'Airbnb Batch THB '+batchTotal+' | ส่ง '+dt));

    if (confCode) {
      var ci2=lines.indexOf(confCode,i+1);
      i=ci2>=0?ci2+1:i+5;
    } else { i+=4; }
  }
  Logger.log('parseAirbnb "'+msg.getSubject()+'": '+rows.length+' bookings');
  return rows;
}

function decodeQP(s) {
  return s.replace(/((?:=[0-9A-Fa-f]{2})+)/g,function(match) {
    try {
      var bytes=[];
      match.split('=').filter(Boolean).forEach(function(h){ bytes.push(parseInt(h,16)); });
      return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
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
// ═══════════════════════════════════════════════════════════════
function matchSCBtoAirbnb(sheet) { matchSCBtoOTA(sheet); }

function matchSCBtoOTA(sheet) {
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
      room:  isValidRoom(roomRaw)?roomRaw:'?',
      ci:    row[C.ci-1], co:row[C.co-1],
      nights:row[C.nights-1], net:fmtAmt(row[C.net-1])
    };
    if (conf&&/^[A-Z0-9]{8,12}$/.test(conf)) detailByConf[conf]=entry;
    if (bid) detailByBid[bid]=entry;
    var gk2=normG(guestRaw);
    if (gk2) detailByBid['guest:'+gk2]=entry;
  });

  var airbnbBatches={}, tripNets={}, expediaNets={};
  data.forEach(function(row) {
    var ota=(row[C.ota-1]||'').toString().trim();
    var net=fmtAmt(row[C.net-1]);
    if (!net||net==='0.00') return;
    var raw=row[C.date-1];
    var dt=raw instanceof Date
      ?Utilities.formatDate(raw,'Asia/Bangkok','yyyy-MM-dd')
      :raw.toString().substring(0,10);

    if (ota==='Airbnb') {
      var bt=fmtAmt(row[C.total-1]);
      if (!bt||bt==='0.00') return;
      var key=bt+'|'+dt+'|Airbnb';
      if (!airbnbBatches[key]) airbnbBatches[key]={guests:[],confs:[],nets:[],date:dt,total:bt};
      airbnbBatches[key].guests.push((row[C.guest-1]||'').toString());
      airbnbBatches[key].confs.push((row[C.conf-1]||'').toString());
      airbnbBatches[key].nets.push((row[C.net-1]||'').toString());
    }
    if (ota==='Trip.com'||ota==='Expedia') {
      var map=ota==='Trip.com'?tripNets:expediaNets;
      var key=net+'|'+dt.substring(0,7)+'|'+ota;
      if (!map[key]) map[key]={guests:[],bids:[],nets:[],total:net,ota:ota};
      map[key].guests.push((row[C.guest-1]||'').toString());
      map[key].bids.push((row[C.bid-1]||'').toString());
      map[key].nets.push((row[C.net-1]||'').toString());
    }
  });

  var replacements=[];
  data.forEach(function(row,i) {
    var ota  =(row[C.ota-1]  ||'').toString();
    var notes=(row[C.notes-1]||'').toString();
    if (!ota.startsWith('SCB')) return;
    if (notes.indexOf('✅')===0) return;

    var scbAmt =fmtAmt(row[C.net-1]);
    var rawD   =row[C.date-1];
    var scbDate=rawD instanceof Date
      ?Utilities.formatDate(rawD,'Asia/Bangkok','yyyy-MM-dd')
      :rawD.toString().substring(0,10);
    var scbOTA =(row[C.ota-1]||'').toString();
    var scbBid =(row[C.bid-1]||'').toString().trim();
    var acctM  =(row[C.notes-1]||'').toString().match(/x[\dX]+/);
    var scbAcct=acctM?acctM[0]:'x256221';

    var matchKey=null;
    Object.keys(airbnbBatches).forEach(function(k) {
      if (matchKey) return;
      var b=airbnbBatches[k];
      if (b.total!==scbAmt) return;
      var diff=Math.round((new Date(scbDate)-new Date(b.date))/86400000);
      if (diff>=-2&&diff<=7) matchKey=k;
    });
    if (matchKey) {
      var b=airbnbBatches[matchKey];
      replacements.push({deleteRow:i+2,
        insertRows:buildSCBRows(scbOTA,scbDate,scbBid,scbAmt,scbAcct,
          b.confs,b.guests,b.nets,detailByConf,{},'Airbnb payout')});
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
      delete expediaNets[expKeys[ei]]; return;
    }
  });

  Logger.log('matchSCBtoOTA: '+replacements.length+' SCB rows to expand');
  replacements.sort(function(a,b){ return b.deleteRow-a.deleteRow; });
  replacements.forEach(function(rep) {
    sheet.deleteRow(rep.deleteRow);
    var insertAt=rep.deleteRow;
    rep.insertRows.forEach(function(r,idx) {
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
    var room   = isValidRoom(detail.room) ? detail.room : '?';
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
    var detail=detailByConf[ref]||detailByBid[ref]||{};
    var room  =isValidRoom(detail.room)?detail.room:'?';
    var ci    =dateStr(detail.ci);
    var co    =dateStr(detail.co);
    var nts   =detail.nights||'';
    if (nts) { try { totalNights+=parseInt(nts); } catch(e){} }
    if (ci) { var ciD=new Date(ci); if (!earliest||ciD<earliest) earliest=ciD; }
    if (co) { var coD=new Date(co); if (!latest  ||coD>latest  ) latest  =coD; }
    allConfs.push(ref); allRooms.push(room); allGuests.push(guest);

    var subRow=makeRow(scbOTA,scbDate,scbBid,ref,
      guest,room,ci,co,nts,'','',net,'',
      '↳ '+guest+' ('+ref+') NET ฿'+net);
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
    '','','',
    scbAmt,'',scbAmt,'✅ Matched - '+payType,totalNote);
  totalRow._isTotal=true; totalRow._isSingle=false;
  rows.push(totalRow);
  return rows;
}

function dateStr(v) {
  if (!v) return '';
  if (v instanceof Date) return Utilities.formatDate(v,'Asia/Bangkok','yyyy-MM-dd');
  return v.toString().substring(0,10);
}

// ✅ NEW: Sheet1 ci/co fallback map
function getSheet1CiCoMap() {
  var ss = SpreadsheetApp.openById(MASTER_SHEET_ID);
  var s1 = ss.getSheets()[0];
  var data = s1.getDataRange().getValues();
  var map = {};
  var h = data[0].map(function(v){ return v.toString().trim().toLowerCase(); });
  var cG  = h.indexOf('ชื่อแขก');
  var cCI = h.indexOf('เช็คอิน');
  var cCO = h.indexOf('เช็คเอาท์');
  for (var i = 1; i < data.length; i++) {
    var g  = normG((data[i][cG]  || '').toString());
    var ci = dateStr(data[i][cCI]);
    var co = dateStr(data[i][cCO]);
    if (g && ci && co) {
      map[g] = { ci: ci, co: co, nights: nightsBetween(ci, co) };
    }
  }
  return map;
}

// ═══════════════════════════════════════════════════════════════
// MATCH ROOM FROM SHEET1
// ═══════════════════════════════════════════════════════════════
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

  var byGuest={}, byGuestAll={};
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
      if (isValidRoom(curRoomSCB)) continue;
      var guestForLookup='';
      if (notes.startsWith('↳')) {
        var subM=notes.match(/↳\s*([^(]+)\(/);
        guestForLookup=subM?subM[1].trim():'';
      } else if (notes.indexOf('✅')===0) {
        var totM=notes.match(/✅[^|]+\|\s*([^(]+)\(/);
        guestForLookup=totM?totM[1].trim():'';
      }
      if (!guestForLookup) continue;
      var ciSCB=pr[pCI]?new Date(pr[pCI]):null;
      var foundSCB=findRoom(guestForLookup,ciSCB,byGuestAll);
      if (foundSCB) {
        paySheet.getRange(i+1,pR+1).setValue(foundSCB);
        payData[i][pR]=foundSCB;
        updated++;
      }
      continue;
    }

    var curRoom=(pr[pR]||'').toString().trim();
    if (isValidRoom(curRoom)) continue;
    var guestRaw=(pr[pG]||'').toString().trim();
    if (!guestRaw||/^(รอ match)$/i.test(guestRaw)) continue;
    var ci=pr[pCI]?new Date(pr[pCI]):null;
    var found=findRoom(guestRaw,ci,byGuest);
    if (found) {
      paySheet.getRange(i+1,pR+1).setValue(found);
      payData[i][pR]=found;
      updated++;
    }
  }
  Logger.log('matchRoomFromSheet1: '+updated+' rows updated');
}

function findRoom(guestRaw,ci,byGuest) {
  var gk=normG(guestRaw);
  if (byGuest[gk]) {
    var cands=byGuest[gk];
    if (ci) {
      var dc=cands.filter(function(c){
        return c.ci&&Math.abs(ci.getTime()-c.ci.getTime())<2*86400000;
      });
      if (dc.length) return dc[0].room;
    }
    return cands[0].room;
  }
  var parts=gk.split(' ').filter(function(p){return p.length>2;});
  if (!parts.length) return null;
  var best=null, bestScore=0;
  Object.keys(byGuest).forEach(function(k) {
    var score=0;
    parts.forEach(function(p){ if (k.indexOf(p)>=0) score++; });
    if (score>bestScore) { bestScore=score; best=k; }
  });
  if (bestScore>=2&&best) {
    var cands=byGuest[best];
    if (ci) {
      var dc=cands.filter(function(c){
        return c.ci&&Math.abs(ci.getTime()-c.ci.getTime())<3*86400000;
      });
      if (dc.length) return dc[0].room;
    }
    return cands[0].room;
  }
  return null;
}

function normG(s) {
  return s.toString().toLowerCase()
    .replace(/[,\/\\]+/g,' ')
    .replace(/\s+/g,' ').trim();
}

// ═══════════════════════════════════════════════════════════════
// APPLY MANUAL ROOM FIXES
// ═══════════════════════════════════════════════════════════════
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

  var fixed = 0;
  for (var i = 0; i < data.length; i++) {
    var curRoom = (data[i][pRoom] || '').toString().trim();
    if (isValidRoom(curRoom)) continue;
    var notesVal = (data[i][pNotes] || '').toString().trim();
    var otaVal   = (data[i][pOTA]   || '').toString().trim();
    if (otaVal.startsWith('SCB') && (notesVal.startsWith('✅') || notesVal.startsWith('↳'))) continue;
    var bid  = (data[i][pBid]  || '').toString().trim();
    var conf = (data[i][pConf] || '').toString().trim();
    for (var fi = 0; fi < MANUAL_ROOM_FIXES.length; fi++) {
      var fix = MANUAL_ROOM_FIXES[fi];
      var matched = false;
      if (!matched && fix.conf && conf && conf === fix.conf) matched = true;
      if (!matched && fix.bid  && bid  && bid  === fix.bid)  matched = true;
      var guest = (data[i][pGuest] || '').toString().trim();
      if (!matched && fix.guest && guest && guest.toLowerCase() === fix.guest.toLowerCase()) matched = true;
      if (matched) {
        paySheet.getRange(i + 2, pRoom + 1).setValue(fix.room);
        data[i][pRoom] = fix.room;
        fixed++;
        Logger.log('applyManualRoomFixes: row '+(i+2)+' conf="'+conf+'" bid="'+bid+'" → '+fix.room);
        break;
      }
    }
  }
  Logger.log('applyManualRoomFixes: ' + fixed + ' rows fixed');
}

// ═══════════════════════════════════════════════════════════════
// AUDIT — ตรวจสอบความถูกต้องของข้อมูลใน Payout_Income_Log + Bank_Ledger
// ═══════════════════════════════════════════════════════════════
function auditSheet() {
  var ss = SpreadsheetApp.openById(MASTER_SHEET_ID);
  ['Payout_Income_Log','Bank_Ledger'].forEach(function(tabName) {
    var sh = ss.getSheetByName(tabName);
    if (!sh) { Logger.log(tabName + ': NOT FOUND'); return; }
    var last = sh.getLastRow();
    if (last < 2) { Logger.log(tabName + ': empty'); return; }
    var data = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
    var noRoom = 0, noGuest = 0, noCI = 0, noCO = 0;
    data.forEach(function(r, i) {
      var ota   = (r[C.ota-1]   || '').toString().trim();
      var bid   = (r[C.bid-1]   || '').toString().trim();
      var guest = (r[C.guest-1] || '').toString().trim();
      var room  = (r[C.room-1]  || '').toString().trim();
      var ci    = (r[C.ci-1]    || '').toString().trim();
      var co    = (r[C.co-1]    || '').toString().trim();
      var notes = (r[C.notes-1] || '').toString().trim();
      if (ota.startsWith('SCB') && notes.startsWith('↳')) return; // skip sub-rows
      if (!room || room === '?') {
        noRoom++;
        Logger.log('[NO ROOM] '+tabName+' row '+(i+2)+' | '+ota+' | guest:"'+guest+'" | bid:'+bid);
      }
      if (!guest) noGuest++;
      if (!ci && !ota.startsWith('SCB')) noCI++;
      if (!co && !ota.startsWith('SCB')) noCO++;
    });
    Logger.log('── '+tabName+' SUMMARY ('+data.length+' rows) ──');
    Logger.log('  ห้อง ? / ว่าง : ' + noRoom);
    Logger.log('  ไม่มีชื่อแขก   : ' + noGuest);
    Logger.log('  ไม่มี check-in : ' + noCI);
    Logger.log('  ไม่มี check-out: ' + noCO);
  });
}

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
    var ota  =(row[C.ota-1]  ||'').toString().trim();
    var notes=(row[C.notes-1]||'').toString().trim();
    var bid  =(row[C.bid-1]  ||'').toString().trim();
    if (ota==='Airbnb') return;                               // exclude Airbnb
    if (ota.startsWith('SCB')&&notes.startsWith('↳')) return; // exclude SCB sub-rows
    if (ota.startsWith('SCB')&&notes.startsWith('✅')) return; // exclude SCB total rows
    if (!ota || bid==='THB') return;                          // exclude summary/footer rows
    keepRows.push(row); keepFmts.push(srcFmts[i]);
  });

  blSheet.clearContents(); blSheet.clearFormats();
  var hRange=blSheet.getRange(1,1,1,HEADERS.length);
  hRange.setValues([HEADERS]);
  hRange.setBackground('#1a1a2e').setFontColor('#ffffff')
        .setFontWeight('bold').setFontSize(10)
        .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  blSheet.setFrozenRows(1);
  blSheet.showColumns(1, HEADERS.length);  // unhide all columns
  [110,110,180,140,200,80,105,105,55,110,115,110,200,300]
    .forEach(function(w,i){ blSheet.setColumnWidth(i+1,w); });

  if (keepRows.length>0) {
    var wr=blSheet.getRange(2,1,keepRows.length,HEADERS.length);
    wr.setValues(keepRows); wr.setBackgrounds(keepFmts);
    blSheet.getRange(2,10,keepRows.length,3).setNumberFormat('#,##0.00');
  }

  var sr=keepRows.length+3;
  blSheet.getRange(sr,1,1,4).merge()
    .setValue('สรุปยอดรายรับ Bank Ledger')
    .setBackground('#1a1a2e').setFontColor('#ffffff').setFontWeight('bold').setFontSize(11);
  sr++;
  var totals={},grand=0;
  keepRows.forEach(function(row){
    var ota=(row[C.ota-1]||'').toString();
    var net=parseAmt(row[C.net-1]);
    var key=ota.startsWith('SCB')
      ?(row[C.status-1]||'').toString().indexOf('✅')===0?'✅ SCB matched':'⚠️ รอ match'
      :ota;
    totals[key]=(totals[key]||0)+net; grand+=net;
  });
  Object.keys(totals).sort().forEach(function(k){
    var v=totals[k];
    var bg=k.startsWith('✅')?'#e8f5e9':k.startsWith('⚠️')?'#fff3e0':'#f0f8ff';
    blSheet.getRange(sr,1).setValue(k).setBackground(bg);
    blSheet.getRange(sr,2).setValue(v).setNumberFormat('#,##0.00').setFontWeight('bold').setBackground(bg);
    blSheet.getRange(sr,3).setValue('THB').setBackground(bg);
    sr++;
  });
  blSheet.getRange(sr,1).setValue('💰 รวม NET').setFontWeight('bold').setBackground('#c8e6c9');
  blSheet.getRange(sr,2).setValue(grand).setNumberFormat('#,##0.00').setFontWeight('bold').setBackground('#c8e6c9');
  blSheet.getRange(sr,3).setValue('THB').setFontWeight('bold').setBackground('#c8e6c9');
  Logger.log('rebuildBankLedger: '+keepRows.length+' rows');
  ss.setActiveSheet(blSheet);
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
    allData.forEach(function(row, i) {
      var notes = (row[C.notes-1] || '').toString();
      var rng = sheet.getRange(i+2, 1, 1, HEADERS.length);
      if (notes.startsWith('↳')) {
        rng.setFontWeight('normal').setFontStyle('italic').setFontColor('#444444');
      } else if ((row[C.ota-1] || '').toString().startsWith('SCB')) {
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
  matchRoomFromSheet1();
  applyManualRoomFixes();
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
        newRows.push(r); existing.add(r.bookingId); seen[r.bookingId]=true;
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
              newRows.push(r); existing.add(r.bookingId); seen[r.bookingId]=true;
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
    var scbDate=(data[scbRowIdx][C.date-1]||'').toString().substring(0,10);
    var scbOTA =(data[scbRowIdx][C.ota-1]||'').toString();
    var scbBid =(data[scbRowIdx][C.bid-1]||'').toString();

    var inserts=buildSCBRows(scbOTA,scbDate,scbBid,scbAmt,'x256221',
      batch.tripIds,
      batch.tripIds.map(function(b){ return tripIndex[b]?tripIndex[b].guest:'?'; }),
      batch.tripIds.map(function(b){ return tripIndex[b]?tripIndex[b].net.toFixed(2):'0'; }),
      {},detailByBid,'Trip.com settlement');

    var sr=scbRowIdx+2;
    sheet.deleteRow(sr);
    inserts.forEach(function(r,idx){
      sheet.insertRowBefore(sr+idx);
      sheet.getRange(sr+idx,1,1,HEADERS.length).setValues([[
        r.date,r.ota,r.bookingId,r.confCode,
        r.guest,r.room,r.checkIn,r.checkOut,r.nights,
        r.total,r.commission,r.net,r.status,r.notes
      ]]);
      var bg=(r._isTotal||r._isSingle)?SCB_TOTAL_BG:SCB_SUB_BG;
      sheet.getRange(sr+idx,1,1,HEADERS.length).setBackground(bg);
      if (r._isTotal||r._isSingle) sheet.getRange(sr+idx,1,1,HEADERS.length).setFontWeight('bold');
      else sheet.getRange(sr+idx,1,1,HEADERS.length).setFontStyle('italic').setFontColor('#444444');
      sheet.getRange(sr+idx,10,1,3).setNumberFormat('#,##0.00');
    });
    matched++;
  });
  Logger.log('manualMatchSCBtoTrip: '+matched+' matched');
  SpreadsheetApp.getActiveSpreadsheet().toast('Match Trip.com: '+matched+' รายการ','Done',4);
}

// ═══════════════════════════════════════════════════════════════
// SHEET1 STYLE
// ═══════════════════════════════════════════════════════════════
function styleSheet1(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var sh=ss.getSheetByName('Sheet1');
  if (!sh){ Logger.log('ไม่พบ Sheet1'); return; }
  sh.clearFormats();
  var lastRow=sh.getLastRow(), lastCol=7;
  sh.setColumnWidth(1,160); sh.setColumnWidth(2,180); sh.setColumnWidth(3,110);
  sh.setColumnWidth(4,110); sh.setColumnWidth(5,100); sh.setColumnWidth(6,220); sh.setColumnWidth(7,200);
  var header=sh.getRange(1,1,1,lastCol);
  header.setBackground('#1a1a2e').setFontColor('#ffffff').setFontWeight('bold')
        .setFontSize(11).setHorizontalAlignment('center').setVerticalAlignment('middle');
  sh.setRowHeight(1,36); sh.setFrozenRows(1);
  for (var r=2;r<=lastRow;r++){
    sh.getRange(r,1,1,lastCol)
      .setBackground(r%2===0?'#f8f9fa':'#ffffff')
      .setFontColor('#333333').setFontSize(10).setVerticalAlignment('middle');
    sh.setRowHeight(r,26);
  }
  var ROOM_COLORS={
    'luxury':{bg:'#fff3cd',font:'#856404'},'retro':{bg:'#d1ecf1',font:'#0c5460'},
    'elegance':{bg:'#d4edda',font:'#155724'},'allure':{bg:'#e2d9f3',font:'#4a235a'},
    'legacy':{bg:'#fde8d8',font:'#7d3c0a'},'radiance':{bg:'#d0f0fc',font:'#0a4d6e'},
    'cancel':{bg:'#f8d7da',font:'#721c24'},'ยกเลิก':{bg:'#f8d7da',font:'#721c24'},
    'no show':{bg:'#ffeeba',font:'#856404'}
  };
  var CHANNEL_COLORS={
    'Airbnb':{bg:'#ff5a5f',font:'#ffffff'},'Booking':{bg:'#003580',font:'#ffffff'},
    'Expedia':{bg:'#ffc72c',font:'#333333'},'Trip':{bg:'#00aaff',font:'#ffffff'},
    'Direct':{bg:'#28a745',font:'#ffffff'}
  };
  var dataVals=sh.getRange(2,1,lastRow-1,1).getValues();
  dataVals.forEach(function(row,i){
    var r=i+2, cv=(row[0]||'').toString().toLowerCase();
    var fullRow=sh.getRange(r,1,1,lastCol), cellA=sh.getRange(r,1);
    if (cv.indexOf('cancel')>=0||cv.indexOf('ยกเลิก')>=0){
      fullRow.setBackground(ROOM_COLORS['cancel'].bg).setFontColor(ROOM_COLORS['cancel'].font);
    } else if (cv.indexOf('no show')>=0){
      fullRow.setBackground(ROOM_COLORS['no show'].bg).setFontColor(ROOM_COLORS['no show'].font);
      cellA.setFontWeight('bold');
    } else {
      Object.keys(ROOM_COLORS).forEach(function(key){
        if (['cancel','ยกเลิก','no show'].indexOf(key)>=0) return;
        if (cv.indexOf(key)>=0) cellA.setBackground(ROOM_COLORS[key].bg)
          .setFontColor(ROOM_COLORS[key].font).setFontWeight('bold');
      });
    }
  });
  var chanData=sh.getRange(2,5,lastRow-1,1).getValues();
  chanData.forEach(function(row,i){
    var r=i+2, ch=(row[0]||'').toString().trim(), cell=sh.getRange(r,5);
    Object.keys(CHANNEL_COLORS).forEach(function(key){
      if (ch.toLowerCase().indexOf(key.toLowerCase())>=0)
        cell.setBackground(CHANNEL_COLORS[key].bg).setFontColor(CHANNEL_COLORS[key].font)
            .setFontWeight('bold').setHorizontalAlignment('center');
    });
  });
  var noteData=sh.getRange(2,7,lastRow-1,1).getValues();
  noteData.forEach(function(row,i){
    if ((row[0]||'').toString().trim())
      sh.getRange(i+2,7).setBackground('#fff8e1').setFontColor('#5d4037').setFontStyle('italic');
  });
  sh.getRange(2,3,lastRow-1,2).setHorizontalAlignment('center');
  var SH=['เลขห้อง','ชื่อแขก','เช็คอิน','เช็คเอาท์','Channel','ResId','Note'];
  sh.getRange(1,1,1,lastCol).setValues([SH]);
  sh.getRange(1,1,lastRow,lastCol).setBorder(true,true,true,true,false,false,'#cccccc',SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange(2,1,lastRow-1,lastCol).setBorder(false,false,false,false,false,true,'#e0e0e0',SpreadsheetApp.BorderStyle.SOLID);
  SpreadsheetApp.flush();
  Logger.log('styleSheet1: เสร็จแล้ว');
}

// ═══════════════════════════════════════════════════════════════
// WEB APP
// ═══════════════════════════════════════════════════════════════
function doGet(e){
  var p=e&&e.parameter?e.parameter:{};
  if (p.page==='dashboard'){
    return HtmlService.createHtmlOutputFromFile('LoftDashboard')
      .setTitle('The Loft — Reservations Dashboard')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  if (p.api==='1') return getDashboardData();
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
  if (/retro/.test(s))    return '108';
  if (/luxury/.test(s))   return '300';
  if (/elegance|legacy|allure|radiance|serene|greenery|rhythm/.test(s)) return '?';
  var m=s.match(/^(\d{3}(?:\/\d{3})?)/);
  if (m) return m[1];
  return '?';
}
function isValidRoom(r){
  if (!r) return false;
  var s=r.toString().trim();
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
  return sheet;
}
function clearDataRows(sheet){
  var last=sheet.getLastRow();
  if (last>1) sheet.getRange(2,1,last-1,HEADERS.length).clearContent().clearFormat();
}
function getExistingIds(sheet){
  var last=sheet.getLastRow();
  if (last<2) return new Set();
  return new Set(sheet.getRange(2,3,last-1,1).getValues().flat().filter(Boolean));
}
function appendRow(sheet,row){
  var r=sheet.getLastRow()+1;
  sheet.getRange(r,1,1,HEADERS.length).setValues([[
    row.date,row.ota,row.bookingId,row.confCode,
    row.guest,row.room,row.checkIn,row.checkOut,row.nights,
    row.total,row.commission,row.net,row.status,row.notes
  ]]);
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

