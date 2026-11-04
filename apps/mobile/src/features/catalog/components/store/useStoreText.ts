import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import type { TagRow } from '../../../../lib/types';
import { tagLabel, type SeriesCard } from '../../logic';
import { primaryGenre } from '../../storefront';
import { useSeriesText } from '../useSeriesText';

type CardSeries = Pick<SeriesCard, 'title' | 'format' | 'origin' | 'completed' | 'maturity' | 'tag_ids'>;

/**
 * The words a storefront card shows under its cover: the series' first genre and its format ("Mystery · AI
 * story"; just the format when it has no genre), plus the sentence a screen reader gets, which names the AI
 * and Mature labels (a card's own label hides the badges inside it).
 */
export function useStoreText(tags: readonly TagRow[]) {
  const { t, i18n } = useTranslation();
  const base = useSeriesText();
  return useCallback(
    (series: CardSeries) => {
      const genre = primaryGenre(series, tags);
      const format = t(`common:format.${series.format}`);
      const meta = genre ? t('home:home.store.genreMeta', { genre: tagLabel(genre, i18n.language), format }) : format;
      const { labels } = base(series);
      return { meta, labels, a11y: [series.title, meta, ...labels].join(', ') };
    },
    [t, i18n.language, tags, base],
  );
}
