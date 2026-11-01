// Data for the Me screens: one hook per thing, each choosing between the real backend and the demo fixtures
// with fromSource (src/lib/data.ts). Screens never import supabase or the API client.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../core/api';
import { parseWallet } from '../../core/wallet';
import { demoProfile } from '../../demo/fixtures';
import { db, fromSource, rpc, select, userKey } from '../../lib/data';
import { PROFILE_COLUMNS, type ProfileRow } from '../../lib/types';
import { useUserId } from '../auth';
import {
  demoBlocksCell, demoConsentsCell, demoContentOwner, demoReportsCell, demoSubscriptionsCell, demoWalletCell,
} from './demo';
import { BLOCK_COLUMNS, isBlockedIn, parseBlocks, type BlockRow } from './logic/blocks';
import { CONSENT_COLUMNS, consentArgs, parseConsents, type AiConsentPurpose, type ConsentRow } from './logic/consent';
import { uuidOrNull, type ReportArgs, type ReportTarget } from './logic/report';
import { parseSubscriptions, SUBSCRIPTION_COLUMNS, type SubscriptionRow } from './logic/subscription';
import { parseVipConfig, VIP_CONFIG_KEYS, VIP_DEFAULTS, type VipPerks } from './logic/vip';

export { demoWalletCell } from './demo';

/** A parsed list, or the "answer wasn't the shape we expected" error that errors.ts words for the user. */
function checked<T>(value: T | null): T {
  if (value === null) throw new ApiError(0, 'invalid_response');
  return value;
}

/** The wallet (balance, paid, bonus lots, Free Passes). The key is shared: spending coins invalidates it. */
export function useWallet() {
  const userId = useUserId();
  return useQuery({
    queryKey: userKey(userId, 'wallet'),
    enabled: !!userId,
    queryFn: () => fromSource({
      demo: () => demoWalletCell.get(),
      live: () => rpc('get_my_wallet', undefined, parseWallet),
    }),
  });
}

/** The signed-in person's public profile row (display name, handle, bio). Null when there is none yet. */
export function useMyProfile() {
  const userId = useUserId();
  return useQuery({
    queryKey: userKey(userId, 'me', 'profile'),
    enabled: !!userId,
    queryFn: () => fromSource<ProfileRow | null>({
      demo: () => demoProfile,
      live: () => select<ProfileRow | null>(
        db().from('profiles').select(PROFILE_COLUMNS).eq('id', userId ?? '').maybeSingle(),
      ),
    }),
  });
}

/** The account's own subscriptions (owner-only rows). */
export function useSubscriptions() {
  const userId = useUserId();
  return useQuery({
    queryKey: userKey(userId, 'me', 'subscriptions'),
    enabled: !!userId,
    queryFn: () => fromSource<SubscriptionRow[]>({
      demo: () => demoSubscriptionsCell.get(),
      live: async () => checked(parseSubscriptions(await select<unknown>(
        db().from('subscriptions').select(SUBSCRIPTION_COLUMNS).eq('user_id', userId ?? ''),
      ))),
    }),
  });
}

/** The numbers behind the VIP perks (public.pricing_config). The page shows the defaults until they load. */
export function useVipPerks(): VipPerks {
  const userId = useUserId();
  const { data } = useQuery({
    queryKey: userKey(userId, 'me', 'vipPerks'),
    enabled: !!userId,
    queryFn: () => fromSource<VipPerks>({
      demo: () => VIP_DEFAULTS,
      live: async () => parseVipConfig(await select<unknown>(
        db().from('pricing_config').select('key, value').in('key', [...VIP_CONFIG_KEYS]),
      )),
    }),
  });
  return data ?? VIP_DEFAULTS;
}

// ---- AI consents ---------------------------------------------------------------------------------------

export function useAiConsents() {
  const userId = useUserId();
  return useQuery({
    queryKey: userKey(userId, 'me', 'consents'),
    enabled: !!userId,
    queryFn: () => fromSource<ConsentRow[]>({
      demo: () => demoConsentsCell.get(),
      live: async () => checked(parseConsents(await select<unknown>(
        db().from('ai_consents').select(CONSENT_COLUMNS).eq('user_id', userId ?? ''),
      ))),
    }),
  });
}

/** Give or withdraw consent for one purpose (public.set_ai_consent). */
export function useSetAiConsent() {
  const userId = useUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ purpose, granted, existing }: { purpose: AiConsentPurpose; granted: boolean; existing?: ConsentRow }) => {
      const args = consentArgs(purpose, granted, existing);
      return fromSource<void>({
        demo: () => {
          demoConsentsCell.set((rows) => {
            const others = rows.filter((r) => r.purpose !== purpose);
            const now = new Date().toISOString();
            return [...others, {
              purpose, providers: args.p_providers, version: args.p_version,
              accepted_at: granted ? now : (existing?.accepted_at ?? now), withdrawn_at: granted ? null : now,
            }];
          });
        },
        live: async () => { await rpc('set_ai_consent', { ...args }); },
      });
    },
    // The story feature caches its own answer (storyKeys.consent in features/story/hooks.ts): a withdrawal
    // here has to reach the Create screens at once, not after their cache goes stale.
    onSettled: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: userKey(userId, 'me', 'consents') }),
      queryClient.invalidateQueries({ queryKey: userKey(userId, 'story', 'consent') }),
    ]),
  });
}

