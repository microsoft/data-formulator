---
name: creative-writing
description: "Scaffold book-writing projects with folder structure, BOOK-PLAN template, character development matrices, and chapter organization patterns. Use when starting a new book project, planning multi-chapter structure, or building character bibles."
lastReviewed: 2026-05-26
---

# Creative Writing Skill

Patterns for fiction, narrative structure, character development, dialogue, and storytelling craft.

---

## Book Project Scaffolding

### Recommended Folder Structure

```text
book-project/
├── .github/
│   ├── copilot-instructions.md    # Book-specific Alex context
│   └── prompts/
│       └── chapter-review.prompt.md
├── outline/
│   ├── BOOK-PLAN.md               # Synopsis, themes, timeline
│   ├── PLOT-OUTLINE.md            # Beat sheet or chapter summaries
│   └── TIMELINE.md                # Story timeline (if complex)
├── characters/
│   ├── CHARACTER-BIBLE.md         # All characters in one file
│   └── [character-name].md        # Deep dives for major characters
├── worldbuilding/                  # For fantasy/sci-fi/historical
│   ├── WORLD-BIBLE.md             # Rules, history, geography
│   ├── magic-system.md            # If applicable
│   └── locations/                 # Location details
├── research/                       # For historical, technical, etc.
│   ├── RESEARCH-LOG.md            # What you've researched
│   └── notes/                     # Source notes
├── chapters/
│   ├── act-1/
│   │   ├── ch01-[slug].md
│   │   └── ch02-[slug].md
│   ├── act-2/
│   └── act-3/
├── drafts/
│   ├── draft-1/                   # Complete manuscript versions
│   └── draft-2/
├── scenes/                         # Loose scenes not yet placed
└── README.md                       # Project overview
```

### BOOK-PLAN.md Template

```markdown
# Book Plan: [Title]

## Logline
[One sentence that captures the core conflict]

## Synopsis
[2-3 paragraph summary]

## Genre & Comparables
- **Genre**: [Primary genre + subgenre]
- **Comp Titles**: [Book] meets [Book]
- **Target Audience**: [Who is this for]

## Themes
1. [Primary theme — what is this book ABOUT thematically?]
2. [Secondary theme]

## Structure
- **Format**: [Novel / Novella / Short Story Collection]
- **POV**: [First / Third Limited / Multiple]
- **Tense**: [Past / Present]
- **Target Word Count**: [XX,000]

## Timeline
| Phase | Duration | Deliverable |
|-------|----------|-------------|
| Outline | Weeks 1-2 | PLOT-OUTLINE.md complete |
| Draft 1 | Weeks 3-10 | Rough draft in drafts/draft-1/ |
| Revision | Weeks 11-14 | Draft 2 |
| Beta | Weeks 15-18 | Beta feedback incorporated |
| Polish | Weeks 19-20 | Submission-ready |

## Success Criteria
- [ ] First draft complete
- [ ] [Other goals]
```

### CHARACTER-BIBLE.md Template

```markdown
# Character Bible

## Main Characters

### [Character Name] — [Role: Protagonist/Antagonist/etc.]
- **Age**:
- **Occupation**:
- **Want** (external goal):
- **Need** (internal growth):
- **Lie** (false belief):
- **Ghost** (wound from past):
- **Arc**: [Positive/Negative/Flat]

**Voice notes**: [How they speak, verbal tics, vocabulary level]

**Appearance**: [Key visual details]

**Relationships**:
| Character | Relationship | Dynamic |
|-----------|-------------|---------|
| [Name] | [Role] | [How they interact] |

---

### [Next Character]
...

## Supporting Characters

| Name | Role | One-Line Description |
|------|------|---------------------|
| [Name] | [Best friend] | [Brief] |
```

### copilot-instructions.md Template (Fiction Projects)

```markdown
# [Book Title] — Writing Context

## Project Overview
[2-3 sentence summary: genre, premise, current status]

## Current Phase
- [x] Outlining
- [ ] Drafting (Chapter X of Y)
- [ ] Revision
- [ ] Beta/Feedback

## Key Files
- Book plan: outline/BOOK-PLAN.md
- Plot: outline/PLOT-OUTLINE.md
- Characters: characters/CHARACTER-BIBLE.md
- World: worldbuilding/WORLD-BIBLE.md (if applicable)

## Alex Guidance
- **Voice**: [Describe the narrative voice — literary, commercial, etc.]
- **POV Rules**: [Third limited / No head-hopping / etc.]
- **Tone**: [Dark, humorous, lyrical, etc.]
- When suggesting dialogue: Match character voice from CHARACTER-BIBLE.md
- When reviewing scenes: Check against PLOT-OUTLINE.md for consistency

## Don't
- Don't make the prose purple/overwrought
- Don't add characters not in CHARACTER-BIBLE.md without discussion
- Don't resolve tension too easily

## World Rules (if applicable)
[Key constraints: magic rules, historical accuracy needs, etc.]
```

