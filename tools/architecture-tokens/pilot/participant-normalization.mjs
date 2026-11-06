import slugify from '@sindresorhus/slugify';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function normalizedFormatting(rawLabel) {
  const withoutEmoji = [...segmenter.segment(rawLabel.normalize('NFKC'))]
    .filter(({ segment }) => !/\p{Extended_Pictographic}/u.test(segment))
    .map(({ segment }) => segment)
    .join('');

  return withoutEmoji
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"');
}

export function readableNormalizedDisplay(rawLabel) {
  return normalizedFormatting(rawLabel).toLocaleLowerCase('en-US');
}

export function lexicalComparisonKey(rawLabel) {
  return slugify(normalizedFormatting(rawLabel), {
    separator: '.',
    lowercase: true,
    decamelize: true,
    transliterate: false,
  });
}

export function lexicalGroupingToken(rawLabel) {
  return lexicalComparisonKey(rawLabel).replaceAll('.', '');
}
