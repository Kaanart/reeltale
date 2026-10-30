// Cloudflare Workflow for one upload's ingest. Instance id = ingest-<Stream uid> (ingestInstanceId), so a
// retried webhook can't run it twice. The pipeline itself is in ingest-runner.ts; this adapts it to
// Workflows, Stream, R2 and PostgREST.

import {
  WorkflowEntrypoint, type WorkflowEvent, type WorkflowSleepDuration, type WorkflowStep, type WorkflowStepConfig,
} from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import type { Env } from '../env.ts';
import { serviceDb } from '../lib/db.ts';
import { signPlaybackToken } from '../lib/stream.ts';
import {
  captionState, captionVtt, deleteVideo, fetchImage, generateCaptions, thumbnailUrl, type StreamApi,
} from '../lib/stream-media.ts';
import { createMetaClient } from '../ai/meta.ts';
import { runIngest, type IngestIO, type IngestOutcome, type IngestPayload, type IngestStepRunner } from './ingest-runner.ts';

type AnyStep = (name: string, config: WorkflowStepConfig, fn: () => Promise<unknown>) => Promise<unknown>;

// Poster and preview keys contain the upload's uid, so an object never changes once written. The cache
// lifetime is still short: after a takedown the R2 object is deleted, and edge or browser copies must not
// outlive it by more than a few minutes.
const IMMUTABLE = 'public, max-age=300';

export function ingestIO(env: Env): IngestIO {
  const db = serviceDb(env);
  const api = (): StreamApi => {
    if (!env.STREAM_API_TOKEN) throw new NonRetryableError('stream_not_configured');
    return { accountId: env.CF_ACCOUNT_ID, apiToken: env.STREAM_API_TOKEN };
  };
  return {
    rpc: (fn, args) => db.rpc(fn, args),
    async thumbnail(assetId, o) {
      const { STREAM_SIGNING_KEY_ID: keyId, STREAM_SIGNING_KEY_JWK: jwk, STREAM_CUSTOMER_CODE: code } = env;
      if (!keyId || !jwk || !/^[a-z0-9]{1,64}$/.test(code)) throw new NonRetryableError('stream_not_configured');
      // Every video requires signed URLs; a 10-minute token (no download access) stands in for the uid.
      const { token } = await signPlaybackToken({ keyId, jwkJson: jwk, videoUid: assetId, ttlSec: 600 });
      return fetchImage(thumbnailUrl(code, token, o), o.animated ? 'gif' : 'jpeg');
    },
    startCaptions: (assetId, lang) => generateCaptions(api(), assetId, lang),
    captionState: (assetId, lang) => captionState(api(), assetId, lang),
    captionVtt: (assetId, lang) => captionVtt(api(), assetId, lang),
    async deleteVideo(assetId) {
      await deleteVideo(api(), assetId);
    },
    async putPublic(key, bytes, contentType) {
      await env.MEDIA.put(key, bytes, { httpMetadata: { contentType, cacheControl: IMMUTABLE } });
    },
    async deletePublic(keys) {
      if (keys.length) await env.MEDIA.delete(keys);
    },
    // Review frames are creator media, kept only for the review: the private bucket, deleted afterwards.
    async putPrivate(key, bytes, contentType) {
      await env.AI_ASSETS.put(key, bytes, { httpMetadata: { contentType } });
    },
    async getPrivate(key) {
      const obj = await env.AI_ASSETS.get(key);
      if (!obj) throw new Error(`missing frame ${key}`);
      return new Uint8Array(await obj.arrayBuffer());
    },
    async deletePrivate(keys) {
      if (keys.length) await env.AI_ASSETS.delete(keys);
    },
    meta() {
      if (!env.META_API_KEY) throw new NonRetryableError('meta_not_configured');
      return createMetaClient({ apiKey: env.META_API_KEY, endUserId: 'reeltale-ingest' });
    },
    transcript: env.INGEST_TRANSCRIPT === 'off' ? 'off' : 'stream_captions',
    animatedPreview: env.INGEST_ANIMATED_PREVIEW === 'on',
    fatal: (code) => new NonRetryableError(code),
    log: (message) => console.error(message),
  };
}

export class EpisodeIngestWorkflow extends WorkflowEntrypoint<Env, IngestPayload> {
  async run(event: WorkflowEvent<IngestPayload>, step: WorkflowStep): Promise<IngestOutcome> {
    const run = step.do.bind(step) as unknown as AnyStep;
    const runner: IngestStepRunner = {
      do: (name, config, fn) => run(name, config as WorkflowStepConfig, fn) as Promise<never>,
      sleep: (name, duration) => step.sleep(name, duration as WorkflowSleepDuration),
    };
    return runIngest(ingestIO(this.env), runner, event.payload);
  }
}
