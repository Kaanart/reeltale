// Meta Model API client (https://api.meta.ai/v1). Request shapes follow dev.meta.ai/docs (checked
// 2026-10-27): Chat Completions with response_format json_schema for Spark/Wonder, the Images API for
// Muse Image, the Responses API for SAM 3.1, multipart ASR for Muse Voice Transcribe.
// The API key lives only in the Worker (secret META_API_KEY); nothing here runs in the app.

import type { z } from 'zod';
import { toModelSchema } from '@reeltale/shared';

export type TextModel = 'muse-spark-1.3' | 'muse-spark-1.2' | 'muse-wonder-1.0';
export type Effort = 'minimal' | 'low' | 'medium' | 'high';

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export class MetaApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  constructor(status: number, code: string, message: string, retryable: boolean) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
}

export interface SamBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  w: number;
  h: number;
}

export interface Transcript {
  transcript: string;
  audioDurationMs: number;
  turns: { turnId: number; startMs: number; endMs: number; transcript: string; speaker?: string }[];
}

export interface MetaClient {
  chatJson<T>(args: {
    model: TextModel;
    system: string;
    user: string | ContentPart[];
    schema: z.ZodType<T>;
    schemaName: string;
    effort?: Effort;
  }): Promise<{ data: T; usage: Usage }>;
  generateImage(args: { prompt: string; size: string; fast?: boolean }): Promise<Uint8Array>;
  editImage(args: { prompt: string; images: string[]; size?: string; fast?: boolean }): Promise<Uint8Array>;
  segmentBoxes(args: { phrase: string; imageUrl: string }): Promise<SamBox[]>;
  transcribe(args: { wav: Uint8Array; languages?: string[]; mode?: 'ENDPOINTING' | 'DIARIZATION' }): Promise<Transcript>;
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

async function fail(res: Response): Promise<never> {
  let code = 'http_error';
  let message = `Meta API ${res.status}`;
  try {
    const body = (await res.json()) as { error?: { code?: string; type?: string; message?: string } };
    code = body.error?.code ?? body.error?.type ?? code;
    message = body.error?.message ?? message;
  } catch {
    /* not JSON */
  }
  if (code === 'content_policy_violation') {
    throw new MetaApiError(res.status, 'content_policy', 'blocked by the provider\'s content policy', false);
  }
  throw new MetaApiError(res.status, code, message.slice(0, 300), RETRYABLE.has(res.status));
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Parse SAM 3.1's box tokens: <|box;x1=..;y1=..;x2=..;y2=..;w=..;h=..|> */
export function parseSamBoxes(text: string): SamBox[] {
  const out: SamBox[] = [];
  const re = /<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)(?:;c=[0-9.]+)?\|>/g;
  for (const m of text.matchAll(re)) {
    const [x1, y1, x2, y2, w, h] = m.slice(1, 7).map(Number) as [number, number, number, number, number, number];
    if (w > 0 && h > 0 && x2 >= x1 && y2 >= y1) out.push({ x1, y1, x2, y2, w, h });
  }
  return out;
}

export function createMetaClient(opts: {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Stable pseudonymous id of the end user (Meta uses it for abuse detection). Never an email. */
  endUserId?: string;
}): MetaClient {
  const base = opts.baseUrl ?? 'https://api.meta.ai/v1';
  const f = opts.fetchImpl ?? fetch;
  const auth = { Authorization: `Bearer ${opts.apiKey}` };
  // Built-in web/image search and code execution are on by default for Muse Image; user stories never
  // need them (they add likeness and copyright risk, latency and unpredictability).
  const imageTools = { enable_image_search: false, enable_web_search: false, enable_shell: false };

  async function postJson(path: string, body: unknown): Promise<unknown> {
    const res = await f(`${base}${path}`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) await fail(res);
    return res.json();
  }

  async function imageCall(path: string, body: Record<string, unknown>): Promise<Uint8Array> {
    const json = (await postJson(path, {
      model: 'muse-image-1.0',
      n: 1,
      response_format: 'b64_json',
      output_format: 'webp',
      tool_enablement: imageTools,
      ...(opts.endUserId ? { user: opts.endUserId } : {}),
      ...body,
    })) as { data?: { b64_json?: string }[] };
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) throw new MetaApiError(502, 'empty_image', 'no image returned', true);
    return decodeBase64(b64);
  }

  return {
    async chatJson({ model, system, user, schema, schemaName, effort }) {
      const json = (await postJson('/chat/completions', {
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: { type: 'json_schema', json_schema: { name: schemaName, schema: toModelSchema(schema), strict: true } },
        reasoning_effort: effort ?? 'low',
      })) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      const content = json.choices?.[0]?.message?.content;
      if (!content) throw new MetaApiError(502, 'empty_output', 'no content returned', true);
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        throw new MetaApiError(502, 'invalid_json', 'model returned invalid JSON', true);
      }
      const r = schema.safeParse(parsed);
      if (!r.success) throw new MetaApiError(502, 'schema_mismatch', r.error.message.slice(0, 300), true);
      return { data: r.data, usage: { input_tokens: json.usage?.prompt_tokens, output_tokens: json.usage?.completion_tokens } };
    },

    generateImage({ prompt, size, fast }) {
      return imageCall('/images/generations', { prompt, size, reasoning_strength: fast ? 'low' : 'high' });
    },

    editImage({ prompt, images, size, fast }) {
      if (images.length < 1 || images.length > 10) throw new MetaApiError(400, 'bad_request', '1–10 images', false);
      return imageCall('/images/edits', {
        prompt,
        images: images.map((url) => ({ image_url: url })),
        ...(size ? { size } : {}),
        reasoning_strength: fast ? 'low' : 'high',
      });
    },

    async segmentBoxes({ phrase, imageUrl }) {
      const json = (await postJson('/responses', {
        model: 'sam-3.1',
        input: [{
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: phrase }, { type: 'input_image', image_url: imageUrl }],
        }],
        stream: false,
      })) as { output_text?: string; output?: { content?: { type?: string; text?: string }[] }[] };
      const text = json.output_text
        ?? (json.output ?? []).flatMap((o) => o.content ?? []).map((c) => c.text ?? '').join('');
      return parseSamBoxes(text);
    },

    async transcribe({ wav, languages, mode }) {
      const form = new FormData();
      form.set('request', new Blob([JSON.stringify({
        model: 'muse-voice-transcribe-1.0',
        audioEncoding: 'WAV',
        mode: mode ?? 'ENDPOINTING',
        ...(languages?.length ? { languageBias: languages } : {}),
      })], { type: 'application/json' }));
      form.set('audio', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');
      const res = await f(`${base}/asr/transcribe`, { method: 'POST', headers: { ...auth, Accept: 'application/json' }, body: form });
      if (!res.ok) await fail(res);
      const json = (await res.json()) as Partial<Transcript>;
      return { transcript: json.transcript ?? '', audioDurationMs: json.audioDurationMs ?? 0, turns: json.turns ?? [] };
    },
  };
}
