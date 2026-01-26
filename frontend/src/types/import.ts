/**
 * Import types - shared across import flows
 */

export interface RollbackResponse {
  success: boolean;
  message: string;
  counts: {
    wallet_deleted: number;
    ads_deleted: number;
  };
}

export interface RollbackErrorResponse {
  success: false;
  error: string;
  message?: string;
}
