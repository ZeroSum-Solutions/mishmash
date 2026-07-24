# After reading @trq212's tweet, I replaced all my markdown with HTML

> Original inspiration: https://x.com/trq212/status/2052809885763747935
>
> In short: in the age of AI writing / editors / agents, markdown's role as an "intermediate form" no longer holds up — HTML is the actual final form for readers.

## Three observations that made me nod along

First, our love for markdown is mostly about how nice it is to write. Readers never got a vote.
What a reader actually sees is always whatever some markdown renderer spits out — and that renderer belongs to the platform, not to you.

Second, markdown loses when it comes to screenshotting a post.
Screenshot any markdown snippet and share it, and it's a gray-and-white block flattened by GitHub's default theme. HTML can look like wallpaper-quality art.

Third, WeChat / Zhihu / Xiaohongshu / Notion / Feishu — every platform interprets markdown differently.
Write it once, and you have to adjust it 5 times across 5 platforms. HTML + inline CSS: paste once, renders identically anywhere.

## But HTML really is too verbose — that part is true

Writing pile after pile of `<div class="...">` gets old fast. That's a fact.
No one wanted to pay that cost before, because for the same content, markdown takes 30 seconds and HTML takes 30 minutes.

The variable that changed — **AI collapsed those 30 minutes into 30 seconds.**
You write markdown, AI upgrades it into deliverable HTML. You own the final form, AI handles the verbose details.

## So we built a small tool for this

Inspired by the original tweet, plus the Claude Code team's own practice, we built [HTML Anything](https://github.com/your-org/html-anything).
Paste markdown / CSV / JSON on the left, pick a template (magazine, deck, poster, Xiaohongshu, data report, ...), hit ⌘+Enter —
a local Claude / Cursor / Codex runs in a session you're **already logged into**, and a few seconds later the right side has HTML ready to paste straight into WeChat / Twitter / Zhihu.

No API key needed, no wasted tokens (a second edit only re-runs the diff).

## Conclusion

If you also feel like "markdown -> manually reformat it in an editor" is wasting your life — take a look at the original tweet, take a look at how the Claude Code team migrated, then try any tool that can automatically upgrade markdown into HTML.

> Header image homage: the moment in the tweet where "everything is HTML".
