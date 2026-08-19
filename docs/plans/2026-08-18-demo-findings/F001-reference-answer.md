# F001 · Reference answer (verbatim, Devin, 2026-08-18)

Preserved word-for-word as the **gold-standard output shape** for the template advisor.
Read alongside `F001-conversational-template-advisor.md` §Addendum A.2 / A.3, which
turn this into requirements. Do not paraphrase or "improve" this file — it is a fixture.

---

the sirch should pull up something like "PICK ONE OR EACH SECTION"

**Template directions (pick one)**

1. **Literary journal** — the safest, most credible look. Wide serif column, generous line height, almost no imagery. Poems live in the layout itself. Good if the writing is the product.

2. **Small press / bookshop** — a hero with one book cover, a shop grid, an about page, a mailing list. Good if you sell physical or digital books.

3. **Poet portfolio** — big name, short bio, a few featured poems, readings calendar, contact. Good for bookings and workshops.

4. **Zine / risograph** — off-white paper, one loud ink color, tight type. Fun and memorable, but harder to keep looking professional. Only pick it if the poetry is playful or political.

Concrete off-the-shelf options: Squarespace (Hester, Novo, Marta — clean editorial), Ghost (Casper or Solo — best if the site is mostly writing plus a newsletter), WordPress (Kubrick-era simple themes, or Blocksy), Cargo for the zine route. Ghost is the one I'd point a poet at — reading experience and email subscriptions come free.

**Colors**

Poetry reads best on warm paper, not white. Three palettes that hold up:

*Paper & ink (literary journal)*
Background `#FAF7F2` · Text `#1A1A18` · Muted `#6B6862` · Rule `#E0DAD0` · Accent `#8A3324` (burnt sienna, links only)

*Dusk (evening readings, moodier work)*
Background `#14161A` · Text `#EDE8E0` · Muted `#8C8F95` · Rule `#282C33` · Accent `#C8A55B` (aged brass)

*Riso (zine)*
Background `#F2EFE6` · Text `#111111` · Accent `#FF4A1C` or `#2B44FF` — one only, used loud

Rule of thumb: one accent, used for links and a single button. Poetry sites die from too much color.

**Fonts**

Pair a display serif with a text serif or a quiet sans:

| Use | Font | Why |
|---|---|---|
| Poems + body | EB Garamond or Crimson Pro | Old-style, warm, holds long stanzas |
| Alternative body | Newsreader or Source Serif 4 | Slightly more modern, screen-tuned |
| Headings | Fraunces (soft optical) or Playfair Display | Character without shouting |
| UI, nav, captions | Inter or Söhne/system-ui | Stays out of the way |

All except Söhne are free on Google Fonts.

Typesetting details that matter more than the font choice:

- Body size 19–21px, line height 1.65–1.75
- Measure capped at ~62 characters (`max-width: 34rem`)
- Poems: preserve line breaks exactly — left-align, never justify, never center a whole poem
- Use `white-space: pre-wrap` on poem blocks so stanza indentation survives
- Hanging indent for wrapped lines so a long line doesn't read like a new one
