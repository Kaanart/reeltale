// Bindings and configuration available to the Worker. Secrets are optional in the type because a
// missing secret must fail closed at the route that needs it, not crash the whole Worker.
export interface Env {
  ASSETS: Fetcher;
  /** Private R2 bucket for AI story assets (sheets, panels, manifests). Never public. */
  AI_ASSETS: R2Bucket;
  STORY_SCENE: Workflow<{ jobId: string }>;
  /** Public R2 bucket served at MEDIA_ORIGIN (episode posters and previews). Only approved media is written. */
  MEDIA: R2Bucket;
  /** After a Stream upload is ready: review, transcript, poster and preview (workflows/episode-ingest.ts). */
  EPISODE_INGEST: Workflow<{ episodeId: string; assetId: string }>;
  /** Where the ingest review's transcript comes from: 'stream_captions' (default) or 'off'. */
  INGEST_TRANSCRIPT?: string;
  /** 'on' adds a short animated GIF preview next to the poster (off: unreviewed frames would be public). */
  INGEST_ANIMATED_PREVIEW?: string;
  /** Rate limiters (src/lib/rate-limit.ts). Optional: without a binding nothing is limited (local tests). */
  RATE_LIMIT_USER?: RateLimit;
  RATE_LIMIT_AI?: RateLimit;
  RATE_LIMIT_IP?: RateLimit;

  APP_ENV: 'production' | 'staging' | 'development';
  APP_ORIGIN: string;
  /** Public R2 media (covers, posters, previews), e.g. https://media.reeltale.net. */
  MEDIA_ORIGIN: string;
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  CF_ACCOUNT_ID: string;
  STREAM_CUSTOMER_CODE: string;
  APPLE_TEAM_ID: string;
  IOS_BUNDLE_ID: string;
  ANDROID_PACKAGE: string;
  ANDROID_CERT_SHA256: string;
  ADMOB_PUBLISHER_ID: string;

  SUPABASE_SECRET_KEY?: string;
  REVENUECAT_WEBHOOK_AUTH?: string;
  REVENUECAT_WEBHOOK_HMAC_SECRET?: string;
  STREAM_API_TOKEN?: string;
  STREAM_WEBHOOK_SECRET?: string;
  STREAM_SIGNING_KEY_ID?: string;
  STREAM_SIGNING_KEY_JWK?: string;
  TURNSTILE_SECRET?: string;
  /** Key for the daily-rotating IP hashes that rate-limit the logged-out notice form (any long random string). */
  IP_HASH_SECRET?: string;
  META_API_KEY?: string;
}

export type AppContext = {
  Bindings: Env;
  Variables: {
    userId: string;
    userJwt: string;
  };
};
