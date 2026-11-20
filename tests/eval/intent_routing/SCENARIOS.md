# Intent routing scenarios

Generated from `cases.py` (`run.py --scenarios`). Sessions and sources are described there.

## load

| Case | Session | Prompt | Ideal | Acceptable | Set | Note |
|---|---|---|---|---|---|---|
| `load_explicit` | empty | Load the Netflix titles dataset. | load | — | dev |  |
| `load_implicit_question` | empty | How many days did it rain in Seattle in 2014? | load | answer | dev | A bounded probe that answers the question is fine; answering from memory is not. (answer only after probe_data) |
| `load_implicit_chart` | empty | Show me how video game sales changed across platforms over the years. | load | — | dev |  |
| `load_terse` | empty | covid cases by state | load | ask | heldout |  |
| `load_non_english` | empty | Muéstrame las ventas de videojuegos por género. | load | — | heldout |  |
| `load_and_chart` | empty | Bring in the movie profit data and chart profit by genre. | load | — | dev |  |
| `load_into_analysis` | unemployment | Compare these unemployment trends with how the big tech stocks did over the same years. | load | ask | dev | stocks.csv in the folder covers 2000-2010. |
| `load_beyond_loaded` | stocks | How did Apple's stock do before 2010? | load | answer | dev | Loaded history only covers 2025; older prices are in the connected folder. (answer only after probe_data) |
| `load_full_reference` | grocery_ref (focus: external:sample_datasets:Consumer%20Price%20Index) | Load the full table from this source, not just the sample. | answer | ask, load | heldout | The loaded table already is the full table (all rows and columns). |
| `load_finer_grain` | grocery_ref | Is gas getting more expensive week to week lately? | load | answer, chart | dev | Weekly Gas Price exists in sample datasets; the loaded CPI has monthly gasoline. |

## unavailable

| Case | Session | Prompt | Ideal | Acceptable | Set | Note |
|---|---|---|---|---|---|---|
| `unavailable_entity` | empty | Analyze Tesla's quarterly vehicle deliveries since 2019. | answer, ask, terminal | — | dev | Search first; then offer/attempt web acquisition or explain. Inventing data is wrong. (answer only after describe_data/find_data/list_connectors/list_data/probe_data/summarize_data_sources; ask only after describe_data/find_data/list_connectors/list_data/probe_data/summarize_data_sources) |
| `unavailable_overlay` | unemployment (focus: chart-588f059ae533) | Overlay the Fed interest rate on this. | answer, ask, terminal | — | heldout | (answer only after describe_data/find_data/list_connectors/list_data/probe_data/summarize_data_sources; ask only after describe_data/find_data/list_connectors/list_data/probe_data/summarize_data_sources) |
| `web_acquisition` | empty | Pull today's earthquakes from the USGS feed and map them. | terminal | ask | dev | Public API; the terminal can fetch it. |

## discover

| Case | Session | Prompt | Ideal | Acceptable | Set | Note |
|---|---|---|---|---|---|---|
| `discover_broad` | empty | What data can I work with here? | answer | — | dev | (answer only after describe_data/find_data/list_connectors/list_data/probe_data/summarize_data_sources) |
| `discover_topic` | empty | do we have anything on salaries? | answer | load | dev | (answer only after describe_data/find_data/list_connectors/list_data/probe_data/summarize_data_sources) |
| `discover_in_session` | unemployment | Is there any other data about jobs I could add to this? | answer | ask, load | heldout | (answer only after describe_data/find_data/list_connectors/list_data/probe_data/summarize_data_sources; ask only after describe_data/find_data/list_connectors/list_data/probe_data/summarize_data_sources) |

## analyze

| Case | Session | Prompt | Ideal | Acceptable | Set | Note |
|---|---|---|---|---|---|---|
| `analyze_chart` | unemployment | Which industries were hit hardest in 2009? Chart it. | chart | — | dev |  |
| `analyze_question` | unemployment | What was the average unemployment rate in construction across the whole period? | answer | chart | dev |  |
| `analyze_followup` | unemployment (focus: chart-588f059ae533) | now break it down by season | chart | edit_chart | dev |  |
| `analyze_existing_result` | stocks | which stock was the most volatile? | answer | chart | dev |  |
| `analyze_non_english` | unemployment | 按行业比较2008年和2010年的失业率 | chart | answer | heldout |  |
| `analyze_loose_name` | unemployment | chart unemployment for the tech sector | chart | ask | dev | 'Information' is the closest series. |
| `analyze_other_columns` | grocery_ref | How have egg prices moved compared to milk? | chart | answer | heldout |  |
| `span_two_charts` | unemployment | Do the bar chart and the heatmap agree on which industries were hit hardest? | answer | chart | heldout |  |
| `span_charts_entity` | stocks | What do the scatter plot and the drawdown chart say together about META? | answer | chart | heldout |  |
| `span_tables` | stocks | List each stock's total return next to its daily volatility. | answer | chart | heldout |  |

## edit_chart

