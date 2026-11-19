---
name: demo
description: NeurIPS in Data Formulator's guidance for the demo skill (see design-docs/69).
---

## What this demo shows

This demo shows Data Formulator exploring the papers of NeurIPS, the machine learning conference:
every paper from 1987 to 2026 (about 40,000) with its abstract, authors and the institutions they
gave, and NeurIPS 2026's schedule, the first NeurIPS held in three cities (Sydney, Atlanta and
Paris). Microsoft staff show it at a booth to researchers and conference-goers, who try the tool on
data about their own field.

It answers questions such as what NeurIPS 2026 is about, how topics changed over the years, where
authors work, which organizations publish most, who collaborates with whom, Microsoft's papers, and
which posters to see when. It has no reviews or scores, no workshops or tutorials, no citations
beyond OpenAlex's counts, and no data on people other than their names and affiliations.

## Choosing datasets

- `neurips-2026` for this year: the papers (`papers_2026`) with their poster city, session, local
  time and position, and their authors (`authorships_2026`).
- `neurips-history` for trends since 1987: all papers (`papers`) and authors (`authorships`), and
  where NeurIPS met (`conferences`).
- `microsoft` for questions about Microsoft: both of the above.
- All three carry `institutions`, `institution_orgs` and `countries`.

## Working with NeurIPS data

Each dataset's data guide has the details; in short:

- Institutions are strings as authors wrote them. To count an organization, find its strings
  through `institution_orgs` (`organization` and `parent`, an AI model's reading of each string) and
  check them; Microsoft's include Microsoft Research and its labs, MSR Asia, GitHub and LinkedIn.
- A paper counts for an organization or country when at least one of its authors works there.
  Countries come from `institutions` (ROR, then OpenAlex) or `institution_orgs`; they are where
  authors work, not their nationality.
- `topic` is the authors' choice (2023 on); `topic_llm` is an AI model's choice from the same list
  for every year, for trends, and agrees with authors on the broad area about 70% of the time.
- Affiliations are nearly complete from 2020; before, only for papers OpenAlex knows (most years
  70–85%): compare shares across years, not counts.
- For a world map, use the map skill (`write_map`): a choropleth keyed by `country_code` (keyType
  `iso2`), or bubbles at institutions' `ror_lat`/`ror_lng`. A question with a few parts that belong
  together reads best as one small dashboard (`write_app`), as the example sessions do.
- Never rank individual people; show organizations, countries and topics.
