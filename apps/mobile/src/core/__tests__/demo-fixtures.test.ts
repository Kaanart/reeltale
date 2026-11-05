import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { StoryManifestSchema, WalletSchema } from '@reeltale/shared';
import { assetFileFromKey } from '../api.ts';
import { comicTimeline } from '../comic.ts';
import { summarizeWallet } from '../wallet.ts';
import {
  DEMO_FREE_EPISODES, DEMO_PANEL_KEYS, DEMO_ROLE, DEMO_USER_ID, demoAccount, demoAiScene, demoAiStory, demoCreators,
  demoEpisodes, demoEpisodesOf, demoManifest, demoSeries, demoTags, demoWallet,
} from '../../demo/fixtures.ts';
import { TERMS_VERSION, termsAccepted } from '../../lib/gate.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('the demo account is an adult who accepted the current Terms, without the editor role', () => {
  assert.equal(demoAccount.age_status, 'adult');
  assert.equal(demoAccount.tos_version, TERMS_VERSION);
  assert.ok(termsAccepted(demoAccount.tos_version));
  assert.equal(demoAccount.user_id, DEMO_USER_ID);
  assert.equal(DEMO_ROLE, 'user');
  assert.equal(demoAccount.mature_opt_in, false);
  assert.ok(!('date_of_birth' in demoAccount), 'the app never loads the date of birth back');
});

test('about six series, covering every format, both maturities, Editor’s Picks and tags', () => {
  assert.ok(demoSeries.length >= 6);
  assert.deepEqual(new Set(demoSeries.map((s) => s.format)), new Set(['live_action', 'stop_motion', 'ai_generated']));
  assert.deepEqual(new Set(demoSeries.map((s) => s.maturity)), new Set(['general', 'mature']));
  assert.ok(demoSeries.some((s) => s.editors_pick && s.format === 'ai_generated'));
  const tagIds = new Set(demoTags.map((t) => t.id));
  const creators = new Set(demoCreators.map((c) => c.id));
  const slugs = new Set<string>();
  for (const s of demoSeries) {
    assert.match(s.id, UUID);
    assert.match(s.slug, /^[a-z0-9-]{3,90}$/);
    assert.ok(!slugs.has(s.slug), `duplicate slug ${s.slug}`);
    slugs.add(s.slug);
    assert.ok(s.title.trim().length >= 1 && s.title.length <= 80);
    assert.ok(s.synopsis.length <= 1000);
    assert.ok(s.tag_ids.length > 0 && s.tag_ids.every((t) => tagIds.has(t)), `${s.slug} tags`);
    assert.ok(s.creator_id && creators.has(s.creator_id));
    assert.equal(s.status, 'published');
    assert.equal(s.moderation_status, 'approved');
    assert.ok(s.free_episode_count >= 3);
    if (s.origin === 'ai_story') assert.equal(s.format, 'ai_generated', 'catalog constraint ai_story_is_ai_format');
  }
});

test('6 to 10 episodes each, the first five free, prices 10–100 coins in steps of 5', () => {
  const ids = new Set<string>();
  for (const s of demoSeries) {
    const eps = demoEpisodesOf(s.id);
    assert.ok(eps.length >= 6 && eps.length <= 10, `${s.slug}: ${eps.length} episodes`);
    eps.forEach((e, i) => {
      assert.match(e.id, UUID);
      assert.ok(!ids.has(e.id));
      ids.add(e.id);
      assert.equal(e.number, i + 1);
      assert.ok(e.duration_s !== null && e.duration_s >= 1 && e.duration_s <= 120);
      assert.equal(e.kind, s.format !== 'ai_generated' ? 'video' : s.origin === 'ai_story' ? 'ai_comic' : 'ai_video');
      if (e.number <= DEMO_FREE_EPISODES) {
        assert.equal(e.is_free, true, `${s.slug} #${e.number} must be free`);
        assert.equal(e.price_coins, null);
      }
      if (!e.is_free) {
        assert.ok(e.price_coins !== null && e.price_coins >= 10 && e.price_coins <= 100 && e.price_coins % 5 === 0, `${s.slug} #${e.number}`);
      }
    });
    // An AI story without Editor's Pick stays free (catalog rule ai_series_free_until_editors_pick).
    if (s.origin === 'ai_story' && !s.editors_pick) assert.ok(eps.every((e) => e.is_free), s.slug);
  }
  assert.equal(ids.size, demoEpisodes.length);
  assert.ok(demoEpisodes.some((e) => !e.is_free), 'something to unlock in the demo');
});

test('the wallet has the get_my_wallet shape and adds up', () => {
  const now = new Date('2026-10-29T12:00:00Z');
  const wallet = WalletSchema.parse(demoWallet(now));
  assert.equal(wallet.balance, wallet.paid + wallet.bonus);
  assert.equal(wallet.bonus, wallet.expiring.reduce((sum, l) => sum + l.coins, 0));
  assert.equal(wallet.refund_debt, 0);
  const summary = summarizeWallet(wallet, now);
  assert.ok(summary.expiring.some((l) => l.soon), 'one lot expires soon, to show the reminder');
});

test('the AI story has one finished scene whose manifest passes the shared schema', () => {
  const manifest = StoryManifestSchema.parse(demoManifest);
  assert.equal(manifest.story_id, demoAiStory.id);
  assert.equal(manifest.scene_id, demoAiScene.id);
  assert.equal(demoAiScene.story_id, demoAiStory.id);
  assert.equal(demoAiScene.status, 'ready');
  assert.equal(demoAiStory.owner_id, DEMO_USER_ID);
  assert.ok(demoAiStory.premise.length >= 20 && demoAiStory.premise.length <= 1000);
  assert.equal(manifest.provenance.ai_generated, true);
  assert.deepEqual(manifest.panels.map((p) => p.image), DEMO_PANEL_KEYS);
  // Local keys, never URLs; and not mistaken for a real scene asset.
  for (const key of DEMO_PANEL_KEYS) {
    assert.ok(!/^[a-z]+:/i.test(key), key);
    assert.equal(assetFileFromKey(key), null);
  }
  assert.ok(comicTimeline(manifest).totalMs > 0, 'the comic player can time it');
});

test('every bundled demo image exists', () => {
  const files = new Set(readdirSync(new URL('../../demo/assets/', import.meta.url)));
  for (const n of [1, 2, 3, 4]) assert.ok(files.has(`panel-${n}.png`));
  assert.equal([...files].filter((f) => f.startsWith('cover-')).length, demoSeries.length);
});
