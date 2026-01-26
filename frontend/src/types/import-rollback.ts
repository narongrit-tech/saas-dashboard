/**
 * Import Rollback Types
 *
 * Types for rollback and cleanup API responses.
 */

export interface RollbackResponse {
  success: boolean;
  message?: string;
  counts?: {
    wallet_deleted: number;
    ads_deleted: number;
  };
  error?: string;
  details?: Record<string, any>;
}

export interface CleanupResponse {
  success: boolean;
  message?: string;
  count?: number;
  error?: string;
  details?: Record<string, any>;
}

export interface RollbackRequest {
  batch_id: string;
}
