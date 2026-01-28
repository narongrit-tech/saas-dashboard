# Sales Orders Pagination - Manual Test Checklist

## วัตถุประสงค์
ทดสอบการทำงานของ pagination/perPage ในหน้า Sales Orders ให้แน่ใจว่าแสดงข้อมูลถูกต้องและไม่ซ้ำกัน

## ข้อมูลทดสอบ
- Total sales_orders: ~1432 รายการ
- URL: http://localhost:3000/sales

## Test Cases

### Test A: perPage=20 และเปลี่ยน page ต้องไม่ซ้ำ
- [ ] 1. เปิดหน้า /sales (default perPage=20, page=1)
- [ ] 2. บันทึก order_id 3 รายการแรก
- [ ] 3. กดปุ่ม "Next" ไปหน้า 2
- [ ] 4. ตรวจสอบว่า order_id ที่หน้า 2 ไม่ซ้ำกับหน้า 1
- [ ] 5. กดปุ่ม "Next" ไปหน้า 3
- [ ] 6. ตรวจสอบว่า order_id ที่หน้า 3 ไม่ซ้ำกับหน้า 1 และ 2
- [ ] 7. กดปุ่ม "Previous" กลับหน้า 2
- [ ] 8. ตรวจสอบว่า order_id เหมือนกับที่บันทึกไว้ในขั้นตอน 4

**Expected:**
- แต่ละหน้าแสดง order_id ไม่ซ้ำกัน
- กลับไปหน้าเดิมได้ข้อมูลเหมือนเดิม

---

### Test B: perPage=50 ต้องได้ 50 แถว และหน้า 2 ต้องเป็นแถวถัดไป
- [ ] 1. เปลี่ยน perPage เป็น 50
- [ ] 2. ตรวจสอบว่าหน้า 1 แสดง 50 แถว (ถ้า total >= 50)
- [ ] 3. บันทึก order_id แถวสุดท้าย (แถวที่ 50)
- [ ] 4. กดปุ่ม "Next" ไปหน้า 2
- [ ] 5. บันทึก order_id แถวแรกของหน้า 2 (แถวที่ 51)
- [ ] 6. ตรวจสอบว่า order_id แถวแรกของหน้า 2 ไม่เท่ากับแถวสุดท้ายของหน้า 1

**Expected:**
- หน้า 1 แสดง 50 แถว
- หน้า 2 แสดงแถวที่ 51-100 (ไม่ซ้ำกับหน้า 1)
- Total count ถูกต้อง (แสดง "แสดง 1 ถึง 50 จากทั้งหมด 1432 รายการ")

---

### Test C: perPage=100 ต้องไม่ error
- [ ] 1. เปลี่ยน perPage เป็น 100
- [ ] 2. ตรวจสอบว่าไม่มี error ใน console
- [ ] 3. ตรวจสอบว่าหน้า 1 แสดง 100 แถว (ถ้า total >= 100)
- [ ] 4. กดปุ่ม "Next" ไปหน้า 2
- [ ] 5. ตรวจสอบว่าแสดงแถวที่ 101-200 ถูกต้อง
- [ ] 6. ตรวจสอบว่า pagination controls แสดงถูกต้อง (เช่น "/ 15" ถ้า total=1432)

**Expected:**
- ไม่มี error
- แสดงข้อมูล 100 แถวต่อหน้าถูกต้อง
- Total pages = Math.ceil(1432 / 100) = 15

---

### Test D: หน้าสุดท้าย (last page) แสดงได้
- [ ] 1. ตั้ง perPage=20
- [ ] 2. คำนวณ last page = Math.ceil(1432 / 20) = 72
- [ ] 3. พิมพ์เลขหน้า 72 ใน input box และกด Enter
- [ ] 4. ตรวจสอบว่าแสดงแถวสุดท้าย (แถวที่ 1421-1432, ควรได้ 12 แถว)
- [ ] 5. ตรวจสอบว่าปุ่ม "Next" ถูก disabled
- [ ] 6. ตรวจสอบ console log ว่ามี query params ที่ถูกต้อง:
   ```
   page: 72
   perPage: 20
   offset: 1420
   from: 1420
   to: 1439
   ```

