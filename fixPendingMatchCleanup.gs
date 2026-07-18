/**
 * fixPendingMatchCleanup.gs
 *
 * รัน function เดียวนี้เพื่อจัดการ 7 booking ที่ปิดจบแล้วใน pending-match list
 * ให้หลุดออกจาก "รอ match" list ทันที
 *
 * กลุ่ม 1 - ยกเลิกจริง (ยืนยันจากอีเมล Cancellation) -> mark ห้อง="ยกเลิก", สถานะ="ยกเลิก (ไม่มีค่าธรรมเนียม)"
 *   - JELLUM, JOHN            Expedia  #2472443860#  cancelled 2026-05-31
 *   - Liu, Ananyaphorn        Expedia  #2457884670#  cancelled 2026-05-12
 *   - Nonthanan, AR           Expedia  #2457529951#  cancelled 2026-05-11
 *   - MAUNG/THET LYNN         Trip.com #1688898602772666# cancelled (no fee)
 *   - PONPIAN/NAPADA          Trip.com #1622924258510520# cancelled (no fee)
 *
 * กลุ่ม 2 - match แล้วจริงแต่ยอด parse จากอีเมลต่ำกว่าจริง (Booking.com ไม่เคยส่งยอดโอนจริงทางอีเมลก่อนหน้านี้)
 *   -> อัปเดต NET ให้ตรงยอดจริงที่โอน และปรับสถานะเป็น Matched
 *   - Angélique, ALLARD       Booking.com #6148157193#  NET จริง 980.93 (เดิม parse ได้ 583.99)
 *   - Pakhothanang, Natthaphon Booking.com #6339174127# NET จริง 1423.79 (เดิม parse ได้ 873.79)
 */
function fixPendingMatchCleanup() {
  const SHEET_ID = '1XbTJLhecql_HNqyE80Hc6h30A2_elIxliudF4e6Rlz0';
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('Payout_Income_Log');
  const data = sheet.getDataRange().getValues();
  const header = data[0];

  const col = {
    bookingId: header.indexOf('Booking ID'),
    room: header.indexOf('ห้อง'),
    net: header.indexOf('NET (THB)'),
    status: header.indexOf('สถานะ'),
    note: header.indexOf('หมายเหตุ'),
  };

  // --- กลุ่ม 1: ยกเลิกจริง ---
  const cancellations = {
    '2472443860': { guest: 'JELLUM, JOHN', source: 'Expedia', date: '2026-05-31' },
    '2457884670': { guest: 'Liu, Ananyaphorn', source: 'Expedia', date: '2026-05-12' },
    '2457529951': { guest: 'Nonthanan, AR', source: 'Expedia', date: '2026-05-11' },
    '1688898602772666': { guest: 'MAUNG/THET LYNN', source: 'Trip.com', date: null },
    '1622924258510520': { guest: 'PONPIAN/NAPADA', source: 'Trip.com', date: null },
  };

  // --- กลุ่ม 2: match แล้วแต่ยอด NET ต้อง correct ---
  const corrections = {
    '6148157193': { guest: 'Angélique, ALLARD', correctNet: 980.93 },
    '6339174127': { guest: 'Pakhothanang, Natthaphon', correctNet: 1423.79 },
  };

  let cancelled = 0;
  let corrected = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const bookingId = String(row[col.bookingId]);
    const rowNum = i + 1;

    if (cancellations[bookingId]) {
      const info = cancellations[bookingId];
      sheet.getRange(rowNum, col.room + 1).setValue('ยกเลิก');
      sheet.getRange(rowNum, col.status + 1).setValue('ยกเลิก (ไม่มีค่าธรรมเนียม)');
      const noteText = info.date
        ? `ยกเลิกการจอง | ${info.source} booking #${bookingId}# | ยืนยันจากอีเมล Cancellation (${info.date}) | ยืนยันโดย Nathan 2026-07-18`
        : `ยกเลิกการจอง | ${info.source} booking #${bookingId}# | ไม่มีค่าธรรมเนียมยกเลิก | ยืนยันโดย Nathan 2026-07-17`;
      sheet.getRange(rowNum, col.note + 1).setValue(noteText);
      cancelled++;
      Logger.log('Cancelled row ' + rowNum + ' - ' + info.guest);
    }

    if (corrections[bookingId]) {
      const info = corrections[bookingId];
      const oldNet = row[col.net];
      sheet.getRange(rowNum, col.net + 1).setValue(info.correctNet);
      sheet.getRange(rowNum, col.status + 1).setValue('✅ Matched - Booking.com remittance');
      sheet.getRange(rowNum, col.note + 1).setValue(
        `✅ Matched - Booking.com remittance | NET จริง ฿${info.correctNet} (สูงกว่ายอด parse จากอีเมลแรก ฿${oldNet}) | ` +
        `สาเหตุ: Booking.com ไม่ส่งยอดโอนจริงทางอีเมลก่อนหน้านี้ ต้องเช็คใน app เอง | ยืนยันโดย Nathan 2026-07-17`
      );
      corrected++;
      Logger.log('Corrected row ' + rowNum + ' - ' + info.guest + ' NET ' + oldNet + ' -> ' + info.correctNet);
    }
  }

  Logger.log('Done. Cancelled: ' + cancelled + ', Corrected: ' + corrected);
}
