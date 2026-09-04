/**
 * The preview paint-report protocol: how a previewed document tells the host
 * that it rendered, and which document the host is allowed to believe.
 *
 * Three transports carry a producer — the srcDoc pipeline
 * (`apps/web/src/runtime/srcdoc.ts`), the daemon's project raw/powered routes,
 * and the daemon's live-artifact preview route. They must all report the same
 * shape or the host's watchdog cannot compare them, and the detector must be
 * one implementation or the three drift apart. Both live here because
 * `packages/contracts` is the only place web and daemon may share a rule.
 *
 * Pure strings and types: no DOM, no fetch, no Node APIs. The producer source
 * is JavaScript text the transports embed; it runs in the previewed document,
 * never here.
 */

/** Report a previewed document posts to its host. */
export const PREVIEW_PAINT_REPORT = 'od:preview-content-size';

/** Host's ask: "report yourself now, for this navigation". */
export const PREVIEW_PAINT_REPORT_REQUEST = 'od:preview-content-size-request';

/**
 * Why a document reported what it did about its own rendering.
 *
 *  - `paint-timing` — the user agent's own Paint Timing reported a contentful
 *    paint for this document. It is the preferred signal, and it is checked
 *    before the scan: the UA sees paint sources no enumeration can keep up with
 *    (`::before` content, for one). It is never the only signal, because Paint
 *    Timing in a nested browsing context is optional per user agent.
 *  - `painted` — Paint Timing said nothing, and the scan found an element that
 *    puts visible output on screen.
 *  - `no-elements` — there is nothing under `<body>` to look at.
 *  - `no-visible-output` — the scan completed and every candidate was hidden,
 *    fully transparent, clipped away, or painted nothing.
 */
export type PreviewPaintReason =
  | 'painted'
  | 'paint-timing'
  | 'no-elements'
  | 'no-visible-output';

/**
 * What a `painted: true` rests on, when that is worth saying.
 *
 *  - `'image-unverified'` — the only paint source found was a raster image
 *    that decoded with a nonzero intrinsic size and whose pixels could not be
 *    read. Pixel transparency is decidable only through an untainted canvas,
 *    which needs an image the document is allowed to read; in the sandboxed
 *    opaque-origin preview frame every http(s) image is cross-origin, so
 *    `getImageData` throws there. A fully transparent image and an opaque one
 *    are then indistinguishable, and the report says `painted: true` AND says
 *    it could not check — rather than guessing either way.
 *
 * `null` on every other report: the evidence was decidable in the document.
 */
export type PreviewPaintEvidence = 'image-unverified';

/** How many candidates the scan rejected, and for what. */
export interface PreviewPaintCounters {
  /** Candidates inspected before the scan stopped. */
  seen: number;
  /** Rejected for `display:none`, `visibility:hidden|collapse`, or opacity 0. */
  hidden: number;
  /** Rejected for having no box, or for one clipped entirely away. */
  clipped: number;
  /** Visible geometry that paints nothing: no text, background, border or content. */
  blank: number;
  /** Candidates whose only paint source was an image whose pixels could not be read. */
  imageUnverified: number;
}

/** What a previewed document posts about its own rendering. */
export interface PreviewPaintReport {
  type: typeof PREVIEW_PAINT_REPORT;
  /** Widest laid-out box, for the host's zoom fitting. `null` when nothing measured. */
  width: number | null;
  /** Positive VISIBLE-output evidence — see `PREVIEW_PAINT_REPORT_PRODUCER_SOURCE`. */
  painted: boolean;
  /** Why `painted` is what it is. */
  reason: PreviewPaintReason;
  /** What a `painted: true` rests on when that is not decidable; `null` otherwise. */
  evidence: PreviewPaintEvidence | null;
  /** What the scan looked at and what it threw away. */
  counters: PreviewPaintCounters;
  /** True when the scan stopped at its candidate cap or time budget. */
  scanTruncated: boolean;
  /**
   * The navigation token the host last asked with, echoed back. `null` before
   * the host has asked. A report whose token is not the host's current one
   * came from a document the host is no longer watching.
   */
  token: string | null;
}

