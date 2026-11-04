import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PageContainer, useLayout, usePageTitle } from '../../../components/layout';
import { AIBadge, Button, Skeleton, Text } from '../../../components/ui';
import { describeError } from '../../../core/errors';
import { isDemo } from '../../../lib/data';
import { colors, layout, space } from '../../../theme/tokens';
import { TextLink, useUserId } from '../../auth';
import { reportHref } from '../../me';
import { ComicPlayer } from '../components/ComicPlayer';
import { HowMadeSheet } from '../components/HowMadeSheet';
import { JobProgress } from '../components/JobProgress';
import { PageHead } from '../components/PageHead';
import { SceneChoices } from '../components/SceneChoices';
import { SceneFailure } from '../components/SceneFailure';
import { ScreenHeader } from '../components/ScreenHeader';
import {
  storyKeys, useAiPrices, useChildScenes, useChooseScene, useLatestSceneId, useRefreshAfterScene, useSceneManifest,
  useSceneState, useStory,
} from '../hooks';
import {
  asUuid, DEFAULT_AI_PRICES, describeScene, errorWithoutData, offeredFailureActions, sceneBelow, storyListTitle,
  type FailureAction, type ScenePhase, type StackStateLike,
} from '../logic';

// story/[id]?scene=<sceneId>: one scene of the reader's AI story. While the scene is made it shows the
// job's progress (polled every ~2 s), then plays the living comic and offers the choices; a scene that
// couldn't be made says the coins came back and what to do next. Without `scene` it opens the scene made
// last. The AI label is always on screen, "How this scene was made" shows the manifest's provenance, and
// a finished scene can be reported (the Me track's /report route, target ai_scene).
//
// Two layouts. Phones and the apps: the story's own header bar, then one column. A laptop-sized browser window
// (the site's top bar is showing): a page whose head (back, story title, AI label, "How this scene was made"
// as a dialog) sits in the side column beside a large comic stage, with the narration, the choices and a
// transcript of the panels below it (ComicPlayer layout 'split'). Keys there: Space, the arrows, 1 2 3.

const MAX_WIDTH = 560;
const ICON = 24;
const TARGET = 44;

/** What the player uses of its navigation object: the root stack's state, and its own route params. */
interface PlayerNavigation {
  getState(): StackStateLike | undefined;
  setParams(params: { scene: string }): void;
}

