---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: []
---

# Surface: Design Gravity app shell (flatplan + spread workspace)

Scope: the whole desktop app UI (auth gate, flatplan library + brief composer, spread workspace with margin inspector). Visitor mode: Operate.

Audience/job: a designer writes a brief, the local `agy` agent produces an HTML screen or SVG graphic, the designer tunes tokens and writes margin notes to revise, then exports.

Constraints: editorial light world (user-pinned); typography is the hero; agy must be verified installed + authenticated before generation.

## Direction contract

THESIS: The app is a magazine flatplan. Every design is a numbered page pinned to the wall; opening one lays the spread on the desk. Refuses the category default: dark sidebar + chat bubbles + floating canvas toolbar.

OWN-WORLD: Coated-stock white paper, ink-black type, 1px hairline rules, square corners. Two production inks only: non-photo blueline for grids, guides, folios and crop marks; proof magenta for the one action and every margin note. Schibsted Grotesk set monumental for the brief and page titles, Source Serif 4 (optical sizes) for design titles and deks, JetBrains Mono only in slugs, code and numerals. One shadow in the whole app: the page lying on the desk.

STORY: The designer sees their wall of pages, types a brief at display size, watches the agent's production log run as galley lines in the page's slot, sees the page drop into place, then tunes type, colour and space in the margin and pins magenta notes to elements to revise.

FIRST VIEWPORT: Masthead strip (name, issue folio, press-check auth status). Below, the brief composer spans the width: the prompt field set at ~52px grotesk, Screen/Graphic switch, model, magenta Generate at the field's baseline right. Under it the flatplan: a ruled grid of page thumbnails with folio numbers and production status.

FORM: magazine flatplan wall, position 4 of 7 on the grounded list, seed key 38e8e4d6. Raise from Alphabet storm: the prompt is typeset, not a textbox. Raise from Generative parametric identity: every token edit restyles the page live and in lockstep. Signature interaction: the generated page drops into its flatplan slot (the "gravity" moment); margin-note marking on the live page.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
