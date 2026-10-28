// Cloudflare Workflow for one AI scene job. Instance id = job id, so a duplicate start can't run the
// job twice. The pipeline itself is in scene-runner.ts; this adapts it to Workflows, R2 and PostgREST.

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep, type WorkflowStepConfig } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import { PROMPT_VERSION } from '@reeltale/shared';
import type { Env } from '../env.ts';
import { serviceDb } from '../lib/db.ts';
import { sha256Hex } from '../lib/crypto.ts';
import { createMetaClient } from '../ai/meta.ts';
import type { SceneDeps } from '../ai/scene.ts';
import { runSceneJob, type RunnerIO, type StepRunner } from './scene-runner.ts';

export interface StoryScenePayload {
  jobId: string;
}

type AnyStep = (name: string, config: WorkflowStepConfig, fn: () => Promise<unknown>) => Promise<unknown>;

export function workerIO(env: Env): RunnerIO {
  const db = serviceDb(env);
  return {
    rpc: (fn, args) => db.rpc(fn, args),
    async getText(key) {
      const obj = await env.AI_ASSETS.get(key);
      return obj ? obj.text() : null;
    },
    async putText(key, text, contentType) {
      await env.AI_ASSETS.put(key, text, { httpMetadata: { contentType } });
    },
    deps(jobId, endUserId): SceneDeps {
      if (!env.META_API_KEY) throw new NonRetryableError('meta_not_configured');
      return {
        meta: createMetaClient({ apiKey: env.META_API_KEY, endUserId }),
        async put(key, bytes, contentType) {
          await env.AI_ASSETS.put(key, bytes, { httpMetadata: { contentType } });
        },
        async get(key) {
          const obj = await env.AI_ASSETS.get(key);
          if (!obj) throw new Error(`missing asset ${key}`);
          return new Uint8Array(await obj.arrayBuffer());
        },
        async reserve(stepName, est) {
          await db.rpc('ai_reserve', { p_job: jobId, p_step: stepName, p_micros: est });
        },
        async log(e) {
          await db.rpc('ai_log_generation', {
            p_job: jobId, p_task: e.task, p_provider: e.provider, p_model: e.model, p_cost_micros: e.cost_micros,
            p_latency_ms: e.latency_ms, p_ok: e.ok, p_error_code: e.error_code ?? null, p_output_key: e.output_key ?? null,
            p_prompt_version: PROMPT_VERSION,
          });
        },
        now: () => new Date(),
      };
    },
    fatal: (code) => new NonRetryableError(code),
    hashUser: async (userId) => (await sha256Hex(`reeltale:${userId}`)).slice(0, 32),
    log: (message) => console.error(message),
  };
}

export class StorySceneWorkflow extends WorkflowEntrypoint<Env, StoryScenePayload> {
  async run(event: WorkflowEvent<StoryScenePayload>, step: WorkflowStep): Promise<void> {
    const run = step.do.bind(step) as unknown as AnyStep;
    const runner: StepRunner = { do: (name, config, fn) => run(name, config as WorkflowStepConfig, fn) as Promise<never> };
    await runSceneJob(workerIO(this.env), runner, event.payload.jobId);
  }
}