export function StoryPlayerScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const navigation = useNavigation<PlayerNavigation>();
  const userId = useUserId();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id?: string; scene?: string }>();
  const storyId = asUuid(params.id);
  const sceneParam = asUuid(params.scene);
  const [infoOpen, setInfoOpen] = useState(false);
  const { hasTopNav } = useLayout();
  // Not the story's title: it was written from the reader's own words, and browsers keep titles in their history.
  usePageTitle(t('story:player.pageTitle'));

  const story = useStory(storyId);
  const latest = useLatestSceneId(storyId, !sceneParam);
  const sceneId = sceneParam ?? latest.data ?? null;
  const state = useSceneState(sceneId);
  const view = state.data ? describeScene(state.data.scene, state.data.job) : null;
  // A refetch that fails later (refocus, a poll) keeps what was loaded: only an error with nothing to show replaces the scene.
  const latestError = errorWithoutData(latest);
  const sceneError = errorWithoutData(state);
  const manifest = useSceneManifest(sceneId, view?.phase === 'ready');
  // A scene the reader has already chosen from shows its choices at once (no need to watch it again).
  const children = useChildScenes(sceneId, view?.phase === 'ready');
  const prices = useAiPrices();
  const retry = useChooseScene();
  const refreshAfter = useRefreshAfterScene();

  // When a scene we watched being made settles, the wallet (a failure refunds), the story and the parent's choices change.
  const lastPhase = useRef<ScenePhase | null>(null);
  const phase = view?.phase ?? null;
  const scene = state.data?.scene ?? null;
  useEffect(() => {
    if (lastPhase.current === 'working' && phase && phase !== 'working' && scene) refreshAfter(scene);
    lastPhase.current = phase;
  }, [phase, scene, refreshAfter]);

  // Opened without a scene (from the story list): name the scene it opened at in the route, so this screen keeps
  // showing it when a later scene becomes the newest, and "Try another choice" in a child can tell it is the parent.
  useEffect(() => {
    if (!sceneParam && latest.data) navigation.setParams({ scene: latest.data });
  }, [sceneParam, latest.data, navigation]);

  const title = (story.data ? storyListTitle(story.data.story) : null) ?? t('common:format.ai_generated');
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/create'));

  const onFailureAction = (action: FailureAction) => {
    if (!scene || !storyId) return;
    if (action === 'edit') {
      router.replace({ pathname: '/story/new', params: { from: storyId } });
    } else if (action === 'tryAnother' && scene.parent_scene_id) {
      // Back to the parent when it is the screen below (it keeps its place); otherwise open it here. (dismissTo
      // would match this very screen, which has the same route name, and only change its params.)
      if (sceneBelow(navigation.getState()) === scene.parent_scene_id) router.back();
      else router.replace({ pathname: '/story/[id]', params: { id: storyId, scene: scene.parent_scene_id } });
    } else if (action === 'retry' && scene.parent_scene_id && scene.chosen_choice && prices.data && !retry.isPending) {
      // svc.ai_choose makes a failed scene again under the same id; follow the answer in case that ever changes.
      retry.mutate(
        { sceneId: scene.parent_scene_id, choice: scene.chosen_choice, price: prices.data.comicScene },
        {
          onSuccess: (started) => {
            if (started.scene_id !== scene.id) {
              router.replace({ pathname: '/story/[id]', params: { id: storyId, scene: started.scene_id } });
            } else {
              void queryClient.invalidateQueries({ queryKey: storyKeys.scene(userId, scene.id) });
            }
          },
        },
      );
    }
  };

  const loadError = (!storyId && 'not_found') || latestError || sceneError || (sceneParam === null && latest.data === null && 'not_found');
  let body: ReactNode = null;
  if (loadError) {
    const info = describeError(loadError);
    body = (
      <View style={styles.message} testID="story-load-error">
        <Text accessibilityRole="alert">{t(info.key, info.params)}</Text>
        {info.retryable ? (
          <Button label={t('common:actions.retry')} onPress={() => void (latestError ? latest.refetch() : state.refetch())} variant="secondary" />
        ) : null}
      </View>
    );
  } else if (!view || !scene || !storyId || !sceneId) {
    body = <Loading label={t('story:player.loading')} />;
  } else if (view.phase === 'working') {
    body = <JobProgress view={view} />;
  } else if (view.phase === 'failed' || view.phase === 'blocked') {
    const err = retry.error ? describeError(retry.error) : null;
    body = (
      <SceneFailure
        view={{ ...view, actions: offeredFailureActions(view.actions, story.data?.story.status, !!prices.data) }}
        retryPrice={prices.data?.comicScene ?? DEFAULT_AI_PRICES.comicScene}
        onAction={onFailureAction}
        busy={retry.isPending}
        error={err ? { key: err.key, params: err.params } : null}
      />
    );
  } else if (manifest.error) {
    const info = describeError(manifest.error);
    body = (
      <View style={styles.message}>
        <Text accessibilityRole="alert">{t('story:player.loadFailed')}</Text>
        <Text color="inkMuted">{t(info.key, info.params)}</Text>
        <Button label={t('common:actions.retry')} onPress={() => void manifest.refetch()} variant="secondary" />
      </View>
    );
  } else if (!manifest.data) {
    body = <Loading label={t('story:player.loading')} />;
  }

  const ready = !loadError && view?.phase === 'ready' && !!manifest.data && !!storyId && !!sceneId;
  const player = (playerLayout: 'stacked' | 'split', header?: ReactNode, footer?: ReactNode) => (
    manifest.data && storyId && sceneId ? (
      <ComicPlayer
        key={sceneId}
        sceneId={sceneId}
        manifest={manifest.data}
        showAfterAtOnce={(children.data?.length ?? 0) > 0}
        after={<SceneChoices storyId={storyId} sceneId={sceneId} manifest={manifest.data} storyStatus={story.data?.story.status ?? null} />}
        layout={playerLayout}
        header={header}
        footer={footer}
      />
    ) : null
  );
  const demoNote = isDemo && story.data?.sample ? (
    <Text variant="bodySmall" color="inkMuted" style={styles.note}>
      {t('story:player.demoSample')}
    </Text>
  ) : null;
  const sceneNumber = scene ? (
    <Text variant="caption" color="inkMuted" style={styles.sceneNumber}>
      {t('story:player.scene', { number: scene.depth })}
    </Text>
  ) : null;
  const report = ready && sceneId ? (
    <View style={styles.report}>
      <TextLink
        label={t('story:player.reportScene')}
        onPress={() => router.push(reportHref('ai_scene', sceneId))}
        testID="story-report"
      />
    </View>
  ) : null;
  const howMade = <HowMadeSheet visible={infoOpen} onClose={() => setInfoOpen(false)} manifest={manifest.data ?? null} />;

  if (hasTopNav) {
    const head = (
      <PageHead
        title={title}
        onBack={goBack}
        variant={ready ? 'subheading' : 'title'}
        right={(
          <>
            <AIBadge onPress={() => setInfoOpen(true)} testID="story-ai-badge" />
            <Button
              label={t('story:player.info')}
              onPress={() => setInfoOpen(true)}
              variant="secondary"
              size="sm"
              icon={<Ionicons name="information-circle-outline" size={ICON - space.xs} color={colors.ink} />}
              testID="story-info"
            />
          </>
        )}
      >
        {demoNote}
        {sceneNumber}
      </PageHead>
    );
    return (
      <PageContainer testID="story-page">
        <Stack.Screen options={{ title }} />
        {ready ? player('split', head, report) : (
          <View style={styles.deskColumn}>
            {head}
            <View style={styles.deskBody}>{body}</View>
          </View>
        )}
        {howMade}
      </PageContainer>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <Stack.Screen options={{ title }} />
      <ScreenHeader
        title={title}
        onBack={goBack}
        right={(
          <>
            <View style={styles.badge}>
              <AIBadge onPress={() => setInfoOpen(true)} testID="story-ai-badge" />
            </View>
            <Pressable
              onPress={() => setInfoOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={t('story:player.info')}
              style={({ pressed }) => [styles.icon, pressed && styles.pressed]}
              testID="story-info"
            >
              <Ionicons name="information-circle-outline" size={ICON} color={colors.ink} />
            </Pressable>
          </>
        )}
      />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.column}>
          {demoNote}
          {sceneNumber}
          {ready ? player('stacked') : body}
          {report}
        </View>
      </ScrollView>
      {howMade}
    </SafeAreaView>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <View style={styles.loading} accessible accessibilityRole="progressbar" accessibilityLabel={label}>
      <Skeleton height={space.xl} width="60%" />
      <Skeleton height={space.xxl * 10} />
      <Text variant="bodySmall" color="inkMuted">
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, paddingHorizontal: space.lg, paddingVertical: space.lg },
  column: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' },
  deskColumn: { width: '100%', maxWidth: layout.readingMaxWidth, alignSelf: 'center' },
  deskBody: { marginTop: space.xl, width: '100%', maxWidth: MAX_WIDTH },
  note: { marginBottom: space.md },
  sceneNumber: { marginBottom: space.xs },
  message: { gap: space.md, alignItems: 'flex-start' },
  report: { alignItems: 'flex-start', marginTop: space.xl, marginLeft: -space.sm },
  loading: { gap: space.md },
  icon: { width: TARGET, height: TARGET, alignItems: 'center', justifyContent: 'center' },
  // AIBadge aligns itself to the start; this centres it on the header line.
  badge: { height: TARGET, justifyContent: 'center' },
  pressed: { opacity: 0.6 },
});
