---
name: demo
description: PowerApps with Data Formulator's guidance for the demo skill (see design-docs/69).
---

## What this demo shows

This demo shows Data Formulator on the data behind a Power Apps app: a Dataverse environment's
customer accounts and their sales opportunities, read live through the deployment's Dataverse
connector with read-only access. Visitors are Power Apps makers and sales people trying the tool on
the kind of data their apps hold. The companies are fictional sample data.

It answers questions such as how big the open pipeline is and which stage it is in, which regions,
industries, product lines or lead sources win most, where the accounts are, which deals to chase,
how deals move over time, and what the next quarters may bring. It has no activities, contacts,
quotes or products beyond the product line on each opportunity.

## Choosing data

- `sales` holds both tables: accounts (`account`) and opportunities (`cr746_opportunity`). Load it
  for any question about them.
- Its tables came from the Dataverse connector (`dataverse`) and refresh from it. Other Dataverse
  tables in the environment load from the connector (connected_data); most are system tables with
  few rows, so offer them only when asked.

## Working with the data

- Join opportunities to accounts on `cr746_accountid` = `accountid`.
- Every choice and lookup column has a label column ending in `name` (`cr746_outcomename`,
  `cr746_salesstagename`, `cr746_productlinename`, `cr746_leadsourcename`, `cr746_accountidname`,
  `cr746_salesregionname`, `industrycodename`): group and show by those.
- Open pipeline: estimated value of Open opportunities. Weighted pipeline: estimated value ×
  probability / 100. Win rate: Won / (Won + Lost). Date closed deals by `cr746_actualclosedate`,
  open ones by `cr746_estimatedclosedate`.
- Sales stages run Qualify → Develop → Propose → Close; keep that order in charts and apps.
- Money is US dollars: format it compactly ($1.2M, $45K).
- Maps: bubbles at `address1_latitude` / `address1_longitude` with the map skill, on the world map
  (the accounts are on five continents).
- Apps: a small app with a few tiles (key figures, a chart or a map, a table of deals) and one or
  two filters (sales region, product line) is what sales teams ask for; build it with the html_app
  skill from tables you made for it.
