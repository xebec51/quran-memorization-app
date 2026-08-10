# Memorization Engine

The only difficulty is `Expert`. Difficulty is adjusted by user-requested hints, not by separate easy/medium/hard modes.

## Cycle

A cycle contains all 604 Madani Mushaf pages. A cycle plan has 151 packages with exactly four questions per package. Every primary question page appears once and only once in a cycle.

## Juz Bands

Pages are classified into:

- `A`: Juz 1-10
- `B`: Juz 11-20
- `C`: Juz 21-30

For boundary pages, classification uses the dominant juz among canonical page words. Ties resolve to the earliest juz on the page. Validation proves each band can supply one mandatory page per package.

## Wildcard Quotas

For each band:

`wildcardQuota = pagesInBand - 151`

The wildcard deck contains exactly those quota counts and is shuffled once per cycle. This avoids exhausting a band early.

## Package Construction

Each package consumes:

- one mandatory page from band A;
- one mandatory page from band B;
- one mandatory page from band C;
- one quota-safe wildcard page.

The four questions are shuffled so order does not reveal the band pattern.

## Fragment Selection

Question prompts choose a page-position bucket (`START`, `MIDDLE`, `END`) to vary where the tested page is represented. After the page area is selected, the generator chooses a suitable ayah whose beginning lies in, overlaps, or best represents that area.

The prompt itself always starts at the first word of the selected ayah. It never starts from the middle of an ayah or from an arbitrary word offset. The initial visible fragment is usually 4-7 contiguous canonical words when the ayah is long enough. Short ayat are shortened safely without combining unrelated text.

Selection is deterministic under an injected seeded RNG in tests and uses secure randomness in production allocation.

## Hints

Hints are independent:

- `JUZ`: reveals only `Juz N`, once.
- `SURAH`: reveals only the surah name, once.
- `EXTEND_FRAGMENT`: progressively increases visible contiguous words from the same ayah beginning, initially limited to 3 requests.
- `NEXT_VERSE`: reveals the next complete ayah by canonical order, initially limited to 3 requests.

Hint-only pages never consume primary page eligibility.
