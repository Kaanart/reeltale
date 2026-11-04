import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View, type Text as RNText, type TextInput } from 'react-native';

import { TwoColumn, useLayout, usePageTitle } from '../../components/layout';
import { Text } from '../../components/ui';
import { isDemo } from '../../lib/env';
import { colors, fonts, layout, radius, space } from '../../theme/tokens';
import { TURNSTILE_SITE_KEY } from '../me/redeem/siteKey';
import { CtaButton, CtaLink } from './components/Cta';
import { CheckRow, ChoiceGroup, FieldMessage, FieldSet, FormField, type Choice } from './components/FormControls';
import { Heading } from './components/Heading';
import { MailLink } from './components/MailLink';
import { PublicPage } from './components/PublicPage';
import { Turnstile, type TurnstileHandle } from './components/Turnstile';
import { useMetaDescription } from './components/useMetaDescription';
import { SUPPORT_EMAIL } from './logic/landing';
import {
  checkNotice, contactOptional, DETAILS_MAX, EMAIL_MAX, EMPTY_DRAFT, firstProblem, NAME_MAX, NOTICE_REASON_ORDER,
  NOTICE_TARGET_TYPES, noticeBody, noticeErrorKey, parseTarget, reasonLabelKey, sendNotice, targetLabelKey,
  type NoticeDraft, type NoticeField, type NoticeReason, type NoticeTargetType,
} from './logic/notice';

// /notice (web, public): the EU DSA Art. 16 notice form for illegal content, for anyone, signed in or not.
// It posts to the Worker's POST /api/report with a Turnstile token (action "report"). Every check the Worker
// makes runs here first (logic/notice.ts, the same zod schema), so a typo never leaves the browser.
//
// Three ways it can look:
//   live          the form, the Turnstile check, and a real send
//   demo          the form without Turnstile; nothing is sent (demo mode has no network at all)
//   unavailable   no Turnstile site key in this build: no form, the support address instead
//
// Nothing is stored: the fields live in React state only, and are cleared once the notice is sent. The
// confirmation repeats none of them.

type Mode = 'live' | 'demo' | 'unavailable';
const MODE: Mode = isDemo ? 'demo' : TURNSTILE_SITE_KEY ? 'live' : 'unavailable';

type Sent = 'live' | 'demo';
type IconName = ComponentProps<typeof Ionicons>['name'];
type Focusable = { focus?: () => void } | null;

function focusNode(node: unknown) {
  (node as Focusable)?.focus?.();
}

export function NoticeScreen() {
  const { t } = useTranslation();
  usePageTitle(t('notice:title'));
  useMetaDescription(t('notice:description'));
  const scroll = useRef<ScrollView>(null);
  const [sent, setSent] = useState<Sent | null>(null);

  const toTop = () => scroll.current?.scrollTo({ y: 0, animated: false });
  const onSent = useCallback((kind: Sent) => {
    setSent(kind);
    toTop();
  }, []);
  const again = useCallback(() => {
    setSent(null);
    toTop();
  }, []);

  const main = sent !== null
    ? <Done kind={sent} onAgain={again} />
    : MODE === 'unavailable'
      ? <Unavailable />
      : <NoticeForm demo={MODE === 'demo'} onSent={onSent} />;

  return (
    <PublicPage width="content" scrollRef={scroll} testID="notice">
      <View style={styles.header}>
        <Heading level={1}>{t('notice:title')}</Heading>
        <Text variant="subheading" color="inkMuted" style={styles.lead}>
          {t('notice:lead')}
        </Text>
        <Text variant="body" color="inkMuted" style={styles.inApp}>
          {t('notice:inApp')}
        </Text>
      </View>
      <TwoColumn main={main} side={<Side />} stickySide sideLabel={t('notice:side.a11y')} gap={space.xxl} />
    </PublicPage>
  );
}

// ---- The form ----------------------------------------------------------------------------------------------

