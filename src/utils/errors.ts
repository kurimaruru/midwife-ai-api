import type { Context } from 'hono';
import type { ErrorResponse } from '../types';

// --- Error Codes ---
export const ErrorCode = {
  INVALID_REQUEST: 'INVALID_REQUEST',
  INVALID_ACTIVITY_TYPE: 'INVALID_ACTIVITY_TYPE',
  MESSAGES_EMPTY: 'MESSAGES_EMPTY',
  MESSAGES_TOO_LONG: 'MESSAGES_TOO_LONG',
  AUTH_MISSING: 'AUTH_MISSING',
  AUTH_INVALID: 'AUTH_INVALID',
  SUBSCRIPTION_EXPIRED: 'SUBSCRIPTION_EXPIRED',
  RATE_LIMITED: 'RATE_LIMITED',
  AI_SERVICE_ERROR: 'AI_SERVICE_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

const ERROR_MESSAGES: Record<ErrorCodeType, string> = {
  [ErrorCode.INVALID_REQUEST]: 'リクエストの形式が正しくありません。',
  [ErrorCode.INVALID_ACTIVITY_TYPE]: '不正な記録タイプが含まれています。',
  [ErrorCode.MESSAGES_EMPTY]: 'メッセージが空です。',
  [ErrorCode.MESSAGES_TOO_LONG]: 'メッセージ数が上限を超えています。',
  [ErrorCode.AUTH_MISSING]: '認証情報が必要です。',
  [ErrorCode.AUTH_INVALID]: '認証情報が無効です。',
  [ErrorCode.SUBSCRIPTION_EXPIRED]: 'サブスクリプションの有効期限が切れています。',
  [ErrorCode.RATE_LIMITED]: 'リクエスト回数の上限に達しました。しばらくしてからお試しください。',
  [ErrorCode.AI_SERVICE_ERROR]: 'AIサービスでエラーが発生しました。しばらくしてからお試しください。',
  [ErrorCode.SERVICE_UNAVAILABLE]: '現在メンテナンス中です。しばらくしてからお試しください。',
};

const ERROR_STATUS: Record<ErrorCodeType, number> = {
  [ErrorCode.INVALID_REQUEST]: 400,
  [ErrorCode.INVALID_ACTIVITY_TYPE]: 400,
  [ErrorCode.MESSAGES_EMPTY]: 400,
  [ErrorCode.MESSAGES_TOO_LONG]: 400,
  [ErrorCode.AUTH_MISSING]: 401,
  [ErrorCode.AUTH_INVALID]: 401,
  [ErrorCode.SUBSCRIPTION_EXPIRED]: 403,
  [ErrorCode.RATE_LIMITED]: 429,
  [ErrorCode.AI_SERVICE_ERROR]: 500,
  [ErrorCode.SERVICE_UNAVAILABLE]: 503,
};

// --- AppError Class ---
export class AppError extends Error {
  public readonly code: ErrorCodeType;
  public readonly statusCode: number;
  public readonly retryAfter?: number;

  constructor(code: ErrorCodeType, message?: string, retryAfter?: number) {
    super(message ?? ERROR_MESSAGES[code]);
    this.code = code;
    this.statusCode = ERROR_STATUS[code];
    this.retryAfter = retryAfter;
  }
}

// --- Error Response Helper ---
export function errorResponse(c: Context, error: AppError): Response {
  const body: ErrorResponse = {
    error: {
      code: error.code,
      message: error.message,
    },
  };

  if (error.retryAfter !== undefined) {
    body.retryAfter = error.retryAfter;
    c.header('Retry-After', String(error.retryAfter));
  }

  return c.json(body, error.statusCode as 400);
}
