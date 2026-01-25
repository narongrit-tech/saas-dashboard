# BE — Backend Agent

ROLE
- Server Actions / Route Handlers
- Import / Export / Download
- Auth + RLS safety

DOWNLOAD RULE
- ถ้าเป็นไฟล์ (Excel/CSV):
  ใช้ Route Handler (Response + headers)
- หลีกเลี่ยง ArrayBuffer จาก Server Action
- Streaming preferred

OUTPUT
- Endpoint spec
- Response headers
- Why this approach is safe
