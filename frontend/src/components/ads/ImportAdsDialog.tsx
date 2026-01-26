'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle, AlertCircle, Loader2, FileText, TrendingUp, ShoppingCart, DollarSign, Calendar as CalendarIcon, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { format } from 'date-fns';
import { getBangkokNow } from '@/lib/bangkok-time';
import { useToast } from '@/hooks/use-toast';
import type { RollbackResponse } from '@/types/import';

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
    keptRows: number;
    skippedAllZeroRows: number;
    totalSpend: number;
    totalOrders: number;
    totalRevenue: number;
    avgROI: number;
    skipZeroRowsUsed: boolean;
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
  batchId?: string;
}

export function ImportAdsDialog({ open, onOpenChange, onSuccess }: ImportAdsDialogProps) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [reportDate, setReportDate] = useState<Date | null>(null);
  const [adsType, setAdsType] = useState<'product' | 'live'>('product');
  const [skipZeroRows, setSkipZeroRows] = useState<boolean>(true);
  const [autoDetected, setAutoDetected] = useState({ date: false, type: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<any>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [rollbackConfirmOpen, setRollbackConfirmOpen] = useState(false);
  const [rollbackBatchId, setRollbackBatchId] = useState<string | null>(null);
  const [rollbackLoading, setRollbackLoading] = useState(false);
  const { toast } = useToast();

  // Auto-detect report date and ads type from filename
  useEffect(() => {
    if (!file) return;

    const filename = file.name.toLowerCase();

    // Reset auto-detection state
    setAutoDetected({ date: false, type: false });

    // Try to extract date (e.g., "ads-2026-01-20.xlsx" or "20260120-ads.xlsx")
    const datePatterns = [
      /(\d{4})-(\d{2})-(\d{2})/, // YYYY-MM-DD
      /(\d{4})(\d{2})(\d{2})/, // YYYYMMDD
      /(\d{2})-(\d{2})-(\d{4})/, // DD-MM-YYYY
    ];

    for (const pattern of datePatterns) {
      const match = filename.match(pattern);
      if (match) {
        let year, month, day;
        if (pattern.toString().includes('(\\d{4})-(\\d{2})-(\\d{2})')) {
          // YYYY-MM-DD
          [, year, month, day] = match;
        } else if (pattern.toString().includes('(\\d{4})(\\d{2})(\\d{2})')) {
          // YYYYMMDD
          [, year, month, day] = match;
        } else {
          // DD-MM-YYYY
          [, day, month, year] = match;
        }

        const detectedDate = new Date(`${year}-${month}-${day}`);
        if (!isNaN(detectedDate.getTime())) {
          setReportDate(detectedDate);
          setAutoDetected((prev) => ({ ...prev, date: true }));
          break;
        }
      }
    }

    // Try to detect type
    if (filename.includes('live') || filename.includes('livestream')) {
      setAdsType('live');
      setAutoDetected((prev) => ({ ...prev, type: true }));
    } else if (filename.includes('product') || filename.includes('creative')) {
      setAdsType('product');
      setAutoDetected((prev) => ({ ...prev, type: true }));
    }
  }, [file]);

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

    if (!reportDate) {
      setError('กรุณาเลือก Report Date');
      return;
    }

    if (!adsType) {
      setError('กรุณาเลือก Ads Type');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setErrorDetails(null);

      const formData = new FormData();
      formData.append('file', file);
      formData.append('reportDate', format(reportDate, 'yyyy-MM-dd'));
      formData.append('adsType', adsType);
      formData.append('skipZeroRows', skipZeroRows.toString());

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
    if (!file || !reportDate) return;

    try {
      setStep('importing');
      setLoading(true);
      setError(null);

      const formData = new FormData();
      formData.append('file', file);
      formData.append('reportDate', format(reportDate, 'yyyy-MM-dd'));
      formData.append('adsType', adsType);
      formData.append('skipZeroRows', skipZeroRows.toString());

      const response = await fetch('/api/import/tiktok/ads-daily', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error || data.message || 'การนำเข้าข้อมูลล้มเหลว');
        setErrorDetails({
          code: data.code,
          ...data.details,
        });
        setStep('preview');
        return;
      }

      setResult(data);
      setStep('result');

      // Refresh page data immediately (force revalidate server components)
      router.refresh();

      // Call onSuccess callback
      onSuccess();
    } catch (err) {
      console.error('Import error:', err);
      setError('เกิดข้อผิดพลาดในการนำเข้าข้อมูล');
      setStep('preview');
    } finally {
      setLoading(false);
    }
  };

  const handleRollback = async () => {
    if (!rollbackBatchId) return;

    try {
      setRollbackLoading(true);

      const response = await fetch('/api/import/rollback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ batchId: rollbackBatchId }),
      });

      const data: RollbackResponse = await response.json();

      if (!response.ok || !data.success) {
        toast({
          title: 'Rollback Failed',
          description: data.message || 'ไม่สามารถ rollback ได้',
          variant: 'destructive',
        });
        return;
      }

      toast({
        title: 'Rollback Success',
        description: `ลบข้อมูลสำเร็จ: ${data.counts.ads_deleted} ads records, ${data.counts.wallet_deleted} wallet entries`,
      });

      // Refresh page data
      onSuccess();

      // Close dialog after successful rollback
      handleClose();
    } catch (err) {
      console.error('Rollback error:', err);
      toast({
        title: 'Rollback Error',
        description: 'เกิดข้อผิดพลาดในการ rollback',
        variant: 'destructive',
      });
    } finally {
      setRollbackLoading(false);
      setRollbackConfirmOpen(false);
    }
  };

  const handleClose = () => {
    setFile(null);
    setReportDate(null);
    setAdsType('product');
    setSkipZeroRows(true);
    setAutoDetected({ date: false, type: false });
    setError(null);
    setErrorDetails(null);
    setPreview(null);
    setResult(null);
    setRollbackBatchId(null);
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
              {/* Report Date */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  Report Date *
                  {autoDetected.date && (
                    <Badge variant="secondary" className="text-xs">
                      Auto-detected 🎯
                    </Badge>
                  )}
                </Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full justify-start text-left font-normal"
                      disabled={loading}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {reportDate ? format(reportDate, 'dd MMM yyyy') : 'เลือกวันที่...'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={reportDate || undefined}
                      onSelect={(date) => {
                        setReportDate(date || null);
                        setAutoDetected((prev) => ({ ...prev, date: false }));
                      }}
                      disabled={(date) => date > getBangkokNow()}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                <p className="text-xs text-muted-foreground">
                  วันที่ของ report (ต้องไม่อนาคต)
                </p>
              </div>

              {/* Ads Type */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  Ads Type *
                  {autoDetected.type && (
                    <Badge variant="secondary" className="text-xs">
                      Auto-detected 🎯
                    </Badge>
                  )}
                </Label>
                <Select
                  value={adsType}
                  onValueChange={(value) => {
                    setAdsType(value as 'product' | 'live');
                    setAutoDetected((prev) => ({ ...prev, type: false }));
                  }}
                  disabled={loading}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="เลือกประเภทโฆษณา..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="product">Product (Creative)</SelectItem>
                    <SelectItem value="live">Live</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  ประเภทของโฆษณา (Product/Live)
                </p>
              </div>

              {/* Skip All-Zero Rows Toggle */}
              <div className="flex items-center gap-3 p-3 bg-muted rounded border">
                <Checkbox
                  id="skipZeroRows"
                  checked={skipZeroRows}
                  onCheckedChange={(checked) => setSkipZeroRows(!!checked)}
                  disabled={loading}
                />
                <div className="flex-1">
                  <label
                    htmlFor="skipZeroRows"
                    className="text-sm font-medium cursor-pointer"
                  >
                    ข้ามแถวที่เป็น 0 ทั้งหมด (แนะนำ)
                  </label>
                  <p className="text-xs text-muted-foreground">
                    ลดเวลานำเข้า - ข้ามแถวที่ Spend=0, Orders=0, Revenue=0
                  </p>
                </div>
              </div>

              {/* File Upload */}
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
                <Button onClick={handlePreview} disabled={!file || !reportDate || !adsType || loading}>
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
                {/* Import Info Cards (blue background) */}
                <div className="grid grid-cols-2 gap-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
                  <div>
                    <p className="text-xs text-blue-700 font-medium">Import Date</p>
                    <p className="font-bold text-blue-900">
                      {reportDate ? format(reportDate, 'dd MMM yyyy') : 'N/A'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-blue-700 font-medium">Ads Type</p>
                    <p className="font-bold text-blue-900">
                      {adsType === 'product' ? 'Product (Creative)' : 'Live'}
                    </p>
                  </div>
                </div>

                {/* Counts Card (3-column) */}
                <Card className="bg-blue-50 border-blue-200">
                  <CardContent className="pt-4">
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground">แถวทั้งหมดในไฟล์</p>
                        <p className="text-2xl font-bold">{preview.summary.totalRows.toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">แถวที่จะนำเข้า</p>
                        <p className="text-2xl font-bold text-green-600">{preview.summary.keptRows.toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">แถวที่ข้าม (all-zero)</p>
                        <p className="text-2xl font-bold text-gray-400">{preview.summary.skippedAllZeroRows.toLocaleString()}</p>
                      </div>
                    </div>
                    {preview.summary.skipZeroRowsUsed && (
                      <p className="text-xs text-blue-700 mt-2">
                        ✓ กรองแถว all-zero แล้ว - ยอดรวมคำนวณจากแถวที่จะนำเข้าเท่านั้น
                      </p>
                    )}
                  </CardContent>
                </Card>

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
                  <AlertDescription>
                    <div className="font-semibold mb-1">
                      {errorDetails?.code === 'DUPLICATE_IMPORT' && '❌ นำเข้าซ้ำ'}
                      {errorDetails?.code === 'WALLET_NOT_FOUND' && '⚠️ ไม่พบ Wallet'}
                      {errorDetails?.code === 'PARSE_ERROR' && '❌ ไม่สามารถอ่านไฟล์ได้'}
                      {errorDetails?.code === 'DB_ERROR' && '❌ ข้อผิดพลาดฐานข้อมูล'}
                      {!errorDetails?.code && '❌ เกิดข้อผิดพลาด'}
                    </div>
                    <div className="text-sm mt-1">{error}</div>

                    {/* Duplicate Import - Show Rollback Button */}
                    {errorDetails?.code === 'DUPLICATE_IMPORT' && errorDetails.existingBatchId && (
                      <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded">
                        <p className="text-xs text-yellow-800 mb-2">
                          Import already exists (batch: <span className="font-mono">{errorDetails.existingBatchId}</span>,
                          imported: {new Date(errorDetails.importedAt).toLocaleString('th-TH')})
                        </p>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => {
                            setRollbackBatchId(errorDetails.existingBatchId);
                            setRollbackConfirmOpen(true);
                          }}
                          disabled={rollbackLoading}
                        >
                          {rollbackLoading && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                          <Trash2 className="mr-2 h-3 w-3" />
                          Rollback Previous Import
                        </Button>
                      </div>
                    )}

                    {errorDetails && errorDetails.code && (
                      <details className="mt-2 text-xs">
                        <summary className="cursor-pointer font-medium">
                          Debug Details
                        </summary>
                        <pre className="mt-1 p-2 bg-black/5 rounded overflow-auto">
                          {JSON.stringify(errorDetails, null, 2)}
                        </pre>
                      </details>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" onClick={handleBack} disabled={loading}>
                  กลับ
                </Button>
                <Button onClick={handleImport} disabled={loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {loading ? 'กำลังนำเข้า...' : 'ยืนยันนำเข้า'}
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
            <>
              <Alert className="border-green-200 bg-green-50">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <AlertDescription>
                  <div className="text-green-600">
                    <div className="font-semibold mb-2 text-base">✓ นำเข้าข้อมูลสำเร็จ!</div>
                    <div className="text-sm space-y-1">
                      <div className="font-medium">Import Summary:</div>
                      <div>• Rows Processed: {result.rowCount || preview?.summary?.keptRows || 0} rows</div>
                      <div>• Inserted: {result.insertedCount} rows</div>
                      <div>• Updated: {result.updatedCount} rows</div>
                      {result.errorCount > 0 && (
                        <div className="text-red-600">• Errors: {result.errorCount} rows</div>
                      )}
                    </div>

                    {/* Show preview totals if available */}
                    {preview && (
                      <div className="mt-3 p-3 bg-white/50 rounded border border-green-300">
                        <div className="font-medium mb-1">Data Imported:</div>
                        <div className="text-xs space-y-1">
                          <div>Total Spend: <span className="font-mono text-red-600">฿{formatCurrency(preview.summary.totalSpend)}</span></div>
                          <div>Total Orders: <span className="font-mono">{preview.summary.totalOrders.toLocaleString()}</span></div>
                          <div>Total Revenue: <span className="font-mono text-green-600">฿{formatCurrency(preview.summary.totalRevenue)}</span></div>
                          <div>Avg ROI: <span className={`font-mono font-semibold ${preview.summary.avgROI >= 1 ? 'text-green-600' : 'text-red-600'}`}>{preview.summary.avgROI.toFixed(2)}x</span></div>
                        </div>
                      </div>
                    )}

                    {/* Show batch ID */}
                    {result.batchId && (
                      <div className="mt-2 text-xs text-muted-foreground">
                        Batch ID: <span className="font-mono">{result.batchId}</span>
                      </div>
                    )}
                  </div>
                </AlertDescription>
              </Alert>

              {/* Action Buttons */}
              <div className="flex justify-between pt-4">
                <Button variant="outline" onClick={handleClose}>
                  Close
                </Button>
                {result.batchId && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      setRollbackBatchId(result.batchId || null);
                      setRollbackConfirmOpen(true);
                    }}
                    disabled={rollbackLoading}
                  >
                    {rollbackLoading && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                    <Trash2 className="mr-2 h-3 w-3" />
                    Rollback This Import
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>

      {/* Rollback Confirmation Dialog */}
      <AlertDialog open={rollbackConfirmOpen} onOpenChange={setRollbackConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Rollback</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to rollback this import? This will delete all ads performance records and wallet entries from this import batch.
              <br /><br />
              <span className="font-semibold text-red-600">This action cannot be undone.</span>
              {rollbackBatchId && (
                <div className="mt-2 text-xs text-muted-foreground">
                  Batch ID: <span className="font-mono">{rollbackBatchId}</span>
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rollbackLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRollback}
              disabled={rollbackLoading}
              className="bg-red-600 hover:bg-red-700"
            >
              {rollbackLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {rollbackLoading ? 'Rolling back...' : 'Confirm Rollback'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
