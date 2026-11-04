import Ionicons from '@expo/vector-icons/Ionicons';
import type { StoryManifest } from '@reeltale/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Button, Text } from '../../../components/ui';
import type { ChoiceId } from '../../../core/api';
import { describeError } from '../../../core/errors';
import { colors, radius, space } from '../../../theme/tokens';
import { ErrorText, TextLink } from '../../auth';
import { useAiPrices, useChildScenes, useChooseScene, useCoinWallet, useStoryConsent } from '../hooks';
import {
  choiceTakeable, chooseOutcome, DEFAULT_AI_PRICES, describeChoices, errorWithoutData, storyTakesChoices, type ChoiceView,
} from '../logic';
import type { AiStoryRow } from '../types';
import { useKeyboardShortcuts } from '../useKeyboardShortcuts';
import { ChoiceList } from './ChoiceList';
import { CoinAmount } from './CoinAmount';
import { ConsentCard } from './ConsentCard';
import { VoiceChoice } from './VoiceChoice';

// What follows a scene that has played: its three choices, or the ending. A choice that leads to a scene
// already made opens it directly (no request, no coins); any other goes to POST /choose, which returns an
// existing scene at once, starts a new one (coins), or says the path can't be drawn (the reader stays and
// picks another). Once the story has reached an ending, only scenes already made open.
//
// Three ways to choose, one rule (logic.ts choiceTakeable): tap a card; on the web press 1, 2 or 3; or, on the
// web, "Say your choice" (VoiceChoice: Muse Voice Transcribe turns the words into text, voiceLogic.ts matches them).
export interface SceneChoicesProps {
  storyId: string;
  sceneId: string;
  manifest: StoryManifest;
  /** The story's status, when loaded: a completed story takes no new choices. */
  storyStatus?: AiStoryRow['status'] | null;
}

const ICON = 32;

export function SceneChoices({ storyId, sceneId, manifest, storyStatus = null }: SceneChoicesProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const hasChoices = !manifest.is_ending && manifest.choices.length > 0;
  const children = useChildScenes(sceneId, hasChoices);
  const prices = useAiPrices();
  const consent = useStoryConsent();
  const wallet = useCoinWallet();
  const choose = useChooseScene();
  const [blocked, setBlocked] = useState<ChoiceId | null>(null);
  // New scenes are asked for only at the price pricing_config gives; the default only fills the labels while it loads.
  const priceKnown = prices.data !== undefined;
  const price = prices.data?.comicScene ?? DEFAULT_AI_PRICES.comicScene;
  const priceError = errorWithoutData(prices);

  const open = (next: string) => router.push({ pathname: '/story/[id]', params: { id: storyId, scene: next } });

  const views = describeChoices(manifest.choices, children.data ?? [], price);
  const canAsk = storyTakesChoices(storyStatus);
  const newDisabled = consent.data !== true || !canAsk || !priceKnown;
  const pending = choose.isPending ? (choose.variables?.choice ?? null) : null;

  const onChoose = (c: ChoiceView) => {
    if (choose.isPending) return;
    setBlocked(null);
    if ((c.state === 'ready' || c.state === 'working') && c.sceneId) {
      open(c.sceneId);
      return;
    }
    if (!priceKnown) return;
    choose.mutate(
      { sceneId, choice: c.id, price },
      {
        onSuccess: (started) => {
          if (chooseOutcome(started) === 'blocked') setBlocked(c.id);
          else open(started.scene_id);
        },
      },
    );
  };

  // 1, 2, 3 on the web (the player handles Space and the arrows). A key does what a tap on that card does.
  useKeyboardShortcuts((shortcut) => {
    if (shortcut.action !== 'choose') return false;
    const c = views[shortcut.index];
    if (!c) return false;
    if (pending === null && choiceTakeable(c, newDisabled)) onChoose(c);
    return true;
  }, hasChoices);

  if (manifest.is_ending || !hasChoices) {
    return (
      <View style={styles.ending} testID="story-ending">
        <Ionicons name="sparkles-outline" size={ICON} color={colors.ai} />
        <Text variant="heading" accessibilityRole="header" style={styles.endingTitle}>
          {t('story:ending.title')}
        </Text>
        <Text color="inkMuted" style={styles.endingBody}>
          {t('story:ending.body')}
        </Text>
        <Button label={t('story:ending.startAnother')} onPress={() => router.push('/story/new')} fullWidth testID="story-start-another" />
      </View>
    );
  }

  const asksNew = canAsk && views.some((v) => v.state === 'new' || v.state === 'failed');
  // Without the consent answer new choices stay closed and the consent card can't show; without the scenes already
  // made, every choice reads as a new one with a cost. Either way: say so, and offer a retry.
  const consentError = asksNew ? errorWithoutData(consent) : null;
  const childrenError = errorWithoutData(children);
  const loadError = priceError ?? consentError ?? childrenError;
  const error = choose.error ? describeError(choose.error) : loadError ? describeError(loadError) : null;
  const reload = () => {
    if (priceError) void prices.refetch();
    if (consentError) void consent.refetch();
    if (childrenError) void children.refetch();
  };

  return (
    <View style={styles.root}>
      {consent.data === false && asksNew ? <ConsentCard /> : null}
      <ChoiceList choices={views} pending={pending} newDisabled={newDisabled} onChoose={onChoose} />
      <VoiceChoice choices={views} newDisabled={newDisabled} busy={pending !== null} onChoose={onChoose} />
      {!canAsk ? (
        <Text variant="bodySmall" color="inkMuted" style={styles.calm} testID="story-closed-note">
          {t('story:choices.storyEnded')}
        </Text>
      ) : null}
      {blocked ? (
        <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.calm} testID="story-blocked-note">
          {t('story:choices.blockedPath')}
        </Text>
      ) : null}
      <ErrorText error={error ? { key: error.key, params: error.params } : null} />
      {loadError && !choose.error ? (
        <View style={styles.retry}>
          <TextLink label={t('common:actions.retry')} onPress={reload} testID="story-choices-reload" />
        </View>
      ) : null}
      {asksNew && wallet.data ? (
        <View style={styles.balance}>
          <Text variant="bodySmall" color="inkMuted">
            {t('story:new.confirm.balance')}
          </Text>
          <CoinAmount coins={wallet.data.balance} variant="bodySmall" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.md },
  calm: {
    padding: space.md,
    borderRadius: radius.card,
    backgroundColor: colors.surfaceAlt,
  },
  retry: { alignItems: 'flex-start', marginLeft: -space.sm },
  balance: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ending: {
    alignItems: 'center',
    padding: space.xl,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  endingTitle: { marginTop: space.sm },
  endingBody: { marginTop: space.xs, marginBottom: space.lg, textAlign: 'center' },
});
