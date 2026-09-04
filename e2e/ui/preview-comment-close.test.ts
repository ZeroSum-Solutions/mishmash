// W2H.1d — what actually ends an HTML comment, measured in the browser whose
// parser the body-close scan exists to agree with.
//
// `apps/daemon/src/http/body-close-splice.ts` decides where a preview's paint
// producer is spliced, and the decision turns on where each comment ends. Read
// a comment as ending too LATE and the scan swallows real markup: the
// document's genuine `</body>` is lost, and — the blocking half of D-17 round 4
// — a marked producer the document already carries is hidden, so a second one
// is injected. Read it as ending too EARLY and the scan hands the splice point
// to a `</body>` written inside comment text, where the producer is a comment
// and never runs. Both directions end with a healthy artifact told "Preview did
// not render".
//
// So the rule cannot be argued from the spec alone; it has to be measured
// against the parser, and the measurement has to live where a reviewer can
// re-run it rather than in somebody's terminal. That is this file. The table
// below is the same list `apps/daemon/tests/preview-producer-body-splice.test.ts`
// asserts on the scanner side; the two files are the two halves of one claim,
// and neither imports the other (`e2e` does not reach into `apps/daemon/src`).
//
// The state machine the table exercises, for the reader who wants to check it
// against https://html.spec.whatwg.org/multipage/parsing.html:
//
//   #comment-start-state       `>` closes abruptly       -> `<!-->`
//   #comment-start-dash-state  `>` closes abruptly       -> `<!--->`
//   #comment-end-state         `>` closes; `-` stays     -> `-->`, `--->`
//   #comment-end-bang-state    `>` closes; `-` goes to comment-end-DASH
//                                                        -> `--!>`
//   #comment-end-dash-state    `-` goes to comment end; ANY OTHER character,
//                              `>` included, appends `-` and returns to the
//                              comment state -> `->` does NOT close, and
//                              neither does `--!->`
//
// The last line is the one worth measuring rather than asserting: it is the
// difference between comment-end-dash and comment-START-dash, which look alike
// and behave differently, and a scan that confuses them ends comments early.

import { expect, test } from '@/playwright/suite';

/**
 * One comment spelling, the fragment that exercises it, and whether the parser
 * leaves the comment at that `>`. `data` is what the comment token ends up
 * holding when it closes, which is how a reader can tell WHERE it closed.
 */
const SPELLINGS: ReadonlyArray<{
  name: string;
  fragment: string;
  closes: boolean;
  data?: string;
}> = [
  { name: '`-->`, the ordinary close', fragment: '<!--a-->', closes: true, data: 'a' },
  { name: '`--->`, a dash inside comment-end', fragment: '<!--a--->', closes: true, data: 'a-' },
  { name: '`--!>`, comment-end-bang', fragment: '<!--a--!>', closes: true, data: 'a' },
  { name: '`--!-->`, back to comment-end after a bang', fragment: '<!--a--!-->', closes: true, data: 'a--!' },
  { name: '`<!-->`, an abruptly closed empty comment', fragment: '<!-->', closes: true, data: '' },
  { name: '`<!--->`, the same one dash in', fragment: '<!--->', closes: true, data: '' },
  { name: '`<!---->`, an ordinary empty comment', fragment: '<!---->', closes: true, data: '' },
  // The three that do NOT close, and the reason this file is a measurement.
  { name: '`->`, one dash before the bracket', fragment: '<!--a->', closes: false },
  { name: '`--!->`, comment-end-bang then a dash', fragment: '<!--a--!->', closes: false },
  { name: '`-!>`, a bang with no comment-end before it', fragment: '<!--a-!>', closes: false },
];

test('[P1] which comment terminators the HTML parser accepts', async ({ page }) => {
  for (const spelling of SPELLINGS) {
    await page.goto('about:blank');
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8"></head><body>${spelling.fragment}` +
        '<h1 id="after">After</h1></body></html>',
    );
    const parsed = await page.evaluate(() => {
      const walker = document.createTreeWalker(document, NodeFilter.SHOW_COMMENT);
      const comments: string[] = [];
      let node = walker.nextNode();
      while (node !== null) {
        comments.push(String(node.nodeValue));
        node = walker.nextNode();
      }
      return { reachedMarkupAfter: document.getElementById('after') !== null, comments };
    });

    expect(
      parsed.reachedMarkupAfter,
      `${spelling.name}: the parser ${spelling.closes ? 'leaves' : 'does not leave'} the comment here, ` +
        'so the markup after it is ' + (spelling.closes ? 'markup' : 'comment text'),
    ).toBe(spelling.closes);

    if (spelling.closes) {
      expect(parsed.comments[0], `${spelling.name}: where the comment token ended`).toBe(spelling.data);
    } else {
      // An unclosed comment swallows the rest of the document, which is why the
      // scan's honest answer for one is to append at EOF rather than to guess a
      // splice point inside it.
      expect(parsed.comments[0]).toContain('<h1 id="after">');
    }
  }
});
