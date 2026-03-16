import type { Context } from 'hono';

// --- Cloudflare Workers Bindings ---
export type CloudflareBindings = {
  // KV Namespaces
  RATE_LIMIT: KVNamespace;

  // Secrets
  OPENAI_API_KEY: string;

  // Vars
  ENVIRONMENT: string;
  ALLOWED_BUNDLE_ID: string;
  PREMIUM_PRODUCT_ID: string;
};

// --- Hono App Types ---
export type AppVariables = {
  transactionId: string;
};

export type AppEnv = {
  Bindings: CloudflareBindings;
  Variables: AppVariables;
};

export type AppContext = Context<AppEnv>;

// --- Activity Log Types ---
export const ACTIVITY_TYPES = [
  'breastFeeding',
  'bottleFeeding',
  'sleep',
  'pee',
  'poop',
  'diaper',
  'bath',
  'cry',
  'temperature',
  'meal',
  'memo',
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export type ActivityLog = {
  type: ActivityType;
  timestamp: string;
  leftBreastMinutes?: number;
  rightBreastMinutes?: number;
  amountML?: number;
  sleepEnd?: string | null;
  hasPee?: boolean;
  hasPoop?: boolean;
  temperature?: number;
  note?: string;
};

export type Baby = {
  name: string;
  birthDate: string;
};

// --- Request Types ---
export type AdviceRequest = {
  baby: Baby;
  date: string;
  activityLogs: ActivityLog[];
};

export type ChatRequest = {
  baby: Baby;
  message: string;
  previousResponseId?: string;
  activityLogs: ActivityLog[];
  stream?: boolean;
};

// --- Response Types ---
export type AdviceResponse = {
  advice: string;
  generatedAt: string;
};

export type ChatResponse = {
  message: { role: 'assistant'; content: string };
  responseId: string;
  generatedAt: string;
};

export type HealthResponse = {
  status: string;
  version: string;
};

export type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
  retryAfter?: number;
};