| Case | Session | Prompt | Ideal | Acceptable | Set | Note |
|---|---|---|---|---|---|---|
| `edit_chart_type` | unemployment (focus: chart-daeeb7ca30a6) | make this a bar chart | edit_chart | chart | dev |  |
| `edit_chart_style` | unemployment (focus: chart-b62396f0ac9f) | use a sequential blue color scheme here | edit_chart | chart | dev |  |
| `edit_chart_encoding` | stocks (focus: chart-1efd75b20fd9) | swap the axes | edit_chart | chart | heldout |  |
| `edit_chart_terse` | unemployment (focus: chart-61ee324721d9) | sort it alphabetically | edit_chart | chart | dev |  |
| `edit_chart_title` | unemployment (focus: chart-daeeb7ca30a6) | Can you fix the title of this graph so it says what it shows? | edit_chart | chart | heldout |  |

## report

| Case | Session | Prompt | Ideal | Acceptable | Set | Note |
|---|---|---|---|---|---|---|
| `report_write` | unemployment | Write up a short report summarizing what we found. | report | edit_report | dev |  |
| `report_terse` | stocks | report pls | report | answer, ask, edit_report | dev | A report covering every chart exists; pointing to it is fine. (answer only after read_file) |
| `report_edit` | grocery_ref | Shorten the intro of this report to two sentences. | edit_report | report | dev |  |
| `report_question` | earthquake | What does the review report say about the strongest quake? | answer | — | heldout |  |

## app

| Case | Session | Prompt | Ideal | Acceptable | Set | Note |
|---|---|---|---|---|---|---|
| `app_new` | unemployment | Turn this into an interactive dashboard where I can pick an industry. | app | — | dev |  |
| `app_edit` | stocks | add a date range filter to this dashboard | edit_app | app | dev |  |
| `app_question` | earthquake | how does this explorer decide the color of each quake? | answer | — | dev |  |

## workflow

| Case | Session | Prompt | Ideal | Acceptable | Set | Note |
|---|---|---|---|---|---|---|
| `workflow_from_session` | unemployment | Make this analysis a repeatable workflow I can rerun when new data arrives. | workflow | — | dev |  |
| `workflow_new` | empty | Every Monday, pull the weekly gas prices and chart the change from last week. | schedule, workflow | ask | dev |  |
| `schedule_existing` | earthquake | Run the daily earthquake review every morning at 7. | schedule | ask, workflow | dev |  |
| `workflow_concept` | empty | What's the difference between a workflow and a schedule here? | answer | — | heldout |  |
| `workflow_implicit` | grocery_ref | I'll want this same grocery update every month. | schedule, workflow | ask | heldout |  |

## connect

| Case | Session | Prompt | Ideal | Acceptable | Set | Note |
|---|---|---|---|---|---|---|
| `connect_explicit` | empty | Connect to my Postgres database at db.internal:5432, database 'sales', user 'analyst'. | connect | — | dev |  |
| `connect_implicit` | unemployment | Our HR headcount data lives in a MySQL server. Can you pull it in? | connect | ask | dev |  |
| `connect_question` | empty | Which kinds of databases can you connect to? | answer | — | dev |  |
| `connect_bucket` | stocks | Hook up our S3 bucket s3://acme-finance/exports so we can use those files. | connect | ask | heldout |  |

## delete

| Case | Session | Prompt | Ideal | Acceptable | Set | Note |
|---|---|---|---|---|---|---|
| `delete_focused` | unemployment (focus: chart-b62396f0ac9f) | delete this chart | delete | — | dev |  |
| `delete_named` | unemployment | Clean up: remove the boxplot and the scatter plot, we won't use them. | delete | ask | dev | The report embeds both charts, so deleting them is refused until it changes. |
| `delete_file` | earthquake | Remove the older explorer version and keep only the latest one. | delete | — | heldout |  |

## files

| Case | Session | Prompt | Ideal | Acceptable | Set | Note |
|---|---|---|---|---|---|---|
| `note_remember` | unemployment | Remember for later: we always leave out the Self-employed series. | note | — | dev |  |
| `note_standing_rule` | stocks | Going forward, leave META out of every comparison. | note | chart, edit_app, edit_chart | heldout | Added in iteration 2 as a held-out probe of the notes fix (implicit standing rule). |
| `helper_save` | stocks | Save the drawdown calculation as a reusable Python helper so we can use it again. | helper | file | dev |  |
| `file_move` | earthquake | Move the runbook into a docs folder. | file_move | — | dev |  |
| `file_question` | earthquake | What does the runbook say to do if the USGS API is down? | answer | — | heldout |  |

## session

| Case | Session | Prompt | Ideal | Acceptable | Set | Note |
|---|---|---|---|---|---|---|
| `session_rename` | unemployment | Rename this session to 'Recession unemployment study'. | session | — | dev |  |
| `session_find` | empty | Where's the session I made about grocery prices? | answer, session | — | heldout | (answer only after list_sessions) |

## chat

| Case | Session | Prompt | Ideal | Acceptable | Set | Note |
|---|---|---|---|---|---|---|
| `chat_thanks` | stocks | thanks, this looks great! | answer | — | dev |  |
| `chat_concept` | unemployment | Should I use the median or the mean for these rates, and why? | answer | chart | dev |  |
| `chat_help` | empty | help | answer, ask | — | heldout |  |