/** Most candidates one scan will inspect. */
export const PREVIEW_PAINT_SCAN_CANDIDATE_LIMIT = 400;

/** Wall-clock budget for one scan, in milliseconds. */
export const PREVIEW_PAINT_SCAN_BUDGET_MS = 50;

/**
 * Source of the shared producer half, as JavaScript text.
 *
 * Defines `window.__odPreviewPaintReport` once per document (idempotent, so a
 * document carrying two bridges installs one detector) with:
 *
 *   - `rememberToken(token)` — records the host's navigation token. Ignores a
 *     non-string, so the untokened zoom-fitting request keeps the token the
 *     watchdog set.
 *   - `post()` — posts a `PreviewPaintReport` to the host.
 *
 * **What `painted` means: visible output, not geometry.** The user agent's own
 * Paint Timing answers first when it has an answer — a `first-contentful-paint`
 * entry for this document is the UA saying it painted content, and it sees
 * sources no enumeration can match. It is optional in a nested browsing
 * context, so when there is no entry the producer decides for itself, and an
 * element counts only when ALL of these hold:
 *
 *   - no ancestor is `display:none`, `visibility:hidden|collapse`, or clipped
 *     to nothing by `clip-path`;
 *   - the product of every opacity on its ancestor chain is above zero — above
 *     zero, not above some floor, because faint is still visible;
 *   - its border box survives clipping against the viewport and against every
 *     ancestor scrollport whose axis overflow is `hidden`, `clip`, `auto` or
 *     `scroll`. An intersection that collapses to nothing is an EMPTY clip, not
 *     an absent one: everything inside a scrollport laid out fully offscreen,
 *     or given no area, is hidden by it rather than released from it;
 *   - and it paints something: a direct non-whitespace text node under a
 *     non-transparent `color`, a non-transparent `background-color`, a
 *     `background-image` that inks, a visible border on some side, a
 *     `box-shadow`, a visible `outline`, an SVG `fill` or `stroke`, a decoded
 *     `img` with intrinsic size and visible pixels, or a `video` with a poster
 *     or a decoded frame.
 *
 * **A paint source is not the same as paint.** Two of those sources can be
 * present and still put nothing on screen, and they are not equally decidable:
 *
 *   - A GRADIENT states its colour stops in the computed value, so one whose
 *     every stop is transparent (`transparent`, a zero alpha in any functional
 *     colour, `#rrggbb00`) is decidably not paint, and one with any
 *     non-transparent stop decidably is.
 *   - A RASTER IMAGE (`img`, `background-image: url(...)`, a `video` frame or
 *     poster) states nothing. Its pixels are readable only through an
 *     untainted canvas, and in the sandboxed opaque-origin preview frame every
 *     http(s) image is cross-origin, so `getImageData` throws `SecurityError`.
 *     Where the pixels CAN be read (a same-origin image) a 16x16 alpha sample
 *     decides, and an all-zero alpha is not paint. Where they cannot, the
 *     answer is unknown and is reported as unknown: the candidate counts as
 *     paint, `evidence` is `'image-unverified'`, and `counters.imageUnverified`
 *     says how many candidates were in that position. A scan that found
 *     decidable evidence anywhere in the document reports that instead — an
 *     unverified candidate does not stop the walk.
 *
 * Blank replaced geometry never counts, and the scan cannot see inside one that
 * is not blank. An empty `canvas`, an `svg` with no painted children and an
 * `iframe` are rectangles of nothing; a canvas that WAS drawn on settles
 * through Paint Timing, which is what a contentful paint means for a canvas.
 * Nothing here calls `getContext`, so the scan can never take a canvas away
 * from the artifact's own renderer.
 *
 * **Bounded by construction.** Viewport hit-test targets are tried first
 * (`elementsFromPoint` over a small grid), then a lazy `TreeWalker`, at most
 * `PREVIEW_PAINT_SCAN_CANDIDATE_LIMIT` candidates and never longer than
 * `PREVIEW_PAINT_SCAN_BUDGET_MS`. Computed styles, ancestor state and each
 * candidate's rect are read once and cached in `WeakMap`s. A scan that stops
 * early says so in `scanTruncated`.
 *
 * **False negatives** (says not painted while something is visible): a
 * document that paints later than the host's watchdog window — the producer
 * re-reports on resize, fonts-ready and its own timers, so a late painter
 * settles when it paints, but one slower than the watchdog is filed. A
 * deliberately blank artifact is reported as not painted, which is the same
 * signal as a broken one; the host cannot tell those apart from outside the
 * frame and reports what it can see.
 *
 * **False positives** (says painted while the user sees nothing): content
 * hidden by a mechanism the scan does not model — an opaque element stacked
 * over everything, a `clip-path` shape that is empty but not written in one of
 * the forms recognised here, or a filter that erases the pixels. A document
 * that painted and then blanked itself also keeps its Paint Timing entry, and
 * is reported as painted; it did render, and the entry is the UA's word for
 * that. An image whose pixels could not be read is the one false positive the
 * report NAMES rather than merely admits to, through `evidence`.
 *
 * Paint Timing is asked before any of this, and a user agent that reports a
 * contentful paint for a decoded image reports one whether or not the image
 * has visible pixels — Chromium does. So the image rules above decide in the
 * user agents that expose no paint timing for a nested browsing context, which
 * the spec allows and which is why the scan exists at all.
 */
