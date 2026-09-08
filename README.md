# payout-income-log

Google Apps Script สำหรับ **The Loft Living Space**  
ติดตาม Payout, Income และ Bank Ledger จาก OTA ต่างๆ

## Google Sheet
`1XbTJLhecql_HNqyE80Hc6h30A2_elIxliudF4e6Rlz0`

## Tabs
| Tab | คำอธิบาย |
|-----|----------|
| `Sheet1` | Reservation master (ห้อง, แขก, เช็คอิน/เอาท์) |
| `Payout_Income_Log` | Payout จาก Airbnb / Booking.com / Expedia / Trip.com |
| `Bank_Ledger` | สรุปยอดเงินเข้า SCB พร้อม match กับ OTA |

## OTA Sources
- **Airbnb** — email `automated@airbnb.com` (Payout batches)
- **Booking.com / Expedia** — email `no-reply@app.littlehotelier.com` (Little Hotelier)
- **Trip.com** — email `noreply_htl@trip.com`
- **SCB** — email `No_reply_scbbusinessalert@scb.co.th`
- **PayPal** (direct bookings) — email `service@paypal.com` / `paypal@e.paypal.com` / `member@paypal.com`.
  Auto-withdraws to SCB once balance ≥ ฿5,000, so one SCB deposit can bundle
  several PayPal payments — matched by date window + fee-ratio sanity check
  (not exact-cents like Airbnb/Trip/Expedia, since PayPal's per-transaction
  fee isn't restated in the withdrawal). See `PayPalDirectBooking.gs` header
  for details and known limitations (parser unvalidated against a live email).

## Entry Points
| Function | ใช้เมื่อ |
|----------|----------|
| `fullRebuild()` | รันใหม่ทั้งหมดจาก email |
| `rematch()` | re-match SCB + room เฉพาะส่วน |
| `dailyEmailSync()` | trigger ทุก 1 ชั่วโมง |
| `createDailyTrigger()` | ตั้ง trigger ครั้งแรก |
| `rebuildBankLedger()` | rebuild Bank_Ledger tab เท่านั้น |
| `manualMatchSCBtoTrip()` | match SCB→Trip.com แบบ manual |

## Pipeline
```
parseEmails → appendRow → matchSCBtoOTA → matchRoomFromSheet1
            → applyManualRoomFixes → sortPayoutByOTA → rebuildBankLedger
```

## Room Map
| Room Name | Number |
|-----------|--------|
| Luxury | 300 |
| Retro | 108 |
| Elegance | 103 / 204 |
| Allure | 203 / 205 |
| Legacy | 113 / 214 |
| Radiance | 105 / 211 |
| Rhythm | 112 / 208 |
| Greenery | 104 / 207 |
| Serene | 209 / 210 |
| Mycondo A/B | 363 |

## Changelog
### v21 (2026-09-09)
- เพิ่ม `PayPalDirectBooking.gs` — PayPal เป็น income source ใหม่ สำหรับ direct booking guest
- `parsePayPalEmail()` / `parsePayPalEmailRows()` — parse email "payment received" จาก PayPal (ยังไม่ได้ validate กับ email จริง)
- `matchSCBtoPayPal()` — match SCB deposit → PayPal batch ด้วย date window + fee-ratio (0–10%) แทน exact-cents subset-sum เพราะ PayPal หัก fee ต่อ transaction
- `recordKnownPayPalPayments_20260909()` — one-off บันทึก Kari Ramsey (฿5,892.00) + Florian Lintner (฿800.00) รอ SCB ฿6,353.40 (คาดถึง 17/9/2026)
- `fullRebuild()` / `dailyEmailSync()` / `quickReformat()` เรียก `matchSCBtoPayPal()` ต่อจาก `matchSCBtoOTA()`
- `OTA_ORDER` / `OTA_BG` เพิ่ม 'PayPal'

### v20 (2026-06)
- เพิ่ม `MANUAL_ROOM_FIXES[]` — hardcode fix สำหรับ Trip.com/Expedia ที่ match ไม่ได้
- เพิ่ม `applyManualRoomFixes()` — รัน pass สุดท้ายหลัง `matchRoomFromSheet1()`
- `roomFromText()` รู้จัก mycondo/363 → `'363'`
- `dailyEmailSync()` + `fullRebuild()` รัน `rebuildBankLedger()` ทุกครั้ง
- Trigger เปลี่ยนจาก daily → ทุก 1 ชั่วโมง

### v19
- `rebuildBankLedger()` แยก tab `Bank_Ledger`
- SCB sub-row formatting (bold total / italic sub)

### v18
- `matchRoomFromSheet1()` — lookup ห้องจาก Sheet1 ด้วย guest name + check-in date

### v17
- `matchSCBtoOTA()` — match SCB batch กับ Airbnb/Trip.com/Expedia
