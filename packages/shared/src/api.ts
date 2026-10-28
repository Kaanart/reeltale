// Shapes of the Worker's /api responses, shared with the app.

import { z } from 'zod';

export const ApiErrorSchema = z.object({ error: z.string(), detail: z.number().optional(), price: z.number().optional() });
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const PlaybackResponseSchema = z.object({ hls: z.string().url(), expires_at: z.number().int() });
export type PlaybackResponse = z.infer<typeof PlaybackResponseSchema>;

export const UploadResponseSchema = z.object({
  upload_url: z.string().url(),
  max_duration_s: z.number().int(),
  max_bytes: z.number().int(),
});
export type UploadResponse = z.infer<typeof UploadResponseSchema>;

export const RedeemResponseSchema = z.object({
  status: z.enum(['redeemed', 'already_redeemed']),
  coins: z.number().int().optional(),
  coins_expire_at: z.string().nullable().optional(),
  ai_days: z.number().int().optional(),
});
export type RedeemResponse = z.infer<typeof RedeemResponseSchema>;

// public.get_my_wallet()
export const WalletSchema = z.object({
  balance: z.number().int(),
  paid: z.number().int(),
  bonus: z.number().int(),
  refund_debt: z.number().int(),
  expiring: z.array(z.object({ coins: z.number().int(), expires_at: z.string(), source: z.string() })),
  free_passes_left: z.number().int(),
});
export type Wallet = z.infer<typeof WalletSchema>;

// public.get_episode_price()
export const EpisodePriceSchema = z.object({
  purchasable: z.boolean(),
  free: z.boolean(),
  own: z.boolean(),
  base_price: z.number().int(),
  discount_pct: z.number().int(),
  price: z.number().int(),
  reason: z.string(),
  unlocked: z.boolean(),
});
export type EpisodePrice = z.infer<typeof EpisodePriceSchema>;