export const PREVIEW_PAINT_REPORT_PRODUCER_SOURCE = `(function(){
  if (window.__odPreviewPaintReport) return;
  var CANDIDATE_LIMIT = ${PREVIEW_PAINT_SCAN_CANDIDATE_LIMIT};
  var BUDGET_MS = ${PREVIEW_PAINT_SCAN_BUDGET_MS};
  var HIT_TEST_GRID = 5;
  var CLIPPING_OVERFLOW = /^(hidden|clip|auto|scroll)/;
  var SVG_PAINTED_SHAPES = /^(path|rect|circle|ellipse|line|polyline|polygon|text|tspan|textpath|use|image)$/;
  var EMPTY_CLIP_PATH = /(circle|ellipse)\\(\\s*0[a-z%]*[\\s)]|inset\\(\\s*(100%|50%\\s+50%\\s+50%\\s+50%)|polygon\\(\\s*\\)/;
  // What one candidate's paint sources amount to. The middle value is the
  // whole point: "this would paint IF the image has visible pixels, and this
  // document is not allowed to look".
  var PAINTS = 'paint';
  var PAINTS_NOT = 'none';
  var PAINTS_UNVERIFIED = 'image-unverified';
  // Alpha is sampled on a 16x16 grid rather than read whole: enough to catch a
  // fully transparent image, cheap enough to run inside the scan's budget. It
  // is a SAMPLE, so an image whose only ink is a speck too small to survive
  // the downscale reads as blank -- which is what such an image looks like.
  var IMAGE_ALPHA_SAMPLE = 16;
  var GRADIENT_FUNCTION = /^(?:repeating-)?(?:linear|radial|conic)-gradient\\(/i;
  // Colour stops as they can be written: hex with or without alpha, any
  // functional colour, and the two keywords.
  var COLOUR_TOKEN = /#[0-9a-f]{3,8}|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\\([^()]*\\)|\\b(?:transparent|currentcolor)\\b/gi;
  var HEX_DIGITS = /^[0-9a-f]+$/;
  var token = null;

  function num(value){
    var next = Number(value || 0);
    return Number.isFinite(next) ? next : 0;
  }
  // Computed lengths come back as CSS strings ('2px'), which Number() reads as
  // NaN; a border width parsed to zero would make every bordered box invisible.
  function px(value){
    var next = parseFloat(value);
    return Number.isFinite(next) ? next : 0;
  }
  function nowMs(){
    try {
      if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') {
        return performance.now();
      }
    } catch (_) {}
    return Date.now();
  }
  function measureWidth(){
    var root = document.documentElement;
    var body = document.body || root;
    if (!root) return null;
    var values = [
      root.scrollWidth,
      body && body.scrollWidth,
      root.offsetWidth,
      body && body.offsetWidth,
      root.clientWidth,
      body && body.clientWidth
    ];
    var width = 0;
    for (var i = 0; i < values.length; i += 1) {
      var next = num(values[i]);
      if (next > width) width = next;
    }
    return width > 0 ? Math.ceil(width) : null;
  }
  // One alpha component: a number, a percentage, or the 'none' keyword. A
  // component this cannot read is OPAQUE, never transparent -- see alphaOf.
  function alphaComponent(text){
    var value = String(text == null ? '' : text).trim();
    if (value === '') return 1;
    if (value === 'none') return 0;
    var number = parseFloat(value);
    if (!Number.isFinite(number)) return 1;
    return value.charAt(value.length - 1) === '%' ? number / 100 : number;
  }
  // Alpha of one CSS colour. Every functional colour puts alpha after a '/',
  // the legacy comma forms put it fourth, and '#rgba' / '#rrggbbaa' put it in
  // the trailing digits. A value in none of those shapes reads as OPAQUE: a
  // colour this cannot parse must never be mistaken for an invisible one, or
  // the scan calls a healthy preview blank.
  function alphaOf(color){
    if (!color) return 0;
    var value = String(color).trim().toLowerCase();
    if (value === '' || value === 'transparent' || value === 'none') return 0;
    if (value.charAt(0) === '#') {
      // Only the alpha digits are read, and only when they ARE digits: a
      // malformed hex colour must fall to the opaque default below like any
      // other value this cannot parse, not to NaN and thence to zero.
      if (value.length === 5 && HEX_DIGITS.test(value.charAt(4))) {
        return parseInt(value.charAt(4) + value.charAt(4), 16) / 255;
      }
      if (value.length === 9 && HEX_DIGITS.test(value.slice(7))) {
        return parseInt(value.slice(7), 16) / 255;
      }
      return 1;
    }
    var match = /^[a-z]+\\(([^()]*)\\)$/.exec(value);
    if (!match) return 1;
    var slash = match[1].indexOf('/');
    if (slash >= 0) return alphaComponent(match[1].slice(slash + 1));
    var parts = match[1].split(',');
    if (parts.length < 4) return 1;
    return alphaComponent(parts[3]);
  }
  function paintTimingSawContent(){
    try {
      var entries = performance.getEntriesByType('paint') || [];
      for (var i = 0; i < entries.length; i += 1) {
        if (entries[i] && entries[i].name === 'first-contentful-paint') return true;
      }
    } catch (_) {}
    return false;
  }
  // A clip is one of three things, and keeping the middle one distinct is the
  // whole point of these two helpers:
  //   NO_CLIP     -- no ancestor constrains this box; everything is admitted.
  //   EMPTY_CLIP  -- the constraint collapsed; nothing inside it reaches the
  //                  screen, whatever geometry the descendant has.
  //   a rect      -- the box is constrained to that area.
  // Spelling an empty intersection as NO_CLIP made those first two the same
  // value, so an overflow:hidden ancestor laid out fully offscreen stopped
  // clipping instead of hiding everything inside it.
  var NO_CLIP = null;
  var EMPTY_CLIP = { empty: true };
  function intersect(a, b){
    if (a === EMPTY_CLIP || b === EMPTY_CLIP) return EMPTY_CLIP;
    if (!a) return b || NO_CLIP;
    if (!b) return a;
    var left = Math.max(a.left, b.left);
    var top = Math.max(a.top, b.top);
    var right = Math.min(a.right, b.right);
    var bottom = Math.min(a.bottom, b.bottom);
    if (right - left <= 0 || bottom - top <= 0) return EMPTY_CLIP;
    return { left: left, top: top, right: right, bottom: bottom };
  }
  // Does any part of the rect survive the clip? EMPTY_CLIP admits nothing, NO_CLIP
  // admits everything, and a rect admits whatever overlaps it.
  function clipAdmits(rect, clip){
    var kept = intersect(rect, clip);
    return !!kept && kept !== EMPTY_CLIP;
  }
  function viewportRect(){
    var width = num(window.innerWidth);
    var height = num(window.innerHeight);
    var root = document.documentElement;
    if (!width && root) width = num(root.clientWidth);
    if (!height && root) height = num(root.clientHeight);
    // A context that reports no viewport is not clipping anything -- NO_CLIP,
    // not an empty clip. Do not invent a zero-sized viewport and reject every
    // candidate in the document.
    if (!(width > 0 && height > 0)) return NO_CLIP;
    return { left: 0, top: 0, right: width, bottom: height };
  }
  function styleOf(el, scan){
    if (scan.styles.has(el)) return scan.styles.get(el);
    var style = null;
    try {
      if (typeof window.getComputedStyle === 'function') style = window.getComputedStyle(el);
    } catch (_) { style = null; }
    scan.styles.set(el, style);
    return style;
  }
  function rectOf(el, scan){
    if (scan.rects.has(el)) return scan.rects.get(el);
    var rect = null;
    try {
      if (typeof el.getBoundingClientRect === 'function') {
        var raw = el.getBoundingClientRect();
        if (raw) {
          var left = num(raw.left);
          var top = num(raw.top);
          rect = { left: left, top: top, right: left + num(raw.width), bottom: top + num(raw.height) };
        }
      }
    } catch (_) {}
    scan.rects.set(el, rect);
    return rect;
  }
  function clipsChildren(style){
    if (!style) return false;
    var x = style.overflowX || style.overflow || '';
    var y = style.overflowY || style.overflow || '';
    return CLIPPING_OVERFLOW.test(x) || CLIPPING_OVERFLOW.test(y);
  }
  function stateOf(el, scan){
    if (!el) return scan.root;
    if (scan.states.has(el)) return scan.states.get(el);
    var parent = stateOf(el.parentElement || null, scan);
    var style = styleOf(el, scan);
    var ownOpacity = 1;
    if (style && style.opacity !== '' && style.opacity != null) ownOpacity = num(style.opacity);
    var visible = parent.visible;
    if (style) {
      if (style.display === 'none') visible = false;
      if (style.visibility === 'hidden' || style.visibility === 'collapse') visible = false;
      if (style.clipPath && style.clipPath !== 'none' && EMPTY_CLIP_PATH.test(style.clipPath)) visible = false;
    }
    var clipChildren = parent.clipChildren;
    if (clipsChildren(style)) clipChildren = intersect(clipChildren, rectOf(el, scan));
    var state = {
      visible: visible,
      opacity: parent.opacity * ownOpacity,
      clipSelf: parent.clipChildren,
      clipChildren: clipChildren
    };
    scan.states.set(el, state);
    return state;
  }
  function hasDirectText(el){
    var kids = el.childNodes;
    if (!kids) return false;
    var limit = Math.min(kids.length, 32);
    for (var i = 0; i < limit; i += 1) {
      var node = kids[i];
      if (node && node.nodeType === 3 && typeof node.nodeValue === 'string' && node.nodeValue.trim() !== '') {
        return true;
      }
    }
    return false;
  }
  function hasVisibleBorder(style){
    var sides = ['Top', 'Right', 'Bottom', 'Left'];
    for (var i = 0; i < sides.length; i += 1) {
      var side = sides[i];
      var lineStyle = style['border' + side + 'Style'];
      if (!lineStyle || lineStyle === 'none' || lineStyle === 'hidden') continue;
      if (px(style['border' + side + 'Width']) <= 0) continue;
      if (alphaOf(style['border' + side + 'Color']) > 0) return true;
    }
    return false;
  }
  function hasVisibleOutline(style){
    var lineStyle = style.outlineStyle;
    if (!lineStyle || lineStyle === 'none' || lineStyle === 'hidden') return false;
    if (px(style.outlineWidth) <= 0) return false;
    return alphaOf(style.outlineColor) > 0;
  }
  // Split a comma-separated CSS list at TOP-LEVEL commas only: the commas
  // inside 'rgba(...)' and inside a gradient's own argument list are its.
  function splitLayers(value){
    var parts = [];
    var depth = 0;
    var start = 0;
    for (var i = 0; i < value.length; i += 1) {
      var char = value.charAt(i);
      if (char === '(') depth += 1;
      else if (char === ')') { if (depth > 0) depth -= 1; }
      else if (char === ',' && depth === 0) { parts.push(value.slice(start, i)); start = i + 1; }
    }
    parts.push(value.slice(start));
    return parts;
  }
  // Does a gradient layer ink anything? Only a layer whose every colour stop is
  // READ and transparent does not. Anything the scrape could not read is
  // assumed to ink -- the same direction as alphaOf, and for the same reason:
  // calling a healthy preview blank is the failure this whole detector exists
  // to remove.
  //
  // Two ways a layer can be unreadable, and both fail toward ink: no colour
  // token at all, and a token list that leaves a parenthesised construct behind
  // once the stops and the gradient's own opener are struck out. The second is
  // what a nested or unrecognised colour function looks like -- 'color-mix(in
  // srgb, red, white)' beside a 'transparent' stop would otherwise read as a
  // layer whose only stop is transparent, and a painted box would be called
  // blank.
  function gradientPaints(layer){
    var stops = layer.match(COLOUR_TOKEN);
    if (!stops) return true;
    for (var i = 0; i < stops.length; i += 1) {
      if (alphaOf(stops[i]) > 0) return true;
    }
    var residue = layer.replace(COLOUR_TOKEN, ' ').replace(GRADIENT_FUNCTION, ' ');
    return residue.indexOf('(') >= 0;
  }
  // What a 'background-image' value puts on screen: PAINTS when some layer
  // states a non-transparent stop, PAINTS_NOT when every layer is a gradient
  // with nothing but transparent stops, PAINTS_UNVERIFIED when the only inking
  // layer is a raster this cannot read ('url(...)', 'image-set(...)').
  function backgroundImagePaints(value){
    if (!value || value === 'none') return PAINTS_NOT;
    var layers = splitLayers(String(value));
    var unverified = false;
    for (var i = 0; i < layers.length; i += 1) {
      var layer = layers[i].trim();
      if (layer === '' || layer.toLowerCase() === 'none') continue;
      if (GRADIENT_FUNCTION.test(layer)) {
        if (gradientPaints(layer)) return PAINTS;
        continue;
      }
      unverified = true;
    }
    return unverified ? PAINTS_UNVERIFIED : PAINTS_NOT;
  }
  // Whether a decoded image's pixels are visible. Reading them needs an
  // untainted canvas, which needs an image this document is allowed to read;
  // a cross-origin one taints it and 'getImageData' throws SecurityError. In
  // the sandboxed opaque-origin preview frame that is every http(s) image, so
  // the unreadable answer is the common one and must stay honest: neither
  // "blank" nor plain "painted", but PAINTS_UNVERIFIED.
  function imagePixelsPaint(source){
    try {
      var canvas = document.createElement('canvas');
      canvas.width = IMAGE_ALPHA_SAMPLE;
      canvas.height = IMAGE_ALPHA_SAMPLE;
      var context = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
      if (!context) return PAINTS_UNVERIFIED;
      context.drawImage(source, 0, 0, IMAGE_ALPHA_SAMPLE, IMAGE_ALPHA_SAMPLE);
      var pixels = context.getImageData(0, 0, IMAGE_ALPHA_SAMPLE, IMAGE_ALPHA_SAMPLE).data;
      for (var i = 3; i < pixels.length; i += 4) {
        if (pixels[i] > 0) return PAINTS;
      }
      return PAINTS_NOT;
    } catch (_) {
      return PAINTS_UNVERIFIED;
    }
  }
  function paintsSomething(el, style){
    var tag = el.tagName ? String(el.tagName).toLowerCase() : '';
    var unverified = false;
    if (style) {
      if (hasDirectText(el) && alphaOf(style.color) > 0) return PAINTS;
      if (alphaOf(style.backgroundColor) > 0) return PAINTS;
      var background = backgroundImagePaints(style.backgroundImage);
      if (background === PAINTS) return PAINTS;
      if (background === PAINTS_UNVERIFIED) unverified = true;
      if (hasVisibleBorder(style)) return PAINTS;
      if (style.boxShadow && style.boxShadow !== 'none') return PAINTS;
      if (hasVisibleOutline(style)) return PAINTS;
      if (SVG_PAINTED_SHAPES.test(tag)) {
        if (alphaOf(style.fill) > 0) return PAINTS;
        if (alphaOf(style.stroke) > 0 && px(style.strokeWidth) > 0) return PAINTS;
      }
    }
    if (tag === 'img') {
      if (el.complete === true && num(el.naturalWidth) > 0 && num(el.naturalHeight) > 0) {
        var pixels = imagePixelsPaint(el);
        if (pixels !== PAINTS_NOT) return pixels;
      }
    } else if (tag === 'video') {
      // A poster and a decoded frame are rasters like any other, and there is
      // no cheaper read of them than the image case above -- which drawImage
      // cannot do for a video that has not reached a frame. Unverified.
      var poster = typeof el.getAttribute === 'function' ? el.getAttribute('poster') : null;
      if ((typeof poster === 'string' && poster !== '') || num(el.readyState) >= 2) {
        return PAINTS_UNVERIFIED;
      }
    }
    // A canvas, an svg root and an iframe are blank rectangles until something
    // paints in them, and the scan cannot see in. A drawn canvas settles
    // through Paint Timing above, never through its geometry here.
    return unverified ? PAINTS_UNVERIFIED : PAINTS_NOT;
  }
  function candidateIsVisibleOutput(el, scan){
    var state = stateOf(el, scan);
    if (!state.visible || !(state.opacity > 0)) { scan.hidden += 1; return PAINTS_NOT; }
    var rect = rectOf(el, scan);
    if (!rect || rect.right - rect.left <= 0 || rect.bottom - rect.top <= 0) { scan.clipped += 1; return PAINTS_NOT; }
    if (!clipAdmits(rect, state.clipSelf)) { scan.clipped += 1; return PAINTS_NOT; }
    var paints = paintsSomething(el, styleOf(el, scan));
    if (paints === PAINTS_NOT) { scan.blank += 1; return PAINTS_NOT; }
    if (paints === PAINTS_UNVERIFIED) scan.imageUnverified += 1;
    return paints;
  }
  function hitTestTargets(viewport){
    var found = [];
    if (!viewport) return found;
    try {
      if (typeof document.elementsFromPoint !== 'function') return found;
      var width = viewport.right - viewport.left;
      var height = viewport.bottom - viewport.top;
      for (var gx = 1; gx <= HIT_TEST_GRID; gx += 1) {
        for (var gy = 1; gy <= HIT_TEST_GRID; gy += 1) {
          var at = document.elementsFromPoint(
            (width * gx) / (HIT_TEST_GRID + 1),
            (height * gy) / (HIT_TEST_GRID + 1)
          );
          if (!at) continue;
          for (var i = 0; i < at.length; i += 1) found.push(at[i]);
        }
      }
    } catch (_) {}
    return found;
  }
  function scanForVisibleOutput(){
    var viewport = viewportRect();
    var scan = {
      styles: new WeakMap(),
      rects: new WeakMap(),
      states: new WeakMap(),
      root: { visible: true, opacity: 1, clipSelf: viewport, clipChildren: viewport },
      seen: 0,
      hidden: 0,
      clipped: 0,
      blank: 0,
      imageUnverified: 0,
      truncated: false
    };
    // Preferred signal, asked first: the user agent reports a contentful paint
    // for sources no enumeration can keep up with. Never the only signal --
    // Paint Timing is optional in a nested browsing context, and the scan below
    // is what answers when the UA says nothing.
    if (paintTimingSawContent()) {
      return { painted: true, reason: 'paint-timing', evidence: null, scan: scan };
    }
    var body = document.body;
    if (!body) {
      return { painted: false, reason: 'no-elements', evidence: null, scan: scan };
    }
    var queue = hitTestTargets(viewport);
    queue.push(body);
    var walker = null;
    try {
      if (typeof document.createTreeWalker === 'function') walker = document.createTreeWalker(body, 1);
    } catch (_) { walker = null; }
    var visited = new WeakSet();
    var index = 0;
    var unverified = false;
    var deadline = nowMs() + BUDGET_MS;
    while (true) {
      if (scan.seen >= CANDIDATE_LIMIT) { scan.truncated = true; break; }
      if (nowMs() > deadline) { scan.truncated = true; break; }
      var el = null;
      if (index < queue.length) { el = queue[index]; index += 1; }
      else if (walker) { el = walker.nextNode(); }
      if (!el) break;
      if (visited.has(el)) continue;
      visited.add(el);
      scan.seen += 1;
      var paints = candidateIsVisibleOutput(el, scan);
      // Evidence the scan can stand behind ends the walk. An unverified
      // candidate does not: a document that also holds something decidably
      // visible deserves to be reported on THAT, without the caveat.
      if (paints === PAINTS) {
        return { painted: true, reason: 'painted', evidence: null, scan: scan };
      }
      if (paints === PAINTS_UNVERIFIED) unverified = true;
    }
    if (unverified) {
      return { painted: true, reason: 'painted', evidence: PAINTS_UNVERIFIED, scan: scan };
    }
    return {
      painted: false,
      reason: scan.seen === 0 ? 'no-elements' : 'no-visible-output',
      evidence: null,
      scan: scan
    };
  }
  window.__odPreviewPaintReport = {
    rememberToken: function(next){
      if (typeof next === 'string' && next) token = next;
    },
    post: function(){
      try {
        var result = scanForVisibleOutput();
        window.parent.postMessage({
          type: '${PREVIEW_PAINT_REPORT}',
          width: measureWidth(),
          painted: result.painted,
          reason: result.reason,
          evidence: result.evidence,
          counters: {
            seen: result.scan.seen,
            hidden: result.scan.hidden,
            clipped: result.scan.clipped,
            blank: result.scan.blank,
            imageUnverified: result.scan.imageUnverified
          },
          scanTruncated: result.scan.truncated,
          token: token
        }, '*');
      } catch (_) {}
    }
  };
})();`;

/**
 * Mints a navigation token. One per watchdog arming, so a report carrying an
 * earlier token is recognisable as an answer from a document the host has
 * stopped watching.
 */
export function mintPreviewNavigationToken(): string {
  const random = Math.random().toString(36).slice(2);
  return `pnv-${Date.now().toString(36)}-${random}`;
}
