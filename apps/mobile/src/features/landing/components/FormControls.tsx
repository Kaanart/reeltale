import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef, useState, type ReactNode, type Ref } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { focusRing, useInteraction } from '../../../components/layout';
import { Text } from '../../../components/ui';
import { colors, fonts, layout, radius, space, type as typeScale } from '../../../theme/tokens';

// Form controls for the public notice form, built for the keyboard and screen readers on the web:
//   FormField     a labelled text input (aria-labelledby, aria-describedby for the hint and the error,
//                 aria-invalid, aria-required), one line or several
//   ChoiceGroup   a radio group (chips or a list): Tab reaches the chosen option, the arrow keys move and
//                 choose, Space and Enter choose
//   CheckRow      a checkbox: Space and Enter toggle
//   FieldMessage  the hint or the error under a control, with the id the control points to
// Error text uses accentStrong (5.3:1 on paper) with an icon: the danger red is 4.2:1, too light for small
// text. Every text comes in already translated.

/** Web-only props (aria-*, id) that React Native's types don't list; react-native-web renders them. */
function webProps(props: Record<string, unknown>): object {
  return Platform.OS === 'web' ? props : {};
}

function ids(...values: (string | null | undefined | false)[]): string | undefined {
  const list = values.filter((v): v is string => typeof v === 'string' && v.length > 0);
  return list.length > 0 ? list.join(' ') : undefined;
}

// ---- FieldMessage --------------------------------------------------------------------------------------

export function FieldMessage({ id, error, hint }: { id: string; error?: string | null; hint?: string | null }) {
  if (error) {
    return (
      <View style={styles.message}>
        <View aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.messageIcon}>
          <Ionicons name="alert-circle" size={ICON_SMALL} color={colors.accentStrong} />
        </View>
        <Text nativeID={id} variant="bodySmall" color="accentStrong" style={styles.messageText}>
          {error}
        </Text>
      </View>
    );
  }
  if (hint) {
    return (
      <Text nativeID={id} variant="bodySmall" color="inkMuted">
        {hint}
      </Text>
    );
  }
  return null;
}

// ---- FormField -----------------------------------------------------------------------------------------

export interface FormFieldProps extends Omit<TextInputProps, 'style' | 'multiline' | 'numberOfLines'> {
  /** Base for the ids of the label, hint and error (unique on the page). */
  id: string;
  label: string;
  hint?: string | null;
  error?: string | null;
  required?: boolean;
  /** Several lines (a <textarea> on the web) of this many rows. */
  lines?: number;
  /** Shown at the end of the line under the field (a character count). */
  aside?: string | null;
  inputRef?: Ref<TextInput>;
}

