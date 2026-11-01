import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { isAiSeries, type SeriesCard } from '../logic';

/**
 * The words a series card shows ("Live action · Ongoing") and the sentence a screen reader gets. `labels` are
 * the AI and Mature labels in words: a button's own accessibilityLabel hides the badges inside it, so any
 * custom label must carry them too.
 */
export function useSeriesText() {
  const { t } = useTranslation();
  return useCallback(
    (series: Pick<SeriesCard, 'title' | 'format' | 'origin' | 'completed' | 'maturity'>) => {
      const format = t(`common:format.${series.format}`);
      const status = t(series.completed ? 'series:status.completed' : 'series:status.ongoing');
      const meta = t('home:home.cardMeta', { format, status });
      const labels = [
        isAiSeries(series) ? t('common:a11y.madeWithAi') : null,
        series.maturity === 'mature' ? t('common:maturity.mature') : null,
      ].filter((x): x is string => !!x);
      return { meta, labels, a11y: [series.title, meta, ...labels].join(', ') };
    },
    [t],
  );
}
