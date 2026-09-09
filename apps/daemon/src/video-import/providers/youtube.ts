// YouTube is declared but not built this wave (Part 8 F-05 / DEF-7.4):
// it needs a Google OAuth app and the Data API's download limits, a
// separate track. This module exists only so the providers list and every
// route that takes a `:provider` param can name a typed, closed reason for
// "not yet" instead of a 404 that looks like a routing bug.

export const YOUTUBE_DISABLED_REASON =
  'YouTube video import is not enabled yet — Vimeo ships first (Part 8 F-05); YouTube needs a Google OAuth app and Data API download limits.';

export class YoutubeVideoImportDisabledError extends Error {
  constructor() {
    super(YOUTUBE_DISABLED_REASON);
    this.name = 'YoutubeVideoImportDisabledError';
  }
}
