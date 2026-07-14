# Data Formulator 2 Paper: Key Insights

- **Reviewed:** 2026-07-13
- **Paper:** *Data Formulator 2: Iterative Creation of Data Visualizations, with
  AI Transforming Data Along the Way*
- **Authors:** Chenglong Wang, Bongshin Lee, Steven Drucker, Dan Marshall, and
  Jianfeng Gao
- **Publication:** CHI 2025
- **Reviewed source:**
  [arXiv 2408.16119v2](https://arxiv.org/abs/2408.16119v2)
- **Local artifacts:** [reviewed PDF](paper-2408.16119v2.pdf),
  [arXiv v2 source archive](arXiv-2408.16119v2.tar.gz)
- **Publication record:**
  [ACM DOI 10.1145/3706598.3713296](https://doi.org/10.1145/3706598.3713296)

The detailed claims in this note are pinned to the local source archive for
arXiv version 2. The ACM record verifies the CHI 2025 publication identity; this
review did not perform a byte- or text-level equivalence check between the
arXiv and ACM proceedings versions.

## Purpose And Interpretation Boundary

This note captures the paper's research contribution, empirical findings,
limitations, and implications for the current Data Formulator adaptation. It
is not a substitute for the current code, issue ledger, or product roadmap.

Statements under **Paper Findings** report the authors' claims and evidence.
Statements under **Adaptation Implications** are our interpretation and should
be validated with Chenglong before they become architecture decisions.

- **Audience:** Fabio and Chenglong Wang, with later readers of the adaptation
  decision record.
- **Meeting owner:** Fabio.
- **Requested outcome:** Validate or revise the proposed product invariants,
  answer the paper-grounded questions, and record resulting decisions in the
  [meeting brief](2026-07-14-chenglong-adaptation-meeting.md) and accepted work
  in the [canonical issue ledger](ISSUES.md).

When sources disagree, current code describes implemented behavior, the issue
ledger records accepted status and planned work, and the paper supplies research
rationale rather than current product requirements. This note is interpretive;
it does not override any of those sources.

## Executive Summary

Data Formulator 2 is designed as an iterative visualization-authoring system,
not as a natural-language-only chat interface. Its central contribution is the
combination of:

1. A chart builder that blends precise graphical encoding controls with short
   natural-language descriptions.
2. AI-generated data transformation that prepares fields needed by the chart
   without requiring the analyst to write transformation code.
3. Data threads that make data versions, derivations, charts, and branching
   history first-class parts of the user experience.
4. Multiple inspection surfaces that let users verify and correct AI output
   incrementally.

The user study supports the feasibility of this interaction model for
prescribed iterative chart-authoring tasks. It does not establish effectiveness
for open-ended analysis, long-term use, enterprise data connections, or
multi-user hosted deployment.

## Paper-Grounded Q&A

### What Must Remain Central To Data Formulator?

**Paper answer:** Data Formulator 2 is an iterative visualization-authoring
system built around mixed graphical and natural-language specification,
AI-generated data transformation, branchable data threads, and visible
inspection of generated artifacts. Treating it primarily as chat over data
would discard the interaction model the paper evaluates.

### What Is The Intended Architectural Boundary?

**Paper answer:** Chart specification and data transformation are deliberately
decoupled. Structured UI input produces a declarative chart template, while the
model generates code to prepare the required data. Styling or encoding changes
that require no new data should remain direct, deterministic, and immediate.

### Which Extension Points Does The Paper Identify?

**Paper answer:** The paper explicitly describes adding chart types through
Vega-Lite templates and presents chart specification, data formulation, data
threads, and inspection surfaces as separable concepts.

**Current-code limit:** This does not prove that today's implementing modules
are stable extension APIs. The repository now includes agents and multiple
rendering backends, so current module stability remains a question for
Chenglong.

### Which Future Directions Did The Paper Propose?

**Paper answer:** The authors identify visualization recommendations,
coordination between data-transformation and chart-editing agents, proactive
clarification of ambiguous requests, hierarchical or compressed thread
navigation, open-ended analysis studies, and longitudinal evaluation.

**Current-roadmap limit:** These are paper-era research directions, not evidence
of the current roadmap. The meeting should establish which remain active,
implemented, rejected, or superseded.

### What Is The Smallest Useful Adaptation Slice To Validate?

**Adaptation answer, inferred from the paper:** Validate one complete iterative
workflow rather than an isolated connector query:

1. Load a real user dataset while preserving source identity.
2. Create a chart through structured encodings plus a short natural-language
  transformation request.
3. Derive and inspect the resulting data, code, explanation, and chart.
4. Branch or revise the work through data threads.
5. Resume the same provenance and active context after a process restart.

This slice tests the defining interaction model and the adaptation's durability
requirement together. It is our recommendation, not a study result or an
explicit prescription from the authors.

### What Does The Paper Not Answer?

The paper does not select an enterprise authentication abstraction, token
lifecycle, shared session backend, Fabric delivery sequence, Azure deployment
model, backward-compatibility policy, upstream contribution structure, or
long-term maintenance owner. Those remain in the
[Questions for Chenglong](2026-07-14-chenglong-adaptation-meeting.md#questions-for-chenglong).

## Paper Findings

### Problem Framing

The paper argues that visualization authoring is inherently iterative. Analysts
move between chart design and data transformation, branch into alternative
directions, revisit earlier results, and refine partially correct outputs.

The authors identify two limitations in prior AI-powered visualization tools:

- A text-only prompt is flexible but imprecise for fully specifying complex
  visual encodings.
- Linear single-turn or chat histories make branching, backtracking, and
  context selection difficult.

The proposed answer is not better prompt engineering alone. It is an
interaction model that combines structured UI input, natural language, and
explicit provenance.

### Design Principles

**Table 1:** *The paper's principal design choices*

| Principle | Mechanism | Intended benefit |
| --- | --- | --- |
| Combine precision and flexibility | Encoding shelf plus optional natural-language instruction | Users specify chart structure precisely without verbose prompts |
| Decouple chart design from data transformation | Chart template instantiation is separate from AI-generated Python | Deterministic chart structure can coexist with expressive transformation |
| Treat data as the center of iteration | Data versions are nodes; derivation instructions are edges; charts attach to data | Users can navigate provenance and choose the correct context for the next step |
| Reuse computation, not only output | Follow-ups include prior dialog and generated code rooted in the original data | The system can revise, backtrack, or generate alternatives rather than only append transformations |
| Support different iteration styles | Global and local data-thread views support branching, follow-up, retry, and revision | Users can work with wide or deep histories according to their preferences |
| Keep direct edits immediate | Style and encoding changes that need no new data bypass the model | Precise edits receive immediate feedback and avoid unnecessary model latency |
| Make verification visible | Show chart, transformed data, generated code, code explanation, and raw model history | Users with different expertise can inspect results through different representations |

### System Workflow

The paper describes the following formulation path in **System Design**, under
“Composing charts from multi-modal inputs”:

1. The user selects a chart type and places existing or desired future fields
   into visual encoding channels.
2. Data Formulator creates a Vega-Lite specification skeleton from a template.
3. The system compiles the data summary, selected fields, natural-language
   goal, and relevant prior dialog/code into a transformation prompt.
4. The model first refines the goal and expected fields, then generates a
   Python transformation function.
5. The server executes the function and may ask the model to repair runtime
   errors.
6. The system infers semantic types for derived fields and instantiates the
   chart specification with the transformed data.
7. The new data, chart, code, and instruction are recorded in the data thread.

This sequence expresses a strong architectural boundary: the model prepares
data, while chart composition remains grounded in structured user input and a
declarative chart template.

### Data Threads As The Core Interaction Model

In **System Design**, under “Data threads,” the paper presents data threads as
more than visual history. They determine which context the model receives for
the next operation. Figure “Data threads and local data threads” illustrates
the global and local interaction paths.

- Each node represents a version of data.
- Each edge represents the instruction that produced a derivation.
- Charts are attached to the data from which they were created.
- Selecting an earlier node changes the active authoring context.
- Follow-up generation can reuse the original input, previous code, and dialog.
- Local threads provide shortcuts for retrying, following up, or revising the
  most recent instruction.
- Global threads support navigation and branching across the larger analysis.

The paper rejects a simpler design that sends only the latest transformed table
to the model. That approach cannot reliably express revision of an earlier
computation or generation of an alternative branch.

### User Study Evidence

The evidence below comes from the paper's **User Study Design** and **User Study
Results** sections, including the participant summary, study-task figure, and
participant-workflow figure.

**Table 2:** *Historical study snapshot reported by the paper*

| Dimension | Reported design or result |
| --- | --- |
| Participants | Eight employees with varied charting, transformation, programming, and AI-assistant experience |
| Session format | Remote, screen-shared sessions within a two-hour slot |
| Preparation | Tutorial followed by a practice task |
| Study tasks | Reproduction of two professional data-analysis sessions |
| Target output | Sixteen visualizations, twelve requiring data transformation |
| Completion | Every participant completed every target visualization |
| Reported time | Less than 20 minutes on average for the seven-chart first task and about 33 minutes for the nine-chart second task |
| Assistance | Six participants requested at least one hint |
| Study model | GPT-3.5-turbo |

The study found several distinct working styles rather than one optimal flow:

- **Wide versus deep histories:** some participants preferred many short
  branches; others preferred long, continuous threads.
- **Revision versus follow-up:** some rewrote an earlier instruction to keep
  the workspace concise; others preserved intermediate steps and continued
  forward.
- **Data-centric versus chart-centric navigation:** participants selected
  prior work based on either transformation similarity or visual similarity.
- **Short, grounded prompts:** in these recorded study tasks, all prompts
  created by participants were fewer than 20 words; the paper relates this to
  the context supplied by UI fields and the active thread.
- **Different verification strategies:** users inspected chart patterns, table
  values, generated code, explanations, or raw model interactions according to
  expertise and trust.
- **Changing verification behavior:** during these short reproduction sessions,
  some participants inspected simple transformations first and then relied on
  incrementally built context for more complex operations. This is an observed
  study behavior, not evidence of long-term trust calibration.

### Limitations

The study evidence should be interpreted narrowly:

- The participant pool was small and drawn from one large company.
- Participants reproduced expert-designed sessions rather than choosing their
  own analytical questions.
- The study did not include a controlled comparison against notebooks, chat
  tools, or other visualization systems.
- Two-hour sessions do not establish long-term learning, trust calibration, or
  workspace-maintenance behavior.
- The study did not evaluate multi-user collaboration, hosted-session
  durability, enterprise authentication, or external data connectors.
- The model and performance observations reflect the study-time implementation
  and should not be projected directly onto the current system.
- The paper reports performance pressure with large rendered datasets and long
  data threads, but does not establish production-scale limits.

### Future Work Identified By The Authors

The paper's **Discussion and Future Work** section identifies several directions
that remain useful discussion anchors:

- Visualization recommendations that can propose derived fields, not only
  fields already present in the source table.
- Coordination between data transformation and chart editing, potentially
  through planning and specialized agents.
- Proactive clarification when a request is ambiguous, balanced against the
  risk of interrupting users with unnecessary questions.
- Hierarchical, compressed, or multi-granularity navigation for long data
  threads.
- Open-ended studies using participants' own data and longitudinal evaluation
  of changing expectations and trust.

## Adaptation Implications

### Product Invariants To Preserve

The adaptation should preserve these research-defining properties unless a
deliberate product decision replaces them:

1. Data Formulator should remain a mixed GUI and natural-language experience,
   not drift into a chat-only interface.
2. Deterministic chart specification and AI-driven transformation should remain
   separable, even as new chart backends or agents are introduced.
3. Data lineage, derivation code, chart associations, and branch structure are
   product state, not disposable UI state.
4. Users should be able to select context explicitly, inspect AI output through
   multiple representations, and recover from mistakes without restarting.
5. Direct manipulations that do not require data transformation should remain
   immediate and should not incur unnecessary model calls.

### Hosted Deployment And Durable State

**Current repository context, independently verified:** production is capped at
one worker and one replica while required state remains process- or
filesystem-local. The current status and evidence are recorded under
[DF-001](ISSUES.md#df-001-replica-local-state-conflicts-with-multi-replica-scaling),
[DF-016](ISSUES.md#df-016-azure-sql-connector-lacks-delegated-microsoft-entra-mfa),
and [DF-022](ISSUES.md#df-022-deprecated-flask-session-signer-requires-a-cookie-migration),
with deployment details in the [session handoff](../../HANDOFF.md).

Against that verified context, the paper makes session durability more than a
conventional infrastructure improvement. If data threads and their derivation
artifacts are central to iteration, process-local loss can break the primary
interaction model.

A durable hosted design should preserve, together and consistently:

- Source identity and connection context.
- Data-version and derivation relationships.
- Generated code and its execution provenance.
- Chart-to-data associations and style variants.
- Active branch and selected authoring context.
- User-visible explanations and relevant interaction history.
- Security boundaries for delegated tokens and identity-scoped workspaces.

The one-worker and one-replica cap is therefore a safe temporary constraint,
not the target architecture for the paper's iterative experience.

### Connector And Fabric Work

**Current repository context, independently verified:** delegated Azure SQL is
tracked in [DF-016](ISSUES.md#df-016-azure-sql-connector-lacks-delegated-microsoft-entra-mfa),
while Fabric discovery, Lakehouse imports, and semantic-model queries are
tracked in [DF-017 through DF-019](ISSUES.md#df-017-fabric-workspace-and-item-discovery-are-not-available).

These capabilities can extend the paper's interaction model if they preserve
provenance and user control. They should not reduce an imported asset to an
anonymous table detached from its source and refresh semantics.

Connector design should answer:

- How source identity is represented in a data thread.
- Whether a refresh updates a source node, creates a version, or invalidates
  descendants.
- How derived artifacts record the source snapshot or query context used.
- How access-token expiry and reauthentication affect existing thread history.
- How row and byte limits remain visible when transformations are incremental.
- How errors and partial refreshes are represented without corrupting lineage.

### Reliability And Trust

The paper relies on incremental verification rather than assuming model
correctness. The adaptation's security, bounded-resource, error-handling, and
test-hardening work supports that principle, but technical correctness alone is
not enough. The product should preserve visible evidence that lets users judge
whether a result is semantically correct.

High-value follow-up areas include:

- Clarification before execution when ranking criteria, aggregation semantics,
  or source context are ambiguous.
- Stable explanations of derived fields and transformation intent.
- Comparison of a result against its parent data or chart.
- Scalable thread navigation and summarization without hiding provenance.
- Clear distinction between deterministic chart edits and model-generated
  transformation or styling decisions.

## Current-Code Cross-Check

The paper should be treated as the research foundation rather than a literal
specification of the current repository. The defining concepts remain visible
in current implementation surfaces:

- [DataThread.tsx](../../src/views/DataThread.tsx) owns the current data-thread
  rendering and interaction surface.
- [useFormulateData.ts](../../src/app/useFormulateData.ts) coordinates data
  formulation and derived-table context.
- [EncodingShelfCard.tsx](../../src/views/EncodingShelfCard.tsx) implements the
  structured chart-encoding surface.
- [agents-chart/README.md](../../src/lib/agents-chart/README.md) documents a
  newer semantic chart layer with multiple rendering backends, beyond the
  paper's Vega-Lite-only implementation description.

These references confirm continuity of the main concepts while also showing
that the chart architecture has evolved since the paper.

## Questions Sharpened By The Paper

Use these alongside the broader agenda in the
[Chenglong adaptation meeting brief](2026-07-14-chenglong-adaptation-meeting.md):

1. Which paper-level design principles should be treated as product invariants
   when adapting authentication, connectors, chart agents, and deployment?
2. How should the newer multi-backend chart architecture preserve the paper's
   boundary between structured chart specification and AI transformation?
3. What is the intended durable representation of data threads, generated code,
   explanations, charts, and source snapshots in a hosted deployment?
4. Which of the paper's future-work directions have since been implemented,
   rejected, or superseded?
5. Should proactive clarification be a general agent behavior or a targeted
   interaction for high-ambiguity transformations?
6. How should external database and Fabric refresh behavior appear in data
   threads and provenance?
7. What evidence would be sufficient to validate open-ended enterprise use,
   given that the paper studied short reproduction tasks?
8. Given the paper's observations about large rendered datasets and long
  threads, what evaluation should establish acceptable dataset size, thread
  depth, and branch count?
9. Independently of the paper, what simultaneous-user and availability targets
  should govern the hosted deployment architecture?

## Decision Use

This paper supports preserving Data Formulator's iterative, provenance-centered
interaction model while expanding its data access and deployment capabilities.
It does not, by itself, settle the shared-state technology, connector contract,
Fabric priority, or upstream contribution boundaries. Those remain decisions
for the adaptation meeting and the canonical
[audit and issue ledger](ISSUES.md).
