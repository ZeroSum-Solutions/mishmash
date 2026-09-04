// The placeholder image `GET /api/projects/:id/cover` serves for a cover the
// daemon has advertised but whose stored bytes it cannot read right now.

/**
 * A 16x10 opaque PNG filled with one neutral grey (#d4d4d8) -- deliberately a
 * blank tile and NOT a broken-image glyph, an error card, or any drawn mark.
 *
 * Two properties are load-bearing and must survive any replacement:
 *
 *  - It decodes. An `<img>` that cannot decode its bytes fires the same
 *    `client_resource_error` -> `resource-failed` anomaly a 404 fires, so a
 *    zero-byte or malformed placeholder would fix nothing.
 *  - It is flat and untextured, so scaling it to any card size through
 *    `object-fit` produces an even surface rather than a stretched picture.
 *    16x10 keeps the stored constant small at the covers' 1.6 aspect ratio.
 *
 * The grey is a mid-light neutral: legible as "nothing here yet" against the
 * light card surface, and unobtrusive against the dark one. It carries no
 * brand colour -- this repository has no house aesthetic (root AGENTS.md,
 * "Design authority").
 */
export const COVER_PLACEHOLDER_PNG: Buffer = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAKCAIAAAAy3EnLAAAAFElEQVR42mO4cuUGSYhhVMPQ1AAA5cyQEA84f14AAAAASUVORK5CYII=',
  'base64',
);
