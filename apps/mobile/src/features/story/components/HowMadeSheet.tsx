import type { StoryManifest } from '@reeltale/shared';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AIBadge, Sheet, Text } from '../../../components/ui';
import { colors, radius, space } from '../../../theme/tokens';
import { providerKey, taskKey } from '../logic';

// "How this scene was made": the AI label explained, and the manifest's provenance (each step, the
// provider and the model, when it was made, and whether content credentials are attached). Before the
// scene is ready there is no manifest yet, and the sheet explains the label only.
export interface HowMadeSheetProps {
  visible: boolean;
  onClose: () => void;
  manifest: StoryManifest | null;
}

export function HowMadeSheet({ visible, onClose, manifest }: HowMadeSheetProps) {
  const { t, i18n } = useTranslation();
  const made = manifest ? new Date(manifest.provenance.created_at) : null;
  const madeText = made && !Number.isNaN(made.getTime())
    ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(made)
    : null;

  return (
    <Sheet visible={visible} onClose={onClose} title={t('story:howMade.title')}>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.badge}>
          <AIBadge size="md" />
        </View>
        <Text>{t('ai:disclosure.body')}</Text>
        {manifest ? (
          <>
            <Text color="inkMuted" style={styles.intro}>
              {t('story:howMade.intro')}
            </Text>
            <View style={styles.table}>
              {manifest.provenance.models.map((m, i) => {
                const provider = providerKey(m.provider);
                const by = t('story:howMade.by', { provider: provider ? t(provider) : m.provider, model: m.model });
                return (
                  <View key={`${m.task}-${i}`} style={[styles.row, i > 0 && styles.rowLine]} accessible>
                    <Text variant="bodySmall" style={styles.task}>
                      {t(taskKey(m.task))}
                    </Text>
                    <Text variant="bodySmall" color="inkMuted" style={styles.model}>
                      {by}
                    </Text>
                  </View>
                );
              })}
            </View>
            {madeText ? (
              <Text variant="bodySmall" color="inkMuted" style={styles.line}>
                {t('story:howMade.created', { date: madeText })}
              </Text>
            ) : null}
            <Text variant="bodySmall" color="inkMuted" style={styles.line}>
              {t(manifest.provenance.c2pa_signed ? 'story:howMade.signed' : 'story:howMade.notSigned')}
            </Text>
          </>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingBottom: space.lg },
  badge: { marginBottom: space.md },
  intro: { marginTop: space.lg },
  table: {
    marginTop: space.md,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', padding: space.md, gap: space.sm },
  rowLine: { borderTopWidth: 1, borderTopColor: colors.line },
  task: { flex: 1, minWidth: 120 },
  model: { flexShrink: 1 },
  line: { marginTop: space.md },
});