function NoticeForm({ demo, onSent }: { demo: boolean; onSent: (kind: Sent) => void }) {
  const { t } = useTranslation();
  const { isCompact } = useLayout();
  const [draft, setDraft] = useState<NoticeDraft>(EMPTY_DRAFT);
  // The type follows the pasted link until the notifier picks one themselves.
  const [autoType, setAutoType] = useState(true);
  const [tried, setTried] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [checkFailed, setCheckFailed] = useState(false);
  const [waitForCheck, setWaitForCheck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const widget = useRef<TurnstileHandle | null>(null);

  const typeFocus = useRef<(() => void) | null>(null);
  const reasonFocus = useRef<(() => void) | null>(null);
  const targetRef = useRef<TextInput>(null);
  const detailsRef = useRef<TextInput>(null);
  const nameRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const goodFaithRef = useRef<View>(null);

  const result = useMemo(() => checkNotice(draft), [draft]);
  // Problems show once the notifier has tried to send, then update as they type.
  const problems = tried && !result.ok ? result.problems : {};
  const problem = (field: NoticeField) => {
    const key = problems[field];
    return key ? t(key, { email: SUPPORT_EMAIL }) : null;
  };
  const optional = contactOptional(draft.reason);

  const typeOptions = useMemo<Choice<NoticeTargetType>[]>(
    () => NOTICE_TARGET_TYPES.map((type) => ({ value: type, label: t(targetLabelKey(type)) })),
    [t],
  );
  const reasonOptions = useMemo<Choice<NoticeReason>[]>(
    () => NOTICE_REASON_ORDER.map((reason) => ({ value: reason, label: t(reasonLabelKey(reason)) })),
    [t],
  );

  const edit = (patch: Partial<NoticeDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setSendError(null);
  };
  const onTarget = (text: string) => {
    setDraft((d) => ({ ...d, target: text, targetType: autoType ? parseTarget(text).type : d.targetType }));
    setSendError(null);
  };
  const onType = (type: NoticeTargetType) => {
    setAutoType(false);
    edit({ targetType: type });
  };

  const focusField = (field: NoticeField) => {
    switch (field) {
      case 'targetType': return typeFocus.current?.();
      case 'target': return targetRef.current?.focus();
      case 'reason': return reasonFocus.current?.();
      case 'details': return detailsRef.current?.focus();
      case 'name': return nameRef.current?.focus();
      case 'email': return emailRef.current?.focus();
      case 'goodFaith': return focusNode(goodFaithRef.current);
    }
  };

  const newCheck = () => {
    // A Turnstile token works once: every attempt needs a new one.
    setToken(null);
    widget.current?.reset();
  };

  const finish = (kind: Sent) => {
    setDraft(EMPTY_DRAFT);
    setAutoType(true);
    setTried(false);
    setToken(null);
    setWaitForCheck(false);
    onSent(kind);
  };

  const submit = async () => {
    if (busyRef.current) return;
    setTried(true);
    setSendError(null);
    const checked = checkNotice(draft);
    if (!checked.ok) {
      const first = firstProblem(checked.problems);
      if (first) focusField(first);
      return;
    }
    if (demo) {
      finish('demo');
      return;
    }
    if (!token) {
      setWaitForCheck(true);
      return;
    }
    const body = noticeBody(checked.fields, token);
    if (!body) {
      setSendError('notice:errors.rejected');
      newCheck();
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      await sendNotice(body, { origin: window.location.origin });
      finish('live');
    } catch (err) {
      setSendError(noticeErrorKey(err));
      newCheck();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const send = () => void submit();

  return (
    <View role="form" aria-label={t('notice:formA11y')} style={styles.form} testID="notice-form">
      {demo ? (
        <Note icon="information-circle-outline" text={t('notice:demo', { email: SUPPORT_EMAIL })} testID="notice-demo" />
      ) : null}
      {tried && !result.ok ? (
        <View role="alert" style={styles.summary} testID="notice-summary">
          <Text variant="body" color="accentStrong" style={styles.summaryText}>
            {t('notice:fixFields')}
          </Text>
        </View>
      ) : null}

      <FieldSet id="notice-what" title={t('notice:fields.whatTitle')}>
        <ChoiceGroup
          id="notice-type"
          label={t('notice:fields.targetType')}
          options={typeOptions}
          value={draft.targetType}
          onChange={onType}
          error={problem('targetType')}
          variant="chips"
          focusRef={typeFocus}
          testID="notice-type"
        />
        <FormField
          id="notice-target"
          label={t('notice:fields.target')}
          hint={t('notice:fields.targetHint')}
          error={problem('target')}
          required
          value={draft.target}
          onChangeText={onTarget}
          inputRef={targetRef}
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          spellCheck={false}
          maxLength={2048}
          onSubmitEditing={send}
          testID="notice-target"
        />
        <ChoiceGroup
          id="notice-reason"
          label={t('notice:fields.reason')}
          options={reasonOptions}
          value={draft.reason}
          onChange={(reason) => edit({ reason })}
          error={problem('reason')}
          focusRef={reasonFocus}
          testID="notice-reason"
        />
        <FormField
          id="notice-details"
          label={t('notice:fields.details')}
          hint={t('notice:fields.detailsHint')}
          error={problem('details')}
          required
          lines={6}
          aside={t('notice:fields.detailsCount', { current: draft.details.trim().length, max: DETAILS_MAX })}
          value={draft.details}
          onChangeText={(details) => edit({ details })}
          inputRef={detailsRef}
          autoComplete="off"
          maxLength={DETAILS_MAX * 2}
          testID="notice-details"
        />
      </FieldSet>

      <FieldSet
        id="notice-contact"
        title={t('notice:fields.contactTitle')}
        hint={
          <Text variant="body" color="inkMuted">
            {optional ? t('notice:fields.contactOptional') : t('notice:fields.contactHint')}
          </Text>
        }
      >
        <View style={[styles.contact, !isCompact && styles.contactRow]}>
          <View style={styles.contactField}>
            <FormField
              id="notice-name"
              label={optional ? t('notice:fields.optionalLabel', { label: t('notice:fields.name') }) : t('notice:fields.name')}
              error={problem('name')}
              required={!optional}
              value={draft.name}
              onChangeText={(name) => edit({ name })}
              inputRef={nameRef}
              autoComplete="name"
              textContentType="name"
              maxLength={NAME_MAX * 2}
              onSubmitEditing={send}
              testID="notice-name"
            />
          </View>
          <View style={styles.contactField}>
            <FormField
              id="notice-email"
              label={optional ? t('notice:fields.optionalLabel', { label: t('notice:fields.email') }) : t('notice:fields.email')}
              error={problem('email')}
              required={!optional}
              value={draft.email}
              onChangeText={(email) => edit({ email })}
              inputRef={emailRef}
              keyboardType="email-address"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              spellCheck={false}
              maxLength={EMAIL_MAX}
              onSubmitEditing={send}
              testID="notice-email"
            />
          </View>
        </View>
      </FieldSet>

      <FieldSet id="notice-send" title={t('notice:fields.sendTitle')}>
        <CheckRow
          id="notice-good-faith"
          label={t('notice:fields.goodFaith')}
          checked={draft.goodFaith}
          onChange={(goodFaith) => edit({ goodFaith })}
          error={problem('goodFaith')}
          checkRef={goodFaithRef}
          testID="notice-good-faith"
        />

        {!demo && TURNSTILE_SITE_KEY ? (
          <View style={styles.check}>
            <Text variant="body" style={styles.checkLabel}>
              {t('notice:fields.check')}
            </Text>
            <Turnstile
              siteKey={TURNSTILE_SITE_KEY}
              action="report"
              label={t('notice:fields.check')}
              handle={widget}
              onToken={(next) => {
                setToken(next);
                setCheckFailed(false);
                setWaitForCheck(false);
              }}
              onInvalid={() => setToken(null)}
              onError={() => {
                setToken(null);
                setCheckFailed(true);
              }}
            />
            {checkFailed ? (
              <FieldMessage id="notice-check-message" error={t('notice:fields.checkFailed', { email: SUPPORT_EMAIL })} />
            ) : waitForCheck && !token ? (
              <FieldMessage id="notice-check-message" error={t('notice:errors.checkPending')} />
            ) : !token ? (
              <Text variant="bodySmall" color="inkMuted">
                {t('notice:fields.checking')}
              </Text>
            ) : null}
          </View>
        ) : null}

        <View style={styles.submit}>
          {sendError ? (
            <View role="alert" style={styles.sendError} testID="notice-error">
              <FieldMessage id="notice-send-message" error={t(sendError, { email: SUPPORT_EMAIL })} />
            </View>
          ) : null}
          <View style={isCompact ? null : styles.submitButton}>
            <CtaButton
              label={busy ? t('notice:submitting') : t('notice:submit')}
              onPress={send}
              busy={busy}
              block={isCompact}
              testID="notice-submit"
            />
          </View>
        </View>
      </FieldSet>
    </View>
  );
}

// ---- After sending, and without the form -------------------------------------------------------------------

function Done({ kind, onAgain }: { kind: Sent; onAgain: () => void }) {
  const { t } = useTranslation();
  const { isCompact } = useLayout();
  const heading = useRef<RNText>(null);
  // Move focus to the confirmation, so keyboard and screen-reader users land on it.
  useEffect(() => {
    focusNode(heading.current);
  }, []);
  const demo = kind === 'demo';
  // ref and tabIndex reach the heading's DOM node (React 19 passes ref as a prop); RN's Text types list neither.
  const focusable = { ref: heading, tabIndex: -1 } as object;

  return (
    <View style={styles.panel} testID="notice-done">
      <View aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Ionicons name={demo ? 'information-circle-outline' : 'checkmark-circle'} size={ICON_LARGE} color={demo ? colors.ink : colors.success} />
      </View>
      <Heading level={2} variant="heading" {...focusable} style={styles.doneTitle}>
        {demo ? t('notice:done.demoTitle') : t('notice:done.title')}
      </Heading>
      <Text variant="body" style={styles.para}>
        {demo ? t('notice:done.demoBody', { email: SUPPORT_EMAIL }) : t('notice:done.body')}
      </Text>
      {demo ? null : (
        <Text variant="body" color="inkMuted" style={styles.para}>
          {t('notice:done.contact')}
        </Text>
      )}
      <Text variant="bodySmall" color="inkMuted" style={styles.para}>
        {t('notice:done.cleared')}
      </Text>
      <View style={[styles.doneActions, isCompact && styles.doneActionsStacked]}>
        <CtaButton label={t('notice:done.another')} onPress={onAgain} variant="secondary" block={isCompact} testID="notice-another" />
        <CtaLink href="/" label={t('notice:done.home')} variant="secondary" block={isCompact} testID="notice-home" />
      </View>
    </View>
  );
}

function Unavailable() {
  const { t } = useTranslation();
  return (
    <View style={styles.panel} testID="notice-unavailable">
      <Heading level={2} variant="heading">
        {t('notice:unavailable.title')}
      </Heading>
      <Text variant="body" style={styles.para}>
        {t('notice:unavailable.body')}
      </Text>
      <View style={styles.mail}>
        <MailLink subject={t('notice:title')} />
      </View>
    </View>
  );
}

function Side() {
  const { t } = useTranslation();
  return (
    <View style={styles.side}>
      <Heading level={2} variant="heading">
        {t('notice:side.title')}
      </Heading>
      <Note icon="eye-outline" text={t('notice:side.review')} plain />
      <Note icon="lock-closed-outline" text={t('notice:side.privacy')} plain />
      <Note icon="warning-outline" text={t('notice:side.emergency')} plain />
      <View style={styles.sideMail}>
        <Text variant="body" color="inkMuted">
          {t('notice:side.email')}
        </Text>
        <View style={styles.mail}>
          <MailLink subject={t('notice:title')} />
        </View>
      </View>
    </View>
  );
}

function Note({ icon, text, plain = false, testID }: { icon: IconName; text: string; plain?: boolean; testID?: string }) {
  return (
    <View style={[styles.note, !plain && styles.noteBox]} testID={testID}>
      <View aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.noteIcon}>
        <Ionicons name={icon} size={ICON} color={colors.ink} />
      </View>
      <Text variant="body" style={styles.noteText}>
        {text}
      </Text>
    </View>
  );
}

const ICON = 20;
const ICON_LARGE = 40;

const styles = StyleSheet.create({
  header: { marginBottom: space.xxl, maxWidth: layout.readingMaxWidth },
  lead: { fontFamily: fonts.sans, marginTop: space.md },
  inApp: { marginTop: space.md },

  form: { gap: space.xxl, maxWidth: layout.readingMaxWidth, width: '100%' },
  summary: {
    padding: space.lg,
    borderRadius: radius.card,
    borderWidth: 2,
    borderColor: colors.accentStrong,
    backgroundColor: colors.surface,
  },
  summaryText: { fontFamily: fonts.sansBold },
  contact: { gap: space.lg },
  contactRow: { flexDirection: 'row', alignItems: 'flex-start' },
  contactField: { flex: 1 },
  check: { gap: space.sm },
  checkLabel: { fontFamily: fonts.sansBold },
  submit: { gap: space.md },
  sendError: {
    padding: space.md,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.accentStrong,
  },
  submitButton: { alignSelf: 'flex-start' },

  panel: {
    maxWidth: layout.readingMaxWidth,
    padding: space.xl,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  // Focused by script so screen readers start here; it isn't a control, so no focus ring (it would frame the line).
  doneTitle: { marginTop: space.md, outlineWidth: 0 },
  para: { marginTop: space.md },
  mail: { marginTop: space.sm, minHeight: layout.minTarget, justifyContent: 'center', alignItems: 'flex-start' },
  doneActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginTop: space.xl },
  doneActionsStacked: { flexDirection: 'column' },

  side: {
    gap: space.lg,
    padding: space.xl,
    borderRadius: radius.card,
    backgroundColor: colors.surfaceAlt,
  },
  sideMail: { marginTop: space.xs },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  noteBox: {
    padding: space.lg,
    borderRadius: radius.card,
    backgroundColor: colors.surfaceAlt,
  },
  noteIcon: { paddingTop: 1 },
  noteText: { flex: 1 },
});
