'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

interface ImportIncomeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function ImportIncomeDialog({ open, onOpenChange, onSuccess }: ImportIncomeDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [allowReupload, setAllowReupload] = useState(false);
  const [inputKey, setInputKey] = useState(0); // For re-mounting input
  const [result, setResult] = useState<{
    rowCount: number;
    insertedCount: number;
    updatedCount: number;
    errorCount: number;
    warnings: string[];
    reconciledCount?: number;
    notFoundInForecastCount?: number;
  } | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setError(null);
      setSuccess(false);
      setResult(null);
    }
  };

  const handleUpload = async () => {
    if (!file) {
      setError('กรุณาเลือกไฟล์');
      return;
    }

    try {
      setUploading(true);
      setError(null);

      const formData = new FormData();
      formData.append('file', file);

      // Send allowDuplicate flag when testing mode is enabled
      if (allowReupload) {
        formData.append('allowDuplicate', 'true');
      }

      const response = await fetch('/api/import/tiktok/income', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error || data.message || 'การนำเข้าข้อมูลล้มเหลว');
        return;
      }

      setSuccess(true);
      setResult(data);

      // If re-upload enabled, reset input after delay
      if (allowReupload) {
        setTimeout(() => {
          setFile(null);
          setSuccess(false);
          setResult(null);
          setError(null);
          setInputKey(prev => prev + 1); // Re-mount input
        }, 2000);
      } else {
        // Call onSuccess after a short delay
        setTimeout(() => {
          onSuccess();
          handleClose();
        }, 2000);
      }
    } catch (err) {
      console.error('Upload error:', err);
      setError('เกิดข้อผิดพลาดในการนำเข้าข้อมูล');

      // If re-upload enabled, reset input after error
      if (allowReupload) {
        setTimeout(() => {
          setFile(null);
          setError(null);
          setInputKey(prev => prev + 1); // Re-mount input
        }, 3000);
      }
    } finally {
      setUploading(false);
    }
  };

  const handleClose = () => {
    setFile(null);
    setError(null);
    setSuccess(false);
    setResult(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Import TikTok Income/Settlement Data</DialogTitle>
          <DialogDescription>
            อัปโหลดไฟล์ Excel ที่ส่งออกจาก TikTok Income/Settlement Report
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* File Input */}
          <div className="space-y-2">
            <Label htmlFor="file">เลือกไฟล์ Excel (.xlsx)</Label>
            <Input
              key={inputKey}
              id="file"
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileChange}
              disabled={uploading || (success && !allowReupload)}
            />
            {file && (
              <p className="text-sm text-muted-foreground">
                ไฟล์ที่เลือก: {file.name} ({(file.size / 1024).toFixed(2)} KB)
              </p>
            )}
          </div>

          {/* Re-upload Checkbox */}
          <div className="flex items-center space-x-2">
            <input
              id="allow-reupload"
              type="checkbox"
              checked={allowReupload}
              onChange={(e) => setAllowReupload(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            <Label htmlFor="allow-reupload" className="text-sm text-muted-foreground cursor-pointer">
              Allow re-upload same file (testing mode)
            </Label>
          </div>

          {/* Error Alert */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Success Alert */}
          {success && result && (
            <Alert className="border-green-200 bg-green-50">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <AlertDescription>
                <div className="text-green-600">
                  <div className="font-semibold mb-1">นำเข้าข้อมูลสำเร็จ!</div>
                  <div className="text-sm space-y-1">
                    <div>• ทั้งหมด: {result.rowCount} รายการ</div>
                    <div>• เพิ่มใหม่: {result.insertedCount} รายการ</div>
                    <div>• อัปเดต: {result.updatedCount} รายการ</div>
                    {result.reconciledCount !== undefined && result.reconciledCount > 0 && (
                      <div className="text-blue-600">
                        • จับคู่กับ Forecast สำเร็จ: {result.reconciledCount} รายการ
                      </div>
                    )}
                    {result.notFoundInForecastCount !== undefined &&
                      result.notFoundInForecastCount > 0 && (
                        <div className="text-orange-600">
                          • ไม่พบใน Forecast: {result.notFoundInForecastCount} รายการ
                        </div>
                      )}
                    {result.errorCount > 0 && (
                      <div className="text-red-600">• ข้อผิดพลาด: {result.errorCount} รายการ</div>
                    )}
                  </div>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* Warnings */}
          {result && result.warnings && result.warnings.length > 0 && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <div className="text-sm">
                  <div className="font-semibold mb-1">คำเตือน:</div>
                  <ul className="list-disc list-inside space-y-1">
                    {result.warnings.slice(0, 5).map((warning: string, i: number) => (
                      <li key={i}>{warning}</li>
                    ))}
                    {result.warnings.length > 5 && (
                      <li>... และอีก {result.warnings.length - 5} รายการ</li>
                    )}
                  </ul>
                </div>
              </AlertDescription>
            </Alert>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={handleClose} disabled={uploading}>
            ยกเลิก
          </Button>
          <Button onClick={handleUpload} disabled={!file || uploading || success}>
            {uploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {uploading ? 'กำลังนำเข้า...' : 'นำเข้าข้อมูล'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