### Book Project Audit Checklist

```markdown
## Book Project Audit

### Structure Assessment
- [ ] Has outline/ with BOOK-PLAN.md
- [ ] Character documentation exists
- [ ] Chapters organized (by act or sequentially)
- [ ] Drafts versioned separately

### Alex-Readiness Assessment
- [ ] copilot-instructions.md exists with project context
- [ ] Current phase clearly marked
- [ ] Voice/tone guidance provided
- [ ] Key files linked

### Craft Documentation
- [ ] Character arcs defined (want/need/lie)
- [ ] Plot structure documented
- [ ] World rules captured (if applicable)
- [ ] Research tracked (if needed)
```

---

## Story Structure Models

### Three-Act Structure

| Act | Purpose | Proportion |
| --- | ------- | ---------- |
| **Act I: Setup** | Introduce world, character, conflict | 25% |
| **Act II: Confrontation** | Rising stakes, complications | 50% |
| **Act III: Resolution** | Climax, resolution, denouement | 25% |

### Key Plot Points

```text
Act I                    Act II                      Act III
┌─────────────────┬──────────────────────────┬─────────────────┐
│                 │                          │                 │
│   Inciting   Turning    Midpoint    Turning    Climax       │
│   Incident   Point 1              Point 2                   │
│      ↓          ↓          ↓         ↓          ↓           │
└──────┴──────────┴──────────┴─────────┴──────────┴───────────┘
     10%         25%        50%       75%       90%
```

### Alternative Structures

| Structure | Best For | Key Feature |
| --------- | -------- | ----------- |
| **Hero's Journey** | Epic, fantasy | 12 stages, transformation |
| **Save the Cat** | Commercial fiction | 15 beats, clear timing |
| **Seven-Point** | Plotting from ending | Hook → Resolution |
| **Freytag's Pyramid** | Classic drama | Rising/falling action |
| **Kishōtenketsu** | Eastern narrative | No conflict required |
| **In Medias Res** | Thrillers | Start in middle of action |

## Character Development

### Character Dimensions

| Dimension | Questions |
| --------- | --------- |
| **Want** (External) | What does the character pursue? |
| **Need** (Internal) | What must they learn/change? |
| **Lie** | What false belief holds them back? |
| **Ghost** | What past event created the lie? |
| **Flaw** | What weakness emerges from the lie? |
| **Strength** | What positive trait will save them? |

### Character Arc Types

| Arc | Description | Example |
| --- | ----------- | ------- |
| **Positive** | Overcomes flaw, achieves need | Most protagonists |
| **Negative** | Succumbs to flaw, tragic end | Breaking Bad |
| **Flat** | Changes others, not self | Sherlock Holmes |
| **Corruption** | Starts good, ends bad | Anakin Skywalker |
| **Disillusionment** | Loses positive belief | Noir protagonists |

### Character Voice Checklist

- Vocabulary level and word choice
- Sentence rhythm and length
- Speech patterns and verbal tics
- What they notice (reveals values)
- What they avoid talking about
- How they refer to others
- Unique expressions or phrases

## Dialogue Craft

### Dialogue Functions

| Function | Example |
| -------- | ------- |
| **Reveal character** | Word choice shows personality |
| **Advance plot** | Deliver essential information |
| **Create tension** | Subtext, disagreement |
| **Establish relationships** | How characters speak to each other |
| **Provide exposition** | Disguised as natural conversation |

### Subtext Techniques

| Technique | How It Works |
| --------- | ------------ |
| **Saying opposite** | "I'm fine" (clearly not fine) |
| **Deflection** | Answering a different question |
| **Non-sequitur** | Changing subject reveals discomfort |
| **Action contradiction** | Words say one thing, actions another |
| **Silence** | What's NOT said speaks volumes |

### Dialogue Tags

| Tag Type | Usage |
| -------- | ----- |
| "Said" | Invisible, preferred for most |
| Action beat | "I know." She turned away. |
| Specific verb | "Whispered" (sparingly) |
| Adverb | Avoid "said angrily" — show instead |

### Dialogue Formatting

- New speaker = new paragraph
- Action by speaker in same paragraph
- Use contractions naturally
- Read aloud to test flow
- Cut greetings and small talk (usually)

## Point of View

### POV Options

