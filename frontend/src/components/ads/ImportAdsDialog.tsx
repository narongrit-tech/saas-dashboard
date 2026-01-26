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
import { CheckCircle, AlertCircle, Loader2, FileText, TrendingUp, ShoppingCart, DollarSign } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface ImportAdsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

type Step = 'upload' | 'preview' | 'importing' | 'result';

interface PreviewData {
  summary: {
    fileName: string;
    sheetName: string;
    campaignType: 'product' | 'live';
    campaignTypeConfidence: number;
    dateRange: string;
    totalRows: number;
    totalSpend: number;
    totalOrders: number;
    totalRevenue: number;
    avgROI: number;
  };
  sampleRows: Array<{
    date: string;
    campaignName: string | null;
    spend: number;
    orders: number;
    revenue: number;
    roi: number | null;
  }>;
  warnings: string[];
  detectedColumns: {
    date: string;
    campaign: string;
    spend: string;
    orders: string;
    revenue: string;
    roi: string;
  };
}

interface ImportResult {
  rowCount: number;
  insertedCount: number;
  updatedCount: number;
  errorCount: number;
  warnings: string[];
}

export function ImportAdsDialog({ open, onOpenChange, onSuccess }: ImportAdsDialogProps) {
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<any>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setError(null);
      setErrorDetails(null);
      setPreview(null);
      setResult(null);
      setStep('upload');
    }
  };

  const handlePreview = async () => {
    if (!file) {
      setError('กรุณาเลือกไฟล์');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setErrorDetails(null);

      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/import/tiktok/ads-daily/preview', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error || 'ไม่สามารถ preview ไฟล์ได้');
        setErrorDetails(data.details);
        return;
      }

      setPreview(data);
      setStep('preview');
    } catch (err) {
      console.error('Preview error:', err);
      setError('เกิดข้อผิดพลาดในการ preview ไฟล์');
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (!file) return;

    try {
      setStep('importing');
      setLoading(true);
      setError(null);

      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/import/tiktok/ads-daily', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error || data.message || 'การนำเข้าข้อมูลล้มเหลว');
        setErrorDetails(data.details);
        setStep('preview');
        return;
      }

      setResult(data);
      setStep('result');

      // Call onSuccess after a short delay
      setTimeout(() => {
        onSuccess();
        handleClose();
      }, 2000);
    } catch (err) {
      console.error('Import error:', err);
      setError('เกิดข้อผิดพลาดในการนำเข้าข้อมูล');
      setStep('preview');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setFile(null);
    setError(null);
    setErrorDetails(null);
    setPreview(null);
    setResult(null);
    setStep('upload');
    onOpenChange(false);
  };

  const handleBack = () => {
    setError(null);
    setErrorDetails(null);
    setPreview(null);
    setStep('upload');
  };

  const formatCurrency = (amount: number) => {
    return amount.toLocaleString('th-TH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import TikTok Ads Daily Data</DialogTitle>
          <DialogDescription>
            {step === 'upload' && 'อัปโหลดไฟล์ Excel ที่ส่งออกจาก TikTok Ads Manager'}
            {step === 'preview' && 'ตรวจสอบข้อมูลก่อนนำเข้า'}
            {step === 'importing' && 'กำลังนำเข้าข้อมูล...'}
            {step === 'result' && 'นำเข้าข้อมูลสำเร็จ'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Step 1: Upload */}
          {step === 'upload' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="file">เลือกไฟล์ Excel (.xlsx)</Label>
                <Input
                  id="file"
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileChange}
                  disabled={loading}
                />
                {file && (
                  <p className="text-sm text-muted-foreground">
                    ไฟล์ที่เลือก: {file.name} ({(file.size / 1024).toFixed(2)} KB)
                  </p>
                )}
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <div className="font-semibold mb-1">{error}</div>
                    {errorDetails && (
                      <div className="text-sm mt-2 space-y-1">
                        {errorDetails.sheetName && <div>Sheet: {errorDetails.sheetName}</div>}
                        {errorDetails.sheetNames && (
                          <div>Available sheets: {errorDetails.sheetNames.join(', ')}</div>
                        )}
                        {errorDetails.missingColumns && (
                          <div>Missing columns: {errorDetails.missingColumns.join(', ')}</div>
                        )}
                        {errorDetails.headers && (
                          <div>Found headers: {errorDetails.headers.slice(0, 5).join(', ')}...</div>
                        )}
                        {errorDetails.suggestion && (
                          <div className="mt-2 font-medium">→ {errorDetails.suggestion}</div>
                        )}
                      </div>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" onClick={handleClose} disabled={loading}>
                  ยกเลิก
                </Button>
                <Button onClick={handlePreview} disabled={!file || loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {loading ? 'กำลังอ่านไฟล์...' : 'ดู Preview'}
                </Button>
              </div>
            </>
          )}

          {/* Step 2: Preview */}
          {step === 'preview' && preview && (
            <>
              <div className="space-y-4">
                {/* Summary Cards */}
                <div className="grid grid-cols-2 gap-3">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <FileText className="h-4 w-4" />
                        File Info
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-1 text-sm">
                        <div>Sheet: <span className="font-medium">{preview.summary.sheetName}</span></div>
                        <div>Type: <span className={`px-2 py-0.5 rounded-full text-xs ${
                          preview.summary.campaignType === 'live' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                        }`}>{preview.summary.campaignType}</span></div>
                        <div>Rows: <span className="font-medium">{preview.summary.totalRows}</span></div>
                        <div className="text-xs text-muted-foreground">{preview.summary.dateRange}</div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <DollarSign className="h-4 w-4" />
                        Total Spend
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-red-600">
                        ฿{formatCurrency(preview.summary.totalSpend)}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <ShoppingCart className="h-4 w-4" />
                        Total Orders
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-blue-600">
                        {preview.summary.totalOrders}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <TrendingUp className="h-4 w-4" />
                        Avg ROI
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className={`text-2xl font-bold ${preview.summary.avgROI >= 1 ? 'text-green-600' : 'text-red-600'}`}>
                        {preview.summary.avgROI.toFixed(2)}x
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Detected Columns */}
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <div className="text-sm">
                      <div className="font-semibold mb-1">Detected Columns:</div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        <div>• Date: {preview.detectedColumns.date}</div>
                        <div>• Campaign: {preview.detectedColumns.campaign}</div>
                        <div>• Spend: {preview.detectedColumns.spend}</div>
                        <div>• Orders: {preview.detectedColumns.orders}</div>
                        <div>• Revenue: {preview.detectedColumns.revenue}</div>
                        <div>• ROI: {preview.detectedColumns.roi}</div>
                      </div>
                    </div>
                  </AlertDescription>
                </Alert>

                {/* Sample Rows */}
                <div>
                  <h3 className="text-sm font-medium mb-2">Sample Rows (First 5):</h3>
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-muted">
                        <tr>
                          <th className="py-2 px-2 text-left">Date</th>
                          <th className="py-2 px-2 text-left">Campaign</th>
                          <th className="py-2 px-2 text-right">Spend</th>
                          <th className="py-2 px-2 text-right">Orders</th>
                          <th className="py-2 px-2 text-right">ROI</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.sampleRows.map((row, idx) => (
                          <tr key={idx} className="border-t">
                            <td className="py-2 px-2">{row.date}</td>
                            <td className="py-2 px-2 truncate max-w-[150px]" title={row.campaignName || '-'}>
                              {row.campaignName || '-'}
                            </td>
                            <td className="py-2 px-2 text-right font-mono text-red-600">
                              ฿{formatCurrency(row.spend)}
                            </td>
                            <td className="py-2 px-2 text-right font-mono">{row.orders}</td>
                            <td className={`py-2 px-2 text-right font-mono ${(row.roi || 0) >= 1 ? 'text-green-600' : 'text-red-600'}`}>
                              {row.roi ? `${row.roi.toFixed(2)}x` : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Warnings */}
                {preview.warnings.length > 0 && (
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      <div className="text-sm">
                        <div className="font-semibold mb-1">Warnings ({preview.warnings.length}):</div>
                        <ul className="list-disc list-inside space-y-1 text-xs">
                          {preview.warnings.slice(0, 3).map((warning, i) => (
                            <li key={i}>{warning}</li>
                          ))}
                          {preview.warnings.length > 3 && (
                            <li>... and {preview.warnings.length - 3} more</li>
                          )}
                        </ul>
                      </div>
                    </AlertDescription>
                  </Alert>
                )}
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" onClick={handleBack} disabled={loading}>
                  กลับ
                </Button>
                <Button onClick={handleImport} disabled={loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  ยืนยันนำเข้า
                </Button>
              </div>
            </>
          )}

          {/* Step 3: Importing */}
          {step === 'importing' && (
            <div className="flex flex-col items-center justify-center py-8">
              <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
              <p className="text-sm text-muted-foreground">กำลังนำเข้าข้อมูล กรุณารอสักครู่...</p>
            </div>
          )}

          {/* Step 4: Result */}
          {step === 'result' && result && (
            <Alert className="border-green-200 bg-green-50">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <AlertDescription>
                <div className="text-green-600">
                  <div className="font-semibold mb-1">นำเข้าข้อมูลสำเร็จ!</div>
                  <div className="text-sm space-y-1">
                    <div>• ทั้งหมด: {result.rowCount} รายการ</div>
                    <div>• เพิ่มใหม่: {result.insertedCount} รายการ</div>
                    <div>• อัปเดต: {result.updatedCount} รายการ</div>
                    {result.errorCount > 0 && (
                      <div className="text-red-600">• ข้อผิดพลาด: {result.errorCount} รายการ</div>
                    )}
                  </div>
                </div>
              </AlertDescription>
            </Alert>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