// ---- Account deletion ----------------------------------------------------------------------------------

/** Starts the deletion (public.request_account_deletion). The caller signs the user out afterwards. */
export function useRequestAccountDeletion() {
  return useMutation({
    mutationFn: () => fromSource<void>({
      demo: () => undefined,
      live: async () => { await rpc('request_account_deletion'); },
    }),
  });
}

// ---- Reports and blocks --------------------------------------------------------------------------------

/** Sends a report (public.report_content); reporting the same thing twice returns the first report. */
export function useReportContent() {
  return useMutation({
    mutationFn: (args: ReportArgs) => fromSource<void>({
      demo: () => {
        demoReportsCell.set((rows) => [...rows, {
          id: rows.length + 1, target_type: args.p_target_type, target_id: args.p_target_id, reason: args.p_reason,
        }]);
      },
      live: async () => { await rpc('report_content', { ...args }); },
    }),
  });
}

/**
 * Who made the reported series or episode, as the database says (series.creator_id): the person the report
 * confirmation offers to block. Never taken from the link. AI scenes can only be read by their owner, so
 * there is nobody else to name; a reported profile is the person itself. Null when it can't be read.
 */
export function useContentOwner(target: ReportTarget | null) {
  const userId = useUserId();
  const type = target?.type ?? null;
  const id = target?.id ?? null;
  return useQuery({
    queryKey: userKey(userId, 'me', 'owner', type, id),
    enabled: !!userId && !!id && (type === 'series' || type === 'episode'),
    queryFn: () => fromSource<string | null>({
      demo: () => demoContentOwner(type, id),
      live: async () => {
        let seriesId = id;
        if (type === 'episode') {
          const episode = await select<{ series_id?: unknown } | null>(
            db().from('episodes').select('series_id').eq('id', id ?? '').maybeSingle(),
          );
          seriesId = uuidOrNull(episode?.series_id);
        }
        if (!seriesId) return null;
        const series = await select<{ creator_id?: unknown } | null>(
          db().from('series').select('creator_id').eq('id', seriesId).maybeSingle(),
        );
        return uuidOrNull(series?.creator_id);
      },
    }),
  });
}

/** Has the signed-in person blocked this account? (public.blocks: owner-only rows.) */
export function useIsBlocked(targetId: string | null) {
  const userId = useUserId();
  return useQuery({
    queryKey: userKey(userId, 'me', 'blocked', targetId),
    enabled: !!userId && !!targetId,
    queryFn: () => fromSource<boolean>({
      demo: () => isBlockedIn(demoBlocksCell.get(), targetId ?? ''),
      live: async () => {
        const row = await select<unknown>(
          db().from('blocks').select('blocked_id').eq('blocked_id', targetId ?? '').maybeSingle(),
        );
        return row !== null && row !== undefined;
      },
    }),
  });
}

/** Everyone the signed-in person has blocked, newest first (public.blocks: owner-only rows). */
export function useBlockedAccounts() {
  const userId = useUserId();
  return useQuery({
    queryKey: userKey(userId, 'me', 'blocks'),
    enabled: !!userId,
    queryFn: () => fromSource<BlockRow[]>({
      demo: () => demoBlocksCell.get(),
      live: async () => checked(parseBlocks(await select<unknown>(
        db().from('blocks').select(BLOCK_COLUMNS).order('created_at', { ascending: false }),
      ))),
    }),
  });
}

/** Block or unblock an account (public.block_user / public.unblock_user). */
export function useSetBlocked() {
  const userId = useUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ target, blocked }: { target: string; blocked: boolean }) => fromSource<void>({
      demo: () => {
        const id = target.toLowerCase();
        demoBlocksCell.set((rows) => (blocked
          ? (isBlockedIn(rows, id) ? rows : [{ blocked_id: id, created_at: new Date().toISOString() }, ...rows])
          : rows.filter((r) => r.blocked_id !== id)));
      },
      live: async () => { await rpc(blocked ? 'block_user' : 'unblock_user', { p_user: target }); },
    }),
    onSuccess: (_data, { target, blocked }) => {
      queryClient.setQueryData(userKey(userId, 'me', 'blocked', target), blocked);
      void queryClient.invalidateQueries({ queryKey: userKey(userId, 'me', 'blocks') });
      // Series and profiles of a blocked creator stop showing (and come back on unblock): the catalog reloads.
      void queryClient.invalidateQueries({ queryKey: userKey(userId, 'catalog') });
    },
  });
}