| POV | Advantages | Limitations |
| --- | ---------- | ----------- |
| **First Person** | Intimate, voice-driven | Limited to narrator's knowledge |
| **Third Limited** | Flexible, maintains intimacy | One character's head at a time |
| **Third Omniscient** | All-knowing narrator | Can feel distant |
| **Second Person** | Immersive, unusual | Hard to sustain |
| **Multiple POV** | Multiple perspectives | Risk confusing reader |

### POV Consistency Rules

- Don't "head hop" within scenes
- Signal POV shifts clearly (chapter/section break)
- Maintain consistent psychic distance
- Filter everything through POV character's perception

## Scene Construction

### Scene vs. Summary

| Scene | Summary |
| ----- | ------- |
| Moment-by-moment | Compressed time |
| Dialogue, action | Narration |
| High importance | Transition, backstory |
| Show | Tell |

### Scene Checklist

- [ ] Clear POV character
- [ ] Character wants something
- [ ] Obstacle to that want
- [ ] Something changes by end
- [ ] Hooks to next scene

### Scene-Sequel Pattern

| Scene | Sequel |
| ----- | ------ |
| Goal | Reaction (emotion) |
| Conflict | Dilemma (thought) |
| Disaster | Decision (action) |

## Prose Style

### Show vs. Tell

| Telling | Showing |
| ------- | ------- |
| "She was angry" | Her jaw tightened. She gripped the table edge. |
| "He was nervous" | He wiped his palms on his pants for the third time. |
| "The room was old" | Dust motes floated through slanted light. Wallpaper peeled at the corners. |

### Sensory Details

| Sense | Often Forgotten |
| ----- | --------------- |
| Sight | ✓ Usually covered |
| Sound | Ambient sounds, silence |
| Smell | Powerful memory trigger |
| Touch/Texture | Temperature, surfaces |
| Taste | Beyond food — fear, excitement |

### Prose Rhythm

- Vary sentence length
- Short sentences = tension, speed
- Long sentences = description, reflection
- Fragment for emphasis
- Read aloud to check flow

## Genre Conventions

### Genre Expectations

| Genre | Reader Expects |
| ----- | -------------- |
| **Mystery** | Fair clues, satisfying solution |
| **Romance** | HEA (Happily Ever After) |
| **Thriller** | High stakes, fast pace |
| **Fantasy** | Consistent magic system |
| **Literary** | Beautiful prose, deep themes |
| **Horror** | Building dread, catharsis |

### Genre Blending

- Know both genres' conventions
- Identify which is primary
- Meet core expectations of primary
- Add elements from secondary

## Revision Strategies

### Revision Passes

| Pass | Focus |
| ---- | ----- |
| **1. Story** | Plot holes, arc, structure |
| **2. Character** | Consistency, motivation, voice |
| **3. Scene** | Pacing, purpose, tension |
| **4. Prose** | Sentences, words, rhythm |
| **5. Polish** | Typos, formatting |

### Beta Reader Questions

- Where were you confused?
- Where did you get bored?
- What did you predict?
- Which characters felt real?
- What would you cut?

### Kill Your Darlings

If a passage is:

- Beautiful but slows pacing
- Clever but confuses
- Beloved but unnecessary

...consider cutting it.

## Screenwriting Specifics

### Screenplay Format

```text
SCENE HEADING (SLUGLINE)
INT. COFFEE SHOP - DAY

Action lines describe what we SEE and HEAR.
Present tense. Active voice. Brief.

                    CHARACTER NAME
          Dialogue goes here. Keep it snappy.

                    OTHER CHARACTER
                    (parenthetical)
          Response with direction if needed.
```

### Visual Storytelling

- Show don't tell (literally)
- Enter scenes late, leave early
- Action reveals character
- Subtext over on-the-nose dialogue
- One page ≈ one minute of screen time

## Poetry Elements

### Poetic Devices

| Device | Effect |
| ------ | ------ |
| **Imagery** | Sensory experience |
| **Metaphor** | Comparison without "like" |
| **Simile** | Comparison with "like/as" |
| **Alliteration** | Repeated initial sounds |
| **Assonance** | Repeated vowel sounds |
| **Enjambment** | Line breaks mid-thought |

### Form Considerations

- Free verse — no set rules
- Sonnet — 14 lines, specific rhyme
- Haiku — 5-7-5 syllables
- Villanelle — 19 lines, refrains

## Falsifiability

- This skill adds no value if output quality does not measurably differ between sessions that activate it and sessions that do not
- The form constraints are wrong if they produce stilted or unnatural prose that the user consistently overrides
- Stale if contemporary creative writing conventions shift away from the structures documented here
