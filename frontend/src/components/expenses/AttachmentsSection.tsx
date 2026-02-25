'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { ExpenseAttachment, ExpenseStatus } from '@/types/expenses'
import { saveAttachmentMetadata, deleteAttachment, getExpenseAttachments } from '@/app/(dashboard)/expenses/actions'
import { Loader2, Paperclip, Trash2, Download, FileImage, FileText } from 'lucide-react'
import { getBangkokNow, formatBangkok } from '@/lib/bangkok-time'

interface AttachmentsSectionProps {
  expenseId: string
  expenseStatus: ExpenseStatus
  onUpdate?: () => void
}

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
const MAX_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function FileIcon({ fileType }: { fileType?: string | null }) {
  if (fileType === 'application/pdf') {
    return <FileText className="h-4 w-4 text-red-500 shrink-0" />
  }
  return <FileImage className="h-4 w-4 text-blue-500 shrink-0" />
}

export function AttachmentsSection({
  expenseId,
  expenseStatus,
  onUpdate,
}: AttachmentsSectionProps) {
  const [attachments, setAttachments] = useState<ExpenseAttachment[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadAttachments()
  }, [expenseId])

  const loadAttachments = async () => {
    setLoading(true)
    const result = await getExpenseAttachments(expenseId)
    if (result.success && result.data) {
      setAttachments(result.data)
    }
    setLoading(false)
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Reset input so the same file can be re-selected
    e.target.value = ''

    setError(null)

    // Validate type
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError('รองรับเฉพาะ JPG, PNG, WebP และ PDF เท่านั้น')
      return
    }

    // Validate size
    if (file.size > MAX_SIZE_BYTES) {
      setError('ขนาดไฟล์ต้องไม่เกิน 10 MB')
      return
    }

    setUploading(true)

    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setError('ไม่พบข้อมูลผู้ใช้')
        return
      }

      // Build storage path: userId/expenseId/timestamp-filename
      const now = getBangkokNow()
      const ts = formatBangkok(now, 'yyyyMMddHHmmss')
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const filePath = `${user.id}/${expenseId}/${ts}-${safeName}`

      // Upload directly to Supabase Storage (client-side)
      const { error: uploadError } = await supabase.storage
        .from('expense-attachments')
        .upload(filePath, file, { upsert: false })

      if (uploadError) {
        setError(`อัปโหลดไม่สำเร็จ: ${uploadError.message}`)
        return
      }

      // Save metadata via server action
      const result = await saveAttachmentMetadata(
        expenseId,
        filePath,
        file.name,
        file.type,
        file.size
      )

      if (!result.success) {
        // Try to clean up uploaded file on metadata failure
        await supabase.storage.from('expense-attachments').remove([filePath])
        setError(result.error || 'บันทึกข้อมูลไม่สำเร็จ')
        return
      }

      await loadAttachments()
      onUpdate?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด')
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (attachment: ExpenseAttachment) => {
    setDeletingId(attachment.id)
    setError(null)

    const result = await deleteAttachment(attachment.id)

    if (!result.success) {
      setError(result.error || 'ลบไฟล์ไม่สำเร็จ')
    } else {
      setAttachments((prev) => prev.filter((a) => a.id !== attachment.id))
      onUpdate?.()
    }

    setDeletingId(null)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium flex items-center gap-1">
          <Paperclip className="h-4 w-4" />
          สลิป / ไฟล์แนบ
          {attachments.length > 0 && (
            <span className="ml-1 rounded-full bg-slate-200 px-1.5 py-0.5 text-xs font-semibold">
              {attachments.length}
            </span>
          )}
        </span>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept={ALLOWED_TYPES.join(',')}
            className="hidden"
            onChange={handleFileChange}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <>
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                กำลังอัปโหลด...
              </>
            ) : (
              'แนบไฟล์'
            )}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          กำลังโหลด...
        </div>
      ) : attachments.length === 0 ? (
        <p className="py-1 text-xs text-muted-foreground">ยังไม่มีไฟล์แนบ</p>
      ) : (
        <ul className="space-y-1">
          {attachments.map((att) => (
            <li
              key={att.id}
              className="flex items-center gap-2 rounded-md border bg-slate-50 px-3 py-2 text-sm"
            >
              <FileIcon fileType={att.file_type} />
              <span className="flex-1 truncate font-medium">{att.file_name}</span>
              {att.file_size && (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatBytes(att.file_size)}
                </span>
              )}
              {att.signed_url && (
                <a
                  href={att.signed_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  title="ดาวน์โหลด"
                >
                  <Download className="h-3.5 w-3.5" />
                </a>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-red-600"
                onClick={() => handleDelete(att)}
                disabled={deletingId === att.id}
                title="ลบไฟล์"
              >
                {deletingId === att.id ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="h-3 w-3" />
                )}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        รองรับ JPG, PNG, WebP, PDF · ขนาดสูงสุด 10 MB
      </p>
    </div>
  )
}
