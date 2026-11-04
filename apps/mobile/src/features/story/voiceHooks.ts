// Data for "Say your choice", live or demo (src/lib/data.ts): the voice consent (public.ai_consents, purpose
// 'voice', provider Meta) and the transcription (POST /api/ai/transcribe, voiceLogic.ts createTranscribeClient).
//
// Live: the recording goes to the Worker with the user's own session token and comes back as text; the Worker
// checks the consent again (svc.voice_allowed) before Meta hears anything. Demo: nothing leaves the device; the
// recording is dropped and a canned transcript (./demo.ts) comes back. The consent cell is the Me track's
// ('me.consents'), so the Settings switch and this step agree.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError } from '../../core/api';
import { demoState } from '../../demo';
import { db, fromSource, select, rpc, userKey } from '../../lib/data';
import { refreshSession } from '../../lib/api';
import { config } from '../../lib/env';
import { withSessionRefresh } from '../../lib/retry';
import { supabase } from '../../lib/supabase';
import { useUserId } from '../auth';
import { DEMO_VOICE_TRANSCRIPT } from './demo';
import { AI_CONSENT_VERSION } from './logic';
import { AI_CONSENT_COLUMNS, parseConsentRow, type AiConsentRow } from './types';
import { createTranscribeClient, hasVoiceConsent, VOICE_PROVIDERS } from './voiceLogic';

type DemoConsentRow = Omit<AiConsentRow, 'user_id'>;
const demoConsents = demoState<DemoConsentRow[]>('me.consents', () => []);

async function accessToken(): Promise<string | null> {
  if (!supabase) return null;
  // getSession() refreshes first when the stored token has expired.
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

const noNetwork: typeof fetch = () => Promise.reject(new ApiError(0, 'network_error'));

/** One client for the app session; a token the Worker calls stale is refreshed once and the call tried again. */
const voiceApi = withSessionRefresh(
  createTranscribeClient({
    baseUrl: config.apiUrl,
    getAccessToken: accessToken,
    ...(config.demo ? { fetchImpl: noNetwork } : {}),
  }),
  refreshSession,
);

const voiceConsentKey = (u: string | null | undefined) => userKey(u, 'story', 'voiceConsent');

/** True when the reader has allowed voice input for Meta (this policy version or later). */
export function useVoiceConsent(enabled = true) {
  const userId = useUserId();
  return useQuery({
    queryKey: voiceConsentKey(userId),
    enabled: !!userId && enabled,
    // Settings can withdraw it from another screen: ask again whenever the voice step shows.
    staleTime: 0,
    queryFn: () => fromSource<boolean>({
      demo: () => hasVoiceConsent(demoConsents.get().find((r) => r.purpose === 'voice')),
      live: async () => {
        // RLS returns the reader's own row only; (user_id, purpose) is the key, so there is at most one.
        const raw = await select<unknown>(
          db().from('ai_consents').select(AI_CONSENT_COLUMNS).eq('purpose', 'voice').maybeSingle(),
        );
        if (raw === null) return false;
        const row = parseConsentRow(raw);
        if (!row) throw new ApiError(200, 'invalid_response');
        return hasVoiceConsent(row);
      },
    }),
  });
}

export function useGrantVoiceConsent() {
  const userId = useUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => fromSource<void>({
      demo: () => {
        const row: DemoConsentRow = {
          purpose: 'voice', providers: [...VOICE_PROVIDERS], version: AI_CONSENT_VERSION,
          accepted_at: new Date().toISOString(), withdrawn_at: null,
        };
        demoConsents.set((rows) => [...rows.filter((r) => r.purpose !== 'voice'), row]);
      },
      live: async () => {
        await rpc('set_ai_consent', {
          p_purpose: 'voice', p_providers: [...VOICE_PROVIDERS], p_version: AI_CONSENT_VERSION, p_granted: true,
        });
      },
    }),
    onSuccess: () => {
      queryClient.setQueryData(voiceConsentKey(userId), true);
      void queryClient.invalidateQueries({ queryKey: voiceConsentKey(userId) });
      // Settings (the Me track) lists the same consents.
      void queryClient.invalidateQueries({ queryKey: userKey(userId, 'me', 'consents') });
    },
  });
}

/** Ask the consent again (the Worker said it is missing: withdrawn in Settings on another device, say). */
export function useForgetVoiceConsent() {
  const userId = useUserId();
  const queryClient = useQueryClient();
  return () => {
    queryClient.setQueryData(voiceConsentKey(userId), false);
    void queryClient.invalidateQueries({ queryKey: voiceConsentKey(userId) });
  };
}

export interface TranscribeInput {
  wav: Uint8Array<ArrayBuffer>;
  signal?: AbortSignal;
}

/** The recording as text. Never retried on its own: the reader just speaks again. */
export function useTranscribe() {
  return useMutation({
    mutationFn: ({ wav, signal }: TranscribeInput) => fromSource<{ text: string }>({
      // Demo: the recording stays here and is dropped; a canned answer comes back.
      demo: () => ({ text: DEMO_VOICE_TRANSCRIPT }),
      live: () => voiceApi.transcribe(wav, signal ? { signal } : undefined),
    }),
  });
}