**Expected:**
- หน้าสุดท้ายแสดงแถวที่เหลือได้ถูกต้อง (12 แถว)
- ปุ่ม "Next" ถูก disabled
- "แสดง 1421 ถึง 1432 จากทั้งหมด 1432 รายการ"

---

### Test E: Jump to page ที่ใช้งานได้
- [ ] 1. ตั้ง perPage=20
- [ ] 2. พิมพ์เลขหน้า 10 ใน input box
- [ ] 3. ตรวจสอบว่า URL เปลี่ยนเป็น ?page=10
- [ ] 4. ตรวจสอบว่าแสดงแถวที่ 181-200
- [ ] 5. ตรวจสอบ console log ว่ามี:
   ```
   page: 10
   perPage: 20
   offset: 180
   from: 180
   to: 199
   ```

**Expected:**
- Jump to page ทำงานถูกต้อง
- แสดงแถวที่ถูกต้องตาม offset calculation

---

### Test F: เปลี่ยน perPage รีเซ็ต page=1
- [ ] 1. ไปหน้า 5 (perPage=20)
- [ ] 2. เปลี่ยน perPage เป็น 50
- [ ] 3. ตรวจสอบว่า page รีเซ็ตเป็น 1
- [ ] 4. ตรวจสอบ URL ว่าเป็น ?perPage=50 (ไม่มี &page=5)

**Expected:**
- เมื่อเปลี่ยน perPage จะรีเซ็ต page เป็น 1 อัตโนมัติ

---

### Test G: กรองข้อมูล + pagination
- [ ] 1. ตั้งค่า filter: Platform = "TikTok", perPage=20
- [ ] 2. ตรวจสอบว่า total count เปลี่ยนไป (น้อยกว่า 1432)
- [ ] 3. กดปุ่ม "Next" ไปหน้า 2
- [ ] 4. ตรวจสอบว่าข้อมูลหน้า 2 เป็นของ TikTok ทั้งหมด
- [ ] 5. เปลี่ยน Platform เป็น "All Platforms"
- [ ] 6. ตรวจสอบว่า page รีเซ็ตเป็น 1 และ total count กลับมาเป็น 1432

**Expected:**
- Pagination ทำงานร่วมกับ filter ได้ถูกต้อง
- เปลี่ยน filter รีเซ็ต page=1

---

## Console Logs ที่ต้องเช็ค

ในแต่ละ test case ให้เปิด DevTools Console และตรวจสอบ logs:

1. **[Sales Pagination Debug] Query params:**
   - ต้องแสดง page, perPage, offset, from, to ที่ถูกต้อง
   - offset = (page - 1) * perPage
   - from = offset
   - to = offset + perPage - 1

2. **[Sales Pagination Debug] Query results:**
   - rows = จำนวนแถวที่ได้รับจริง (ไม่เกิน perPage)
   - count = total จำนวนทั้งหมด
   - error = null (ถ้าสำเร็จ)

3. **ไม่มี error log:**
   - ไม่มี `[Sales Pagination Error]:`
   - ไม่มี Supabase error

---

## หมายเหตุ

- ถ้าพบข้อมูลซ้ำกัน → pagination offset คำนวณผิด
- ถ้า perPage=50/100 แล้ว error → ตรวจสอบ clamping และ range() ของ Supabase
- ถ้า last page แสดงไม่ได้ → ตรวจสอบการคำนวณ totalPages

---

## ผลการทดสอบ

Date: _____________
Tester: _____________

| Test Case | Pass | Fail | Note |
|-----------|------|------|------|
| Test A    | [ ]  | [ ]  |      |
| Test B    | [ ]  | [ ]  |      |
| Test C    | [ ]  | [ ]  |      |
| Test D    | [ ]  | [ ]  |      |
| Test E    | [ ]  | [ ]  |      |
| Test F    | [ ]  | [ ]  |      |
| Test G    | [ ]  | [ ]  |      |

**Overall Result:** Pass [ ] / Fail [ ]
