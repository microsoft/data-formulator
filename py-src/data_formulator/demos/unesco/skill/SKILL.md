---
name: demo
description: The UIS Data Explorer's guidance for the demo skill (see design-docs/69).
---

## What this demo shows

This demo shows Data Formulator exploring official statistics from the UNESCO Institute for
Statistics (UIS), the UN's source of data on education, science and culture: the full February 2026
bulk release of four UIS datasets, covering 200+ countries and territories. Education series reach
back to 1970, research to 1996 and heritage spending to 2017; most countries report only some years.
Visitors are a general audience trying the tool on real public data.

It answers questions such as where children are out of school, who finishes school, how much
governments spend on education or heritage, how many researchers countries have and how many of
them are women. It has no data beyond these datasets (for example no health, economy or population
data other than the demographic tables the datasets carry), and it cannot fetch newer UIS releases.

## Choosing datasets

- `education-sdg4` for the SDG 4 targets, mostly as rates and shares: out-of-school rates,
  completion, learning (reading and maths proficiency), literacy rates, school facilities, trained
  teachers, education spending as a share of GDP.
- `education-opri` for counts and other indicators: enrolment, out-of-school children and
  illiterate adults in numbers, teachers and pupil-teacher ratios, years of schooling, students
  studying abroad, spending by level.
- `science` for research and development: R&D spending, researchers (per million, by sex and sector).
- `culture` for spending on cultural and natural heritage (SDG 11.4).
- Rates are mostly in `education-sdg4`, numbers of people in `education-opri`. When unsure between
  the two education datasets, load both.

## Working with UIS data

Each dataset's data guide has the details; in short:

- Values are stored long: one row per indicator, country (or region) and year. Find the indicator
  first by searching the `*_indicators` table's labels, then filter the `*_national` or
  `*_regional` table by `indicator_id` in SQL before loading rows into Python; some have millions
  of rows.
- Use the `*_regional` tables for regional and world figures: they are the official UIS aggregates.
- For a world map, join `countries` on `country_id` and use its `map_id`.
- Coverage is uneven: say which years the values are from.
