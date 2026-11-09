---
name: huggingface
description: Find datasets on the Hugging Face Hub, check their cards and rows, and load them as tables, as the user when they have signed in.
when_to_use: >-
   Finding, inspecting or loading datasets from the Hugging Face Hub, including gated datasets
   the user can open by signing in.
always_on: false
includes: [accounts]
---

# Hugging Face datasets

Call the Hub's APIs with `api_fetch`; it goes as the user when they have signed in to
Hugging Face. Each body is saved under `scratch/api/huggingface/`; parse and analyze it
in sandboxed Python.

## Choosing a dataset

Search the Hub, most downloaded first:

```
https://huggingface.co/api/datasets?search=stock&filter=modality:tabular&sort=downloads&direction=-1&limit=50&full=true
```

- `search` matches dataset ids literally ("stock prices" misses `us-stock-data`). Search
  the shortest distinctive word, or try several, then filter the results yourself.
- Each item has `id`, `downloads` (last month), `likes`, `gated`, `lastModified`,
  `description` and `tags` (`license:…`, `size_categories:…`, `format:…`).
- Many Hub datasets are benchmarks, synthetic or unofficial copies. Check each
  candidate's summary, license, size and tags; prefer real, documented data; and tell
  the user which dataset you chose and why.

The card (README) is at `https://huggingface.co/datasets/<id>/resolve/main/README.md`, and
a dataset's facts, including whether it is gated, at `https://huggingface.co/api/datasets/<id>`.

## The dataset viewer (`https://datasets-server.huggingface.co`)

- `/splits?dataset=<id>`: subsets (configs) and splits.
- `/size?dataset=<id>`: rows and bytes per split.
- `/info?dataset=<id>&config=<config>`: column types.
- `/first-rows?dataset=<id>&config=<config>&split=<split>`: about the first 100 rows.
- `/rows?dataset=<id>&config=<config>&split=<split>&offset=0&length=100`: up to 100 rows
  from an offset.
- `/statistics?dataset=<id>&config=<config>&split=<split>`: per-column statistics (value
  frequencies, min, max, mean). Often enough to answer without loading anything.
- `/parquet?dataset=<id>`: each split's Parquet files, with their `url` and `size`.

## Loading a split as a table

Fetch the split's Parquet file (its `url` from `/parquet`) with `api_fetch` and a
`save_as` name. Then register the table with `create_data`, reading only the columns
you need (`pandas.read_parquet(path, columns=[...])`). For a large split, fetch only
the shards you need; one fetch holds at most 200 MB.

A gated dataset needs the user's sign-in and accepted terms: offer it with
`propose_signin` (`provider: "huggingface"`), as "Offering a sign-in" below says.