export function FormField({ id, label, hint, error, required = false, lines, aside, inputRef, onFocus, onBlur, ...input }: FormFieldProps) {
  const [focused, setFocused] = useState(false);
  const labelId = `${id}-label`;
  const messageId = `${id}-message`;
  const asideId = `${id}-aside`;
  const multiline = lines !== undefined && lines > 1;
  return (
    <View style={styles.field}>
      <Text nativeID={labelId} variant="body" style={styles.label}>
        {label}
      </Text>
      <TextInput
        ref={inputRef}
        nativeID={id}
        placeholderTextColor={colors.inkMuted}
        maxFontSizeMultiplier={1.6}
        multiline={multiline}
        numberOfLines={multiline ? lines : undefined}
        {...input}
        {...webProps({
          'aria-labelledby': labelId,
          'aria-describedby': ids((error || hint) && messageId, aside && asideId),
          'aria-invalid': error ? true : undefined,
          'aria-required': required ? true : undefined,
        })}
        accessibilityLabel={Platform.OS === 'web' ? undefined : label}
        onFocus={(e) => { setFocused(true); onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); onBlur?.(e); }}
        style={[
          styles.input,
          multiline && { minHeight: (lines ?? 1) * typeScale.body.lineHeight + 2 * space.md, textAlignVertical: 'top' },
          !!error && styles.inputInvalid,
          focused && styles.inputFocused,
          focused && focusRing,
        ]}
      />
      <View style={styles.below}>
        <View style={styles.belowMain}>
          <FieldMessage id={messageId} error={error} hint={hint} />
        </View>
        {aside ? (
          <Text nativeID={asideId} variant="caption" color="inkMuted" style={styles.aside}>
            {aside}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

// ---- ChoiceGroup ---------------------------------------------------------------------------------------

export interface Choice<T extends string> {
  value: T;
  label: string;
}

export interface ChoiceGroupProps<T extends string> {
  id: string;
  label: string;
  /** A line under the label. */
  hint?: string | null;
  options: readonly Choice<T>[];
  value: T | null;
  onChange: (value: T) => void;
  error?: string | null;
  /** 'chips' (a few short options in a row) or 'list' (one option per line). */
  variant?: 'chips' | 'list';
  /** Filled with a function that focuses the group (the chosen option, else the first). */
  focusRef?: { current: (() => void) | null };
  testID?: string;
}

type Focusable = { focus?: () => void } | null;

export function ChoiceGroup<T extends string>({
  id, label, hint, options, value, onChange, error, variant = 'list', focusRef, testID,
}: ChoiceGroupProps<T>) {
  const refs = useRef<Focusable[]>([]);
  const labelId = `${id}-label`;
  const messageId = `${id}-message`;
  const hintId = `${id}-hint`;
  const selected = options.findIndex((o) => o.value === value);
  const tabStop = selected >= 0 ? selected : 0;

  const focusAt = (index: number) => refs.current[index]?.focus?.();
  if (focusRef) focusRef.current = () => focusAt(tabStop);

  const move = (from: number, step: number) => {
    const next = (from + step + options.length) % options.length;
    const option = options[next];
    if (!option) return;
    onChange(option.value);
    focusAt(next);
  };

  return (
    <View style={styles.field} testID={testID}>
      <Text nativeID={labelId} variant="body" style={styles.label}>
        {label}
      </Text>
      {hint ? (
        <Text nativeID={hintId} variant="bodySmall" color="inkMuted" style={styles.groupHint}>
          {hint}
        </Text>
      ) : null}
      <View
        role="radiogroup"
        {...webProps({
          'aria-labelledby': labelId,
          'aria-describedby': ids(hint && hintId, error && messageId),
          'aria-invalid': error ? true : undefined,
          'aria-required': true,
        })}
        style={variant === 'chips' ? styles.chips : [styles.list, !!error && styles.listInvalid]}
      >
        {options.map((option, index) => (
          <ChoiceOption
            key={option.value}
            label={option.label}
            checked={index === selected}
            variant={variant}
            tabbable={index === tabStop}
            invalid={!!error}
            last={index === options.length - 1}
            optionRef={(node) => { refs.current[index] = node as Focusable; }}
            onSelect={() => onChange(option.value)}
            onArrow={(step) => move(index, step)}
            testID={testID ? `${testID}-${option.value}` : undefined}
          />
        ))}
      </View>
      {error ? <FieldMessage id={messageId} error={error} /> : null}
    </View>
  );
}

type KeyEventLike = { key?: string; preventDefault?: () => void };

function ChoiceOption({ label, checked, variant, tabbable, invalid, last, optionRef, onSelect, onArrow, testID }: {
  label: string;
  checked: boolean;
  variant: 'chips' | 'list';
  tabbable: boolean;
  invalid: boolean;
  last: boolean;
  optionRef: (node: View | null) => void;
  onSelect: () => void;
  onArrow: (step: 1 | -1) => void;
  testID?: string;
}) {
  const { hovered, focusVisible, handlers } = useInteraction();
  const onKeyDown = (e: KeyEventLike) => {
    if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault?.(); // Enter is handled by Pressable; Space would scroll the page
      onSelect();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault?.();
      onArrow(1);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault?.();
      onArrow(-1);
    }
  };
  const chip = variant === 'chips';
  return (
    <Pressable
      ref={optionRef}
      role="radio"
      aria-checked={checked}
      accessibilityLabel={label}
      onPress={onSelect}
      testID={testID}
      {...handlers}
      {...webProps({ tabIndex: tabbable ? 0 : -1, onKeyDown })}
      style={({ pressed }) => [
        chip ? styles.chip : styles.row,
        chip && checked && styles.chipChecked,
        chip && !checked && invalid && styles.chipInvalid,
        !chip && !last && styles.rowLine,
        !chip && checked && styles.rowChecked,
        (hovered || pressed) && !checked && (chip ? styles.chipHover : styles.rowHover),
        focusVisible && focusRing,
      ]}
    >
      {chip ? (
        <>
          {checked ? <Glyph name="checkmark" color={colors.onAccent} /> : null}
          <Text variant="body" color={checked ? 'onAccent' : 'ink'} style={styles.chipText}>
            {label}
          </Text>
        </>
      ) : (
        <>
          <View style={[styles.radio, checked && styles.radioChecked]}>
            {checked ? <View style={styles.radioDot} /> : null}
          </View>
          <Text variant="body" style={styles.rowText}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

// ---- CheckRow ------------------------------------------------------------------------------------------

export interface CheckRowProps {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string | null;
  checkRef?: Ref<View>;
  testID?: string;
}

export function CheckRow({ id, label, checked, onChange, error, checkRef, testID }: CheckRowProps) {
  const { hovered, focusVisible, handlers } = useInteraction();
  const messageId = `${id}-message`;
  const onKeyDown = (e: KeyEventLike) => {
    if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault?.();
      onChange(!checked);
    }
  };
  return (
    <View style={styles.field}>
      <Pressable
        ref={checkRef}
        role="checkbox"
        aria-checked={checked}
        accessibilityLabel={label}
        onPress={() => onChange(!checked)}
        testID={testID}
        {...handlers}
        {...webProps({
          onKeyDown,
          'aria-describedby': error ? messageId : undefined,
          'aria-invalid': error ? true : undefined,
          'aria-required': true,
        })}
        style={({ pressed }) => [styles.check, (hovered || pressed) && styles.checkHover, focusVisible && focusRing]}
      >
        <View style={[styles.box, checked && styles.boxChecked, !checked && !!error && styles.boxInvalid]}>
          {checked ? <Glyph name="checkmark" color={colors.onAccent} /> : null}
        </View>
        <Text variant="body" style={styles.checkText}>
          {label}
        </Text>
      </Pressable>
      {error ? <FieldMessage id={messageId} error={error} /> : null}
    </View>
  );
}

// ---- Pieces --------------------------------------------------------------------------------------------

function Glyph({ name, color }: { name: 'checkmark'; color: string }) {
  return (
    <View aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Ionicons name={name} size={ICON_SMALL} color={color} />
    </View>
  );
}

/** A titled group of fields (web: a group named by its heading). */
export function FieldSet({ id, title, hint, children }: { id: string; title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <View role="group" {...webProps({ 'aria-labelledby': `${id}-title` })} style={styles.fieldset}>
      <Text nativeID={`${id}-title`} role="heading" {...webProps({ 'aria-level': 2 })} variant="heading">
        {title}
      </Text>
      {hint}
      {children}
    </View>
  );
}

const ICON_SMALL = 18;
const RADIO = 20;
const BOX = 24;

const styles = StyleSheet.create({
  field: { width: '100%', gap: space.xs },
  fieldset: { gap: space.lg },
  label: { fontFamily: fonts.sansBold },
  groupHint: { marginBottom: space.xs },
  input: {
    minHeight: layout.minTarget + space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderWidth: 1,
    borderColor: colors.inkMuted,
    borderRadius: radius.chip,
    backgroundColor: colors.surface,
    color: colors.ink,
    fontFamily: fonts.sans,
    fontSize: typeScale.body.fontSize,
    lineHeight: typeScale.body.lineHeight,
  },
  inputFocused: { borderColor: colors.ink },
  inputInvalid: { borderColor: colors.accentStrong, borderWidth: 2 },
  below: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  belowMain: { flex: 1 },
  aside: { paddingTop: space.xs / 2 },
  message: { flexDirection: 'row', alignItems: 'flex-start', gap: space.xs },
  messageIcon: { paddingTop: 1 },
  messageText: { flex: 1, fontFamily: fonts.sansMedium },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: layout.minTarget,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.inkMuted,
    backgroundColor: colors.surface,
  },
  chipChecked: { backgroundColor: colors.accentStrong, borderColor: colors.accentStrong },
  chipInvalid: { borderColor: colors.accentStrong },
  chipHover: { borderColor: colors.ink, backgroundColor: colors.surfaceAlt },
  chipText: { fontFamily: fonts.sansMedium },

  list: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  listInvalid: { borderColor: colors.accentStrong, borderWidth: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: layout.minTarget + space.xs,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  rowLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  rowChecked: { backgroundColor: colors.surfaceAlt },
  rowHover: { backgroundColor: colors.bg },
  rowText: { flex: 1 },
  radio: {
    width: RADIO,
    height: RADIO,
    borderRadius: RADIO / 2,
    borderWidth: 2,
    borderColor: colors.inkMuted,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  radioChecked: { borderColor: colors.accentStrong },
  radioDot: { width: RADIO / 2, height: RADIO / 2, borderRadius: RADIO / 4, backgroundColor: colors.accentStrong },

  check: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    minHeight: layout.minTarget,
    paddingVertical: space.sm,
    borderRadius: radius.chip,
  },
  checkHover: { opacity: 0.85 },
  box: {
    width: BOX,
    height: BOX,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.ink,
    borderRadius: radius.chip / 2,
    backgroundColor: colors.surface,
  },
  boxChecked: { backgroundColor: colors.accentStrong, borderColor: colors.accentStrong },
  boxInvalid: { borderColor: colors.accentStrong },
  checkText: { flex: 1 },
});
