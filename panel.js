/*
 * panel.js
 * ---------------------------------------------------------------------------
 * The Crossroads bar itself, ported from the Tavo plugin's ui/panel.html.
 * Everything that was pure logic (prompt building, tone icons, drag/placement
 * math, rendering) is unchanged from the original - only the handful of spots
 * that talked to the Tavo host (tavo.plugin.config, tavo.get/set, tavo.chat/
 * persona/character, tavo.message.find, tavo.generate, tavo.input.set,
 * tavo.plugin.on) were rebound to SillyTavern's equivalents via store.js and
 * connection.js. See BAR_HTML below for the markup index.js injects, and
 * init() for the boot sequence index.js calls once that markup is in the DOM.
 * ---------------------------------------------------------------------------
 */

import * as Store from "./store.js";
import * as Connection from "./connection.js";

export const BAR_HTML = `
<div class="cr" data-cr-root hidden>
  <div class="cr__panel cr__bubble" data-cr-bubble role="dialog" aria-label="Crossroads option">
    <div class="cr__panel-head">
      <span class="cr__panel-icon" data-cr-bubble-icon></span>
      <span class="cr__panel-label" data-cr-bubble-label></span>
      <div class="cr__panel-tools" role="group" aria-label="Option enhancement">
        <button class="cr__head-tool" type="button" data-cr-expand
          aria-label="Expand this option" title="Expand this option">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 4H4v5M15 4h5v5M4 15v5h5M20 15v5h-5M9 9 4 4M15 9l5-5M9 15l-5 5M15 15l5 5"/>
          </svg>
        </button>
        <button class="cr__head-tool" type="button" data-cr-ooc-toggle
          aria-label="Open custom OOC enhancer" aria-expanded="false"
          title="Custom enhance with OOC">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m4 20 10.6-10.6M13.2 5.2l5.6 5.6M16.2 2.8l.5-1.6M20.7 7.3l1.6-.5M19.3 3.7l1.2-1.2M5.3 12.5l-.6-1.6M2.7 15.1l-1.6.6"/>
          </svg>
        </button>
      </div>
      <button class="cr__x" type="button" data-cr-bubble-close aria-label="Close option">&#215;</button>
    </div>
    <div class="cr__enhance-prompt" data-cr-enhance-prompt hidden>
      <label class="cr__enhance-label" for="cr-enhance-ooc">Custom enhancement instruction (OOC)</label>
      <textarea id="cr-enhance-ooc" class="cr__enhance-ooc" data-cr-enhance-ooc
        maxlength="800" rows="2"
        placeholder="Describe the rewrite, e.g. expand this with more tension and sensory detail, or make the dialogue more guarded."></textarea>
      <div class="cr__enhance-actions">
        <p class="cr__hint">The wand follows this instruction. It only expands when you ask it to.</p>
        <button class="cr__enhance-run" type="button" data-cr-enhance disabled>Enhance with OOC</button>
      </div>
    </div>
    <div class="cr__panel-body" data-cr-bubble-body></div>
    <div class="cr__panel-foot">
      <button class="cr__use" type="button" data-cr-use>Use this</button>
      <button class="cr__ghost" type="button" data-cr-bubble-redraw title="Replace only this option">Redraw this</button>
    </div>
  </div>

  <div class="cr__panel cr__theme" data-cr-theme role="dialog" aria-label="Crossroads appearance">
    <div class="cr__panel-head">
      <span class="cr__panel-label">Appearance</span>
      <button class="cr__x" type="button" data-cr-theme-close aria-label="Close appearance">&#215;</button>
    </div>
    <div class="cr__panel-body cr__theme-body" data-cr-theme-body></div>
  </div>

  <div class="cr__bar" data-cr-bar>
    <button class="cr__toggle" type="button" data-cr-toggle aria-label="Show or hide options" title="Show or hide options">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
    </button>
    <button class="cr__draw" type="button" data-cr-draw aria-label="Draw options">
      <span class="cr__draw-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M12 3v6M12 15v6M3 12h6M15 12h6M6.3 6.3l4.2 4.2M13.5 13.5l4.2 4.2M17.7 6.3l-4.2 4.2M10.5 13.5l-4.2 4.2"/></svg>
      </span>
      <span class="cr__draw-text" data-cr-draw-text>Draw</span>
      <span class="cr__draw-badge" data-cr-badge hidden></span>
    </button>
    <div class="cr__slots" data-cr-slots></div>
    <button class="cr__icon-btn" type="button" data-cr-palette aria-label="Appearance" title="Appearance">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="9" cy="9.5" r="1.3"/><circle cx="15" cy="9.5" r="1.3"/><circle cx="9.5" cy="15" r="1.3"/></svg>
    </button>
    <div class="cr__sweep" data-cr-sweep hidden></div>
  </div>

  <div class="cr__live" data-cr-live aria-live="polite"></div>
</div>
`;

export function init() {
  var root = document.querySelector("[data-cr-root]");
  if (!root) return;

  // A mouse click is essentially pixel-perfect, but a finger tap on real touch hardware
  // routinely drifts several CSS px between touchstart and touchend even when the user
  // meant a plain tap - a threshold this tight for touch spuriously started a "drag" on
  // ordinary taps, which captured the pointer and (via the post-drag click-swallow window
  // below) silently ate the very tap that should have opened a slot's bubble. Mouse/pen
  // keep the tight threshold; touch gets a more forgiving one.
  var DRAG_START_PX = 5;
  var DRAG_START_PX_TOUCH = 14;
  var BAR_MARGIN = 6;
  var OPTION_COUNT = 4;
  // Normal draws are still intentionally short, but an option expanded with the wand needs
  // room to become a complete roleplay turn without being cut off during save/restore.
  var MAX_OPTION_CHARS = 6000;
  var MAX_ENHANCE_OOC_CHARS = 800;
  // Only two responses are sent, so they are sent in full. The ceiling exists purely as a
  // runaway guard: a 1400 cap previously severed an opening message mid-sentence and took
  // the question being asked with it, leaving the model to guess what it was replying to.
  var MAX_MESSAGE_CHARS = 6000;
  var MAX_CARD_CHARS = 1500;
  var MAX_PROMPT_CHARS = 20000;
  // Two responses keeps the live situation intact at a fraction of the tokens; the card
  // carries the longer-term continuity that a wider transcript window used to supply.
  var AI_RESPONSE_WINDOW = 2;

  // Each tone the model may pick, with the icon shown on its slot. Keeping this list
  // closed means a hallucinated tone falls back cleanly instead of rendering nothing.
  var TONES = {
    bold:     { label: "Bold",     path: '<path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5z"/>' },
    guarded:  { label: "Guarded",  path: '<path d="M12 3l7.5 3v5.5c0 4.6-3.1 8.4-7.5 9.5-4.4-1.1-7.5-4.9-7.5-9.5V6L12 3z"/>' },
    warm:     { label: "Warm",     path: '<path d="M12 20s-7-4.4-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.6-7 9-7 9z"/>' },
    sly:      { label: "Sly",      path: '<path d="M3 7c3.5-1.5 6-1.5 9 0 3-1.5 5.5-1.5 9 0 0 6-2.5 9-5 9-1.8 0-3-1.4-4-3-1 1.6-2.2 3-4 3-2.5 0-5-3-5-9z"/>' },
    curious:  { label: "Curious",  path: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.4-4.4"/>' },
    wry:      { label: "Wry",      path: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5c1 1.2 2.2 1.8 3.5 1.8s2.5-.6 3.5-1.8M9 9.5h.01M15 9.5h.01"/>' },
    grim:     { label: "Grim",     path: '<path d="M12 3l9 16H3L12 3z"/><path d="M12 9.5v4M12 16.5h.01"/>' },
    tender:   { label: "Tender",   path: '<path d="M12 21C7 17.5 4 14.4 4 11a4 4 0 0 1 8-1.2A4 4 0 0 1 20 11c0 1.4-.5 2.7-1.4 4"/><path d="M15 17h6M18 14v6"/>' }
  };
  var FALLBACK_TONE = "curious";

  var ACCENTS = ["#c8a24a", "#d2694a", "#7fa7d4", "#8fbf7f", "#b58ac8", "#d48aa8", "#8ec8c0", "#cfc9bd"];
  var BACKDROPS = ["#17171a", "#101014", "#1d1a17", "#141b18", "#181420", "#232326", "#FDFBD4"];

  var barEl = root.querySelector("[data-cr-bar]");
  var slotsEl = root.querySelector("[data-cr-slots]");
  var drawBtn = root.querySelector("[data-cr-draw]");
  var drawTextEl = root.querySelector("[data-cr-draw-text]");
  var badgeEl = root.querySelector("[data-cr-badge]");
  var sweepEl = root.querySelector("[data-cr-sweep]");
  var bubbleEl = root.querySelector("[data-cr-bubble]");
  var bubbleIconEl = root.querySelector("[data-cr-bubble-icon]");
  var bubbleLabelEl = root.querySelector("[data-cr-bubble-label]");
  var bubbleBodyEl = root.querySelector("[data-cr-bubble-body]");
  var useBtn = root.querySelector("[data-cr-use]");
  var bubbleRedrawBtn = root.querySelector("[data-cr-bubble-redraw]");
  var expandBtn = root.querySelector("[data-cr-expand]");
  var enhanceBtn = root.querySelector("[data-cr-enhance]");
  var enhancePromptEl = root.querySelector("[data-cr-enhance-prompt]");
  var enhanceOocToggleBtn = root.querySelector("[data-cr-ooc-toggle]");
  var enhanceOocEl = root.querySelector("[data-cr-enhance-ooc]");
  var themeEl = root.querySelector("[data-cr-theme]");
  var themeBodyEl = root.querySelector("[data-cr-theme-body]");
  var liveEl = root.querySelector("[data-cr-live]");
  var toggleEl = root.querySelector("[data-cr-toggle]");

  var options = [];
  var usedIds = Object.create(null);
  var openIndex = -1;
  var busy = false;
  var closing = false;
  var dragEndedAt = 0;
  var ui = { accent: ACCENTS[0], backdrop: BACKDROPS[0], barX: null, barY: null, open: false };

  function cfg(key, fallback) {
    try {
      var value = Store.settings ? Store.settings[key] : undefined;
      return value == null ? fallback : value;
    } catch (_) { return fallback; }
  }

  function toast(message) {
    try { toastr.warning(String(message || ""), "Crossroads"); } catch (_) {}
  }

  function announce(message) {
    if (!liveEl) return;
    liveEl.textContent = "";
    setTimeout(function () { if (liveEl) liveEl.textContent = String(message || ""); }, 20);
  }

  function cap(value, limit) {
    var text = value == null ? "" : String(value);
    return text.length > limit ? text.slice(0, limit - 1).trimEnd() + "…" : text;
  }

  function wordCount(value) {
    var text = String(value == null ? "" : value).trim();
    return text ? text.split(/\s+/).length : 0;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function clampNumber(value, min, max, fallback) {
    var n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function isHexColor(value) { return /^#[0-9a-f]{6}$/i.test(String(value || "")); }

  function toneIcon(tone) {
    var entry = TONES[tone] || TONES[FALLBACK_TONE];
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + entry.path + "</svg>";
  }

  function toneLabel(tone) { return (TONES[tone] || TONES[FALLBACK_TONE]).label; }

  function panelOpen(el) { return !!el && el.classList.contains("is-open"); }
  function setPanel(el, open) { if (el) el.classList.toggle("is-open", !!open); }

  function enhancePromptOpen() { return !!enhancePromptEl && !enhancePromptEl.hidden; }

  function syncEnhanceControls() {
    var hasInstruction = !!(enhanceOocEl && enhanceOocEl.value.trim());
    if (enhanceBtn) enhanceBtn.disabled = busy || !hasInstruction;
    if (enhanceOocToggleBtn) enhanceOocToggleBtn.classList.toggle("has-instruction", hasInstruction);
  }

  function setEnhancePrompt(open) {
    var showing = !!open;
    if (enhancePromptEl) enhancePromptEl.hidden = !showing;
    if (enhanceOocToggleBtn) enhanceOocToggleBtn.setAttribute("aria-expanded", showing ? "true" : "false");
    syncEnhanceControls();
    if (showing && enhanceOocEl) {
      setTimeout(function () { try { enhanceOocEl.focus(); } catch (_) {} }, 0);
    }
  }

  /* ---------- appearance and placement ---------- */

  function loadUi() {
    var saved = Store.settings && Store.settings.ui;
    if (saved && typeof saved === "object") {
      if (isHexColor(saved.accent)) ui.accent = saved.accent;
      if (isHexColor(saved.backdrop)) ui.backdrop = saved.backdrop;
      ui.barX = saved.barX == null ? null : Number(saved.barX);
      ui.barY = saved.barY == null ? null : Number(saved.barY);
      ui.open = saved.open === true;
    }
  }

  function saveUi() {
    if (!Store.settings) return;
    Store.settings.ui = { accent: ui.accent, backdrop: ui.backdrop, barX: ui.barX, barY: ui.barY, open: ui.open };
    Store.saveUi();
  }

  function barSize() {
    var rect = barEl ? barEl.getBoundingClientRect() : null;
    return { w: rect && rect.width ? rect.width : 180, h: rect && rect.height ? rect.height : 42 };
  }

  // Width the bar will occupy once the slots have finished sliding out. The slots are
  // clipped to max-width 0 while closed, but scrollWidth still reports their real extent,
  // so the bar can be moved clear of the right edge before it grows instead of after.
  function predictedOpenWidth() {
    var current = barSize().w;
    if (ui.open || !slotsEl || !options.length) return current;
    var extra = slotsEl.scrollWidth || 0;
    return current + (extra ? extra + 5 : 0);
  }

  // Keep the bar on screen after a rotation, a keyboard opening, or an expand that grew it.
  function clampBar(widthOverride) {
    var size = barSize();
    var width = Math.max(size.w, Number(widthOverride) || 0);
    var maxX = Math.max(BAR_MARGIN, window.innerWidth - width - BAR_MARGIN);
    var maxY = Math.max(BAR_MARGIN, window.innerHeight - size.h - BAR_MARGIN);
    var defaultX = Math.max(BAR_MARGIN, Math.round((window.innerWidth - width) / 2));
    var defaultY = Math.max(BAR_MARGIN, Math.round(window.innerHeight * 0.78));
    ui.barX = clampNumber(ui.barX == null ? defaultX : ui.barX, BAR_MARGIN, maxX, defaultX);
    ui.barY = clampNumber(ui.barY == null ? defaultY : ui.barY, BAR_MARGIN, maxY, defaultY);
  }

  function applyBarPosition() {
    root.style.setProperty("--cr-bar-x", ui.barX + "px");
    root.style.setProperty("--cr-bar-y", ui.barY + "px");
    positionPanels();
  }

  // Panels sit above the bar when it is parked low, and below it when parked high.
  //
  // Everything is driven on the TOP axis, never `bottom`. Some mobile layouts (notably
  // the AstraProjecta extension) put a transform on <html> AND pull everything out of flow
  // so <html> collapses to height:0. Per spec a transformed <html> becomes the containing
  // block for our position:fixed panels, so a `bottom` offset then resolves against that
  // collapsed box's bottom edge - which sits at y=0 - and throws the panel clean off the
  // TOP of the screen (this is why parking the bar low made the bubble vanish on mobile).
  // `top` resolves against that same y=0 edge, which coincides with the viewport top, so it
  // stays correct everywhere. Sitting a panel ABOVE the bar therefore means computing
  // top = barY - (panel's own measured height) - gap, not anchoring its bottom.
  function positionPanels() {
    var size = barSize();
    var gap = 10;
    var above = ui.barY > window.innerHeight * 0.45;
    root.classList.toggle("is-panel-above", above);
    [bubbleEl, themeEl].forEach(function (el) {
      if (!el) return;
      var top;
      if (above) {
        // Measurable even while the panel is visibility:hidden (it still lays out), and its
        // height depends on content/width/max-height, not on where it's currently anchored.
        var h = el.getBoundingClientRect().height || 0;
        top = Math.max(8, ui.barY - h - gap);
      } else {
        top = Math.max(8, ui.barY + size.h + gap);
      }
      el.style.top = top + "px";
      el.style.bottom = "auto";
    });
  }

  function applyUi() {
    root.style.setProperty("--cr-accent", ui.accent);
    root.style.setProperty("--cr-accent-soft", hexToRgba(ui.accent, 0.16));
    root.style.setProperty("--cr-accent-text", contrastTextFor(ui.accent));
    root.style.setProperty("--cr-bg", ui.backdrop);
    // Panels are translucent over the chat. These are precomputed rather than written as
    // color-mix() so the bar still renders on WebViews without that CSS function.
    root.style.setProperty("--cr-veil", hexToRgba(ui.backdrop, 0.92));
    root.style.setProperty("--cr-veil-solid", hexToRgba(ui.backdrop, 0.96));
    root.style.setProperty("--cr-surface", hexToRgba(mixToward(ui.backdrop, 255, 0.07), 1));
    var tier = textTierFor(ui.backdrop);
    root.style.setProperty("--cr-text", tier.text);
    root.style.setProperty("--cr-muted", tier.muted);
    root.style.setProperty("--cr-faint", tier.faint);
    root.style.setProperty("--cr-hairline", tier.hairline);
    root.classList.toggle("is-open", ui.open && options.length > 0);
    clampBar();
    applyBarPosition();
    renderBadge();
  }

  function relativeLuminance(hex) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }

  // The Draw/Use/Enhance buttons paint solid --cr-accent behind their label, so the text
  // color has to react to whatever accent is picked, not assume a mid-tone. A pale cream
  // (e.g. #FDFBD4, luminance ~0.97) gets dark text and a deep/saturated accent gets light
  // text, regardless of preset swatch or custom hex.
  function contrastTextFor(hex) {
    if (!isHexColor(hex)) return "#14140f";
    return relativeLuminance(hex) > 0.6 ? "#14140f" : "#ffffff";
  }

  // --cr-text/--cr-muted/--cr-faint/--cr-hairline are body text and borders drawn on
  // surfaces derived from the BACKDROP (--cr-veil/--cr-veil-solid/--cr-surface), not the
  // accent - same problem as contrastTextFor above, one level down. They used to be fixed
  // "light text" values baked into the stylesheet, which is why a light custom backdrop
  // (e.g. the same #FDFBD4) still rendered body text in a fixed near-white color that
  // vanished against it. Two full tiers - one for dark backdrops, one for light - picked by
  // the same luminance threshold used for the accent.
  var TEXT_ON_DARK = { text: "#ece9e3", muted: "#a4a09a", faint: "#6f6c68", hairline: "rgba(255, 255, 255, 0.09)" };
  var TEXT_ON_LIGHT = { text: "#1c1a16", muted: "#5c564d", faint: "#8a8479", hairline: "rgba(0, 0, 0, 0.12)" };
  function textTierFor(hex) {
    if (!isHexColor(hex)) return TEXT_ON_DARK;
    return relativeLuminance(hex) > 0.6 ? TEXT_ON_LIGHT : TEXT_ON_DARK;
  }

  function hexToRgba(hex, alpha) {
    if (!isHexColor(hex)) return "rgba(23, 23, 26, " + alpha + ")";
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return "rgba(" + r + ", " + g + ", " + b + ", " + alpha + ")";
  }

  // Nudge a colour toward white (or black) so surfaces stay visible against any backdrop.
  function mixToward(hex, target, amount) {
    if (!isHexColor(hex)) return hex;
    var parts = [1, 3, 5].map(function (start) {
      var channel = parseInt(hex.slice(start, start + 2), 16);
      var mixed = Math.round(channel + (target - channel) * amount);
      return Math.min(255, Math.max(0, mixed)).toString(16).padStart(2, "0");
    });
    return "#" + parts.join("");
  }

  function openBar() {
    if (ui.open || !options.length) return;
    // Move clear of the right edge first, using the width the bar is about to become.
    clampBar(predictedOpenWidth());
    applyBarPosition();
    ui.open = true;
    applyUi();
    saveUi();
    // Settle against the real width once the slots have finished sliding out.
    setTimeout(function () { clampBar(); applyBarPosition(); }, 320);
  }

  // Slide the slots away, leaving the compact bar. Options are kept, not discarded.
  function closeBar() {
    if (!ui.open) return;
    ui.open = false;
    closing = true;
    closeBubble();
    setPanel(themeEl, false);
    applyUi();
    saveUi();
    // Let the slots finish retracting before the count appears, so the bar only ever
    // narrows during the slide instead of briefly widening as the badge pops in.
    setTimeout(function () {
      closing = false;
      clampBar();
      applyBarPosition();
      renderBadge();
    }, 310);
    announce("Options closed. " + unusedCount() + " still available.");
  }

  function unusedCount() {
    return options.filter(function (option) { return !usedIds[option.id]; }).length;
  }

  function renderBadge() {
    if (!badgeEl) return;
    var count = unusedCount();
    var show = !ui.open && !closing && count > 0;
    badgeEl.hidden = !show;
    badgeEl.textContent = String(count);
  }

  function renderTheme() {
    if (!themeBodyEl) return;
    var html = '<div class="cr__row"><span class="cr__row-label">Accent</span><div class="cr__swatches">';
    ACCENTS.forEach(function (color) {
      html += '<button class="cr__swatch' + (ui.accent === color ? " is-on" : "") + '" type="button" data-cr-accent="' +
        color + '" style="background:' + color + '" aria-label="Accent ' + color + '"></button>';
    });
    html += '<input class="cr__hex" data-cr-accent-hex type="text" value="' + escapeHtml(ui.accent) + '" aria-label="Custom accent hex" /></div></div>';

    html += '<div class="cr__row"><span class="cr__row-label">Backdrop</span><div class="cr__swatches">';
    BACKDROPS.forEach(function (color) {
      html += '<button class="cr__swatch' + (ui.backdrop === color ? " is-on" : "") + '" type="button" data-cr-backdrop="' +
        color + '" style="background:' + color + '" aria-label="Backdrop ' + color + '"></button>';
    });
    html += '<input class="cr__hex" data-cr-backdrop-hex type="text" value="' + escapeHtml(ui.backdrop) + '" aria-label="Custom backdrop hex" /></div></div>';

    html += '<div class="cr__row"><span class="cr__row-label">Placement</span>' +
      '<p class="cr__hint">Drag the bar itself to move it anywhere on screen. The arrow on its left shows or hides the options without losing them; Redraw always fetches a new set.</p></div>';
    themeBodyEl.innerHTML = html;
  }

  /* ---------- chat context ---------- */

  function messageText(message) {
    return message && typeof message.mes === "string" ? message.mes : "";
  }

  function isUserMessage(message) {
    return !!(message && message.is_user === true);
  }

  // ST doesn't have Tavo's generic "hidden" flag; is_system covers the equivalent cases
  // (author's note echoes, hidden slash-command output, etc.) that shouldn't read as a
  // real conversational turn.
  function isHiddenMessage(message) {
    return !!(message && message.is_system === true);
  }

  // message.name in ST IS the speaker's display name (unlike the Tavo host, where .name
  // was a message label such as "#0" and the real speaker lived in a separate field).
  function speakerFieldName(message) {
    return message && typeof message.name === "string" ? message.name.trim() : "";
  }

  function speakerName(message, ids) {
    if (isUserMessage(message)) return speakerFieldName(message) || ids.persona;
    return speakerFieldName(message) || (ids.cast.length ? ids.cast[0] : "Narrator");
  }

  // Inline images and stray carriage returns are noise in a prompt built for reasoning.
  function cleanForPrompt(text) {
    return String(text || "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\r/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  // A roleplay message ends on the beat the player must answer - the question asked, the
  // door closing, the hand extended. Cutting from the front destroys exactly that, so an
  // over-long message keeps its opening and its ending and elides the middle instead.
  function trimMessage(text, limit) {
    var value = String(text || "");
    if (value.length <= limit) return value;
    var head = Math.floor(limit * 0.3);
    var tail = limit - head - 24;
    return value.slice(0, head).trimEnd() + "\n[...]\n" + value.slice(value.length - tail).trimStart();
  }

  // Context is bounded by AI responses rather than raw message count, so a stretch of short
  // back-and-forth still reaches back the same distance in the story. Player turns that fall
  // inside that span come along, which keeps the exchange readable.
  async function recentMessages() {
    var context = Store.getContext();
    var chat = (context && Array.isArray(context.chat)) ? context.chat
      : (Store.scriptModule && Array.isArray(Store.scriptModule.chat) ? Store.scriptModule.chat : []);
    var all = chat.filter(function (m) {
      return !isHiddenMessage(m) && !!messageText(m).trim();
    });
    var characterPositions = [];
    for (var i = 0; i < all.length; i += 1) {
      if (!isUserMessage(all[i])) characterPositions.push(i);
    }
    if (characterPositions.length <= AI_RESPONSE_WINDOW) return all;
    return all.slice(characterPositions[characterPositions.length - AI_RESPONSE_WINDOW]);
  }

  // Pulls persona name/description and cast names/descriptions the same way Deep Story
  // Reforged's getCharacterLoreText() does: the active solo character, or every member of
  // the active group. Falls back to names actually seen speaking in the transcript when ST
  // has no persona/character selected yet (e.g. a brand new chat).
  async function identities(messages) {
    var context = Store.getContext();
    var persona = (context && typeof context.name1 === "string") ? context.name1.trim() : "";
    var cast = [];
    var cardNotes = [];

    try {
      var allChars = (context && context.characters) || [];
      var cards = [];
      if (context && context.groupId != null && Array.isArray(context.groups)) {
        var group = context.groups.find(function (g) { return g.id === context.groupId; });
        var memberFiles = (group && group.members) || [];
        memberFiles.forEach(function (fname) {
          var c = allChars.find(function (ch) { return ch.avatar === fname; });
          if (c) cards.push(c);
        });
      } else if (context && context.characterId != null && allChars[context.characterId]) {
        cards.push(allChars[context.characterId]);
      }
      cards.forEach(function (c) {
        var name = (c && c.name) ? String(c.name).trim() : "";
        if (name) cast.push(name);
        var described = c && typeof c.description === "string" ? c.description.trim() : "";
        if (described) cardNotes.push({ name: name || "Character", description: described });
      });
    } catch (_) {}

    if (!persona) {
      for (var i = messages.length - 1; i >= 0; i -= 1) {
        if (isUserMessage(messages[i])) { persona = speakerFieldName(messages[i]); if (persona) break; }
      }
    }
    if (!cast.length) {
      for (var j = messages.length - 1; j >= 0; j -= 1) {
        if (!isUserMessage(messages[j])) {
          var found = speakerFieldName(messages[j]);
          if (found && cast.indexOf(found) < 0) cast.push(found);
        }
      }
    }

    var personaDescription = "";
    try {
      if (Store.powerUser && typeof Store.powerUser.persona_description === "string") {
        personaDescription = Store.powerUser.persona_description.trim();
      }
    } catch (_) {}

    return { persona: persona || "the player", cast: cast, personaDescription: personaDescription, cardNotes: cardNotes };
  }

  /* ---------- prompt ---------- */

  function lengthGuidance(targetWords) {
    var target = Math.round(Number(targetWords) || 0);
    if (target > 0) {
      var tolerance = Math.max(8, Math.round(target * 0.12));
      var minimum = Math.max(12, target - tolerance);
      var maximum = target + tolerance;
      return "Keep this replacement about the same length as the option it replaces: " +
        minimum + " to " + maximum + " words, aiming for roughly " + target +
        ". Do not shrink it back to the default choice length.";
    }
    return "Each option is 25 to 60 words.";
  }

  function instruction() {
    var custom = String(cfg("systemPrompt", "") || "").trim();
    return custom || "Suggest what the player character could do or say next. Every option must be a genuinely different direction for the scene, not the same move reworded. Stay inside the established genre, tone, and continuity. Never narrate or speak for anyone except the player character.";
  }

  // The Choice instruction setting is free text a user can edit, and roleplay-adjacent apps
  // commonly use {{user}}/{{persona}}/{{char}}-style macros elsewhere, so someone typing one
  // here would reasonably expect it to resolve. Crossroads' generation call bypasses ST's own
  // prompt-time macro substitution (the prompt goes straight to Connection Manager or a raw
  // OpenAI-compatible endpoint, not through ST's chat-completion builder), so this
  // substitution is what actually makes it work.
  function substituteMacros(text, ids) {
    return String(text || "")
      .replace(/\{\{\s*user\s*\}\}/gi, ids.persona)
      .replace(/\{\{\s*persona\s*\}\}/gi, ids.persona)
      .replace(/\{\{\s*char(?:IfNotGroup)?\s*\}\}/gi, ids.cast.length ? ids.cast[0] : "the character");
  }

  // `avoid` carries the options the player is keeping, so a single-slot redraw returns
  // something genuinely new instead of a paraphrase of what is already on the bar.
  function buildPrompt(messages, count, avoid, ids, targetWords) {
    var player = ids.persona;
    var playerHasWritten = messages.some(isUserMessage);
    var planning = !!cfg("planningStep", true);

    var transcript = messages.map(function (m) {
      return speakerName(m, ids) + ": " + trimMessage(cleanForPrompt(messageText(m)), MAX_MESSAGE_CHARS);
    }).join("\n\n");

    var avoidBlock = "";
    if (Array.isArray(avoid) && avoid.length) {
      avoidBlock = "The player is already holding these directions and is keeping them. Your option must differ from every one of them in intent, not merely in wording:\n" +
        avoid.map(function (option, index) {
          return (index + 1) + ". [" + option.tone + "] " + option.label + " — " + cap(option.text, 240);
        }).join("\n");
    }

    var head = [
      "[OOC: You are Crossroads, a choice generator attached to a roleplay chat.",
      // Stated before the user's own instruction so the side of the scene being written is
      // never ambiguous, and cannot be edited away by accident in plugin settings.
      "You write ONLY the next turn for " + player + ", the human player's own character.",
      // A card can be a whole setting whose cast is introduced in the prose rather than in
      // chat.characters, so this is framed as "everyone who is not the player" instead of
      // naming a single opponent that may not exist.
      "Every other character in the scene belongs to the model, including any introduced in the story so far and any not named here. Never write, imply, or narrate their words, actions, thoughts, or reactions in any option.",
      "Each option is one turn taken by " + player + " and stops there. Do not continue the scene past it, do not resolve how anyone else responds, and do not address the reader.",
      "Two blocks follow. CHARACTER REFERENCE is background: who these people are, how they speak, and the world they live in. CURRENT SCENE is what is actually happening right now. Use the reference for voice and consistency, but your options must continue the CURRENT SCENE.",
      "Every option must follow directly from the FINAL line of the CURRENT SCENE. If a question was just asked of " + player + ", the options are answers to it. If something was just done to " + player + ", the options are reactions to it.",
      // Roleplay prose freely mixes omniscient narration and private interior monologue.
      // The model can see a character's secret; the player character cannot, and options
      // that react to an unshared secret read as nonsense.
      "The scene mixes narration with other characters' private thoughts, often in *italics*, and the reference may describe secrets too. " + player + " knows none of it. Never write an option in which " + player + " reacts to, references, or guesses information they were never actually told or shown aloud.",
      instruction(),
      lengthGuidance(targetWords)
    ];
    head.push("Return ONLY a valid JSON object. No commentary, no markdown fences.");
    // Planning field: a place for the model to reason before committing to options. Thinking
    // models already reason out of band and this is parsed out and discarded (parseOptions
    // reads only .options), so their output is unchanged; fast / non-thinking models, which
    // otherwise have no room to think under the "only JSON" rule, use it to keep the options
    // genuinely distinct instead of collapsing toward one move. Off = the original minimal
    // shape (see the Planning step setting).
    if (planning) {
      head.push('Shape: {"plan":"one short line naming each option\'s distinct approach","options":[{"tone":"bold","label":"three to five word summary","text":"what ' + player + ' does or says"}]}');
      head.push('Fill "plan" FIRST: in a few words per option, name the distinct tactic each one takes (e.g. "1 accept openly, 2 deflect with humor, 3 push back, 4 change the subject") so no two options collapse into the same move. Then write "options" to follow that plan. "plan" is scratch space that is discarded, so keep it to one short line.');
    } else {
      head.push('Shape: {"options":[{"tone":"bold","label":"three to five word summary","text":"what ' + player + ' does or says"}]}');
    }
    head.push(count === 1
      ? "Return exactly 1 option, as a single entry in the options array."
      : "Return exactly " + count + " options, ordered from most direct to most unexpected.");
    head.push("tone must be exactly one of: " + Object.keys(TONES).join(", ") + ".");
    if (count !== 1) head.push("Vary the tone values; do not repeat the same tone twice unless the scene genuinely allows nothing else.");
    head.push(playerHasWritten
      ? 'Write each "text" as ' + player + "'s own turn, matching the voice, tense, and formatting the player has already been using."
      : 'The player has not written a turn yet, so there is no sample of their voice. Write each "text" as ' + player + "'s own turn in a natural, simple voice. Do not imitate the narration style of the scene text, and do not open by describing the other characters.");
    head.push("]");

    // Each block says what it is for. Without that the card reads as if it were happening
    // now, and the model answers the character's backstory instead of the live scene.
    var castBlock = "";
    var castLines = [];
    if (ids.personaDescription) {
      castLines.push(player + " (the player's character - you write only for this one): " + cap(cleanForPrompt(ids.personaDescription), MAX_CARD_CHARS));
    }
    (ids.cardNotes || []).forEach(function (note) {
      castLines.push(note.name + " (belongs to the model - never write for them): " + cap(cleanForPrompt(note.description), MAX_CARD_CHARS));
    });
    if (castLines.length) {
      castBlock = "CHARACTER REFERENCE - background only, for voice, personality and world consistency. This is NOT the current situation and may describe things " +
        player + " has never learned:\n" + castLines.join("\n\n");
    }

    var fallbackChat = "No readable messages yet. Offer opening moves that fit a brand new scene.";
    var chatHeader = "CURRENT SCENE - the last " + AI_RESPONSE_WINDOW + " responses and the live situation. This is what your options must continue. Lines marked " +
      player + " are the player's own turns; every other line belongs to the model:\n";
    var closer = "Now write " + (count === 1 ? "the option" : "the " + count + " options") + " as " + player +
      "'s very next turn, continuing directly from the final line of the CURRENT SCENE above.";
    var sections = [head.join("\n")];
    if (castBlock) sections.push(castBlock);
    if (avoidBlock) sections.push(avoidBlock);
    sections.push(chatHeader + (transcript || fallbackChat));
    sections.push(closer);

    var prompt = sections.join("\n\n");
    if (prompt.length > MAX_PROMPT_CHARS && transcript) {
      var overflow = prompt.length - MAX_PROMPT_CHARS;
      sections[sections.length - 2] = chatHeader + "…" + transcript.slice(overflow + 60);
      prompt = sections.join("\n\n");
    }
    // Catches any {{user}}/{{persona}}/{{char}} a custom Choice instruction might contain.
    // Nothing else in the assembled prompt uses macro syntax, so this is a no-op elsewhere.
    return substituteMacros(prompt, ids);
  }

  function generationText(result) {
    return typeof result === "string" ? result : "";
  }

  // Prose counterpart of the options "plan" field: the expand/enhance paths must return raw
  // prose (no JSON to hide a field in), so a fast / non-thinking model is instead invited to
  // think inside a leading <plan>...</plan> block that stripLeadingPlan() removes before the
  // text is shown. Empty when the Planning step is off, so those prompts stay untouched.
  function planLine() {
    if (!cfg("planningStep", true)) return "";
    return "If it helps, you MAY think first inside a single leading <plan>...</plan> block and write nothing else before it; put the finished roleplay prose after </plan>. The plan is discarded.";
  }

  // Removes one leading <plan>...</plan> block if the model used the optional planning
  // scaffold above. Never returns empty: if stripping would leave nothing (model put the
  // whole answer inside the tag), the original text is kept so a real reply is never lost.
  // A no-op when no such block is present, so it's safe to run unconditionally.
  function stripLeadingPlan(text) {
    var m = text.match(/^\s*<plan>[\s\S]*?<\/plan>\s*/i);
    if (m) {
      var rest = text.slice(m[0].length).trim();
      if (rest) return rest;
    }
    return text;
  }

  function buildExpandPrompt(option, ids) {
    var player = ids.persona;
    var originalWords = Math.max(1, wordCount(option.text));
    var targetWords = Math.min(700, Math.max(originalWords + 35, Math.round(originalWords * 2)));
    var minimum = Math.max(originalWords + 10, Math.round(targetWords * 0.84));
    var maximum = Math.max(minimum + 12, Math.round(targetWords * 1.16));
    var others = ids.cast.length ? ids.cast.join(", ") : "every character other than " + player;

    var rules = [
      "[OOC: Expand the candidate roleplay turn below into a fuller, polished message for " + player + ".",
      "Preserve its core intent, decisions, point of view, tense, voice, and any existing dialogue. Enrich it with fitting detail, pacing, physicality, sensory texture, or interiority; do not replace it with a different choice.",
      "This is still ONE turn by " + player + ". You may continue and elaborate what " + player + " does, says, notices, or thinks, but never write dialogue, actions, thoughts, decisions, or reactions for " + others + ". Stop before anyone else responds.",
      "Use the live chat only for continuity. Never let " + player + " act on private narration, thoughts, secrets, or other information they have not actually learned.",
      "Make the result clearly longer than the source. Aim for " + minimum + " to " + maximum + " words.",
      "Return only the final expanded roleplay prose. No analysis, labels, OOC wrapper, quotation marks around the whole response, or markdown fence."
    ];
    var plan = planLine();
    if (plan) rules.push(plan);
    rules.push("]");

    return rules.join("\n") + "\n\nCANDIDATE TURN TO EXPAND — written only for " +
      player + ":\n" + option.text;
  }

  // Bubble-native adaptation of the same "one source draft, one per-use OOC instruction"
  // pattern the Tavo build used. Unlike Expand, this path does not impose a length change;
  // the user's instruction controls the rewrite.
  function buildCustomEnhancePrompt(option, ooc, ids) {
    var player = ids.persona;
    var others = ids.cast.length ? ids.cast.join(", ") : "every character other than " + player;
    var custom = cap(String(ooc || "").trim(), MAX_ENHANCE_OOC_CHARS);
    if (!custom) throw new Error("Add a custom OOC enhancement instruction first.");

    var rules = [
      "[OOC: Revise the candidate roleplay turn below by following the CUSTOM ENHANCEMENT INSTRUCTION.",
      "That custom instruction controls what changes, including style, focus, content, and length. Do not automatically lengthen the message unless the instruction asks you to expand it.",
      "The result must remain ONE turn written only for " + player + ". Never add dialogue, actions, thoughts, decisions, or reactions for " + others + ". Stop before anyone else responds.",
      "Use the live chat only for continuity. Never let " + player + " act on private narration, thoughts, secrets, or other information they have not actually learned.",
      "Return only the revised roleplay prose. No analysis, labels, OOC wrapper, quotation marks around the whole response, or markdown fence."
    ];
    var plan = planLine();
    if (plan) rules.push(plan);
    rules.push("]");

    return [
      rules.join("\n"),
      "CUSTOM ENHANCEMENT INSTRUCTION — applies only to this wand action:\n" + custom,
      "CANDIDATE TURN TO ENHANCE — written only for " + player + ":\n" + option.text
    ].join("\n\n");
  }

  function parseProseText(result) {
    var text = generationText(result).trim();
    if (!text) throw new Error("The model returned an empty response.");
    text = text.replace(/^```(?:\w+)?\s*/i, "").replace(/\s*```$/i, "").trim();
    text = stripLeadingPlan(text);
    if (!text) throw new Error("The model returned no usable prose.");
    return cap(text, MAX_OPTION_CHARS);
  }

  function parseOptions(result, count) {
    var text = generationText(result).trim();
    if (!text) throw new Error("The model returned an empty response.");
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    var first = text.indexOf("{");
    var last = text.lastIndexOf("}");
    if (first < 0 || last <= first) throw new Error("The model did not return a JSON object.");
    var data;
    try { data = JSON.parse(text.slice(first, last + 1)); } catch (_) {
      throw new Error("The model returned invalid JSON.");
    }
    var list = Array.isArray(data && data.options) ? data.options : [];
    var stamp = Date.now();
    var cleaned = list.map(function (item, index) {
      if (!item || typeof item !== "object") return null;
      var body = cap(String(item.text || "").trim(), MAX_OPTION_CHARS);
      if (!body) return null;
      var tone = String(item.tone || "").trim().toLowerCase();
      if (!TONES[tone]) tone = FALLBACK_TONE;
      return {
        id: "opt-" + stamp + "-" + index + "-" + Math.floor(Math.random() * 1000),
        tone: tone,
        label: cap(String(item.label || "").trim(), 60) || toneLabel(tone) + " move",
        text: body
      };
    }).filter(Boolean).slice(0, count);
    if (!cleaned.length) throw new Error("The model returned no usable options.");
    return cleaned;
  }

  /* ---------- draw ---------- */

  // Crossroads is a floating overlay that stays on screen even on the welcome
  // screen, but every action needs a real chat: Draw reads the persona/
  // character/transcript and writes the drawn set into chat_metadata, and the
  // bubble actions edit that same per-chat draw. With no chat open there is
  // nothing to read and writeDraw() silently refuses to persist, so each entry
  // point below bails early through this guard, and syncChatState() greys the
  // Draw button so it's visibly unavailable rather than a dead press.
  function chatOpen() { return Store.isChatOpen(); }

  function syncChatState() {
    var open = chatOpen();
    if (drawBtn) {
      drawBtn.disabled = busy || !open;
      drawBtn.title = open ? "" : "Open a chat before drawing options";
    }
  }

  function setBusy(next, mode) {
    busy = next;
    if (drawBtn) drawBtn.disabled = next || !chatOpen();
    if (useBtn) useBtn.disabled = next;
    if (bubbleRedrawBtn) bubbleRedrawBtn.disabled = next;
    if (expandBtn) {
      expandBtn.disabled = next;
      expandBtn.classList.toggle("is-busy", next && mode === "expand");
    }
    if (enhanceOocToggleBtn) {
      enhanceOocToggleBtn.disabled = next;
      enhanceOocToggleBtn.classList.toggle("is-busy", next && mode === "enhance");
    }
    if (enhanceOocEl) enhanceOocEl.disabled = next;
    syncEnhanceControls();
    var transforming = next && (mode === "expand" || mode === "enhance");
    if (bubbleEl) bubbleEl.classList.toggle("is-enhancing", transforming);
    if (bubbleBodyEl) bubbleBodyEl.setAttribute("aria-busy", transforming ? "true" : "false");
    if (sweepEl) sweepEl.hidden = !next;
    if (drawTextEl) {
      var label = mode === "expand" ? "Expanding" :
        (mode === "enhance" ? "Enhancing" : (mode === "redraw" ? "Redrawing" : "Drawing"));
      drawTextEl.textContent = next ? label : (options.length ? "Redraw" : "Draw");
    }
  }

  async function draw() {
    if (busy) return;
    if (!chatOpen()) { toast("Open a chat before drawing options."); announce("No chat selected."); return; }
    setBusy(true, "draw");
    closeBubble();
    announce("Drawing new options.");
    try {
      var messages = await recentMessages();
      var ids = await identities(messages);
      var raw = await Connection.generate(buildPrompt(messages, OPTION_COUNT, null, ids));
      options = parseOptions(raw, OPTION_COUNT);
      usedIds = Object.create(null);
      await persistDraw();
      // A bubble opened from the previous set while this draw was in flight would now be
      // showing old text against a new options array, so "Use this" would send the wrong
      // one. Closing here rebinds the bar to the set that actually landed.
      closeBubble();
      // Same right-edge guard as openBar: shift left before the slots widen the bar.
      clampBar(predictedOpenWidth());
      applyBarPosition();
      ui.open = true;
      applyUi();
      saveUi();
      setTimeout(function () { clampBar(); applyBarPosition(); }, 320);
      announce(options.length + " options ready.");
    } catch (error) {
      var message = (error && error.message) ? String(error.message) : "Crossroads could not draw options.";
      toast(cap(message, 220));
      announce("Draw failed.");
    } finally {
      setBusy(false);
      renderBadge();
    }
  }

  // Replace a single slot, keeping the rest of the set intact.
  async function redrawOne(index) {
    if (busy) return;
    if (!chatOpen()) { toast("Open a chat before redrawing options."); announce("No chat selected."); return; }
    var target = options[index];
    if (!target) return;
    setBusy(true, "redraw");
    announce("Redrawing this option.");
    try {
      var messages = await recentMessages();
      var ids = await identities(messages);
      var keeping = options.filter(function (_, i) { return i !== index; });
      var raw = await Connection.generate(buildPrompt(messages, 1, keeping, ids, wordCount(target.text)));
      var replacement = parseOptions(raw, 1)[0];
      delete usedIds[target.id];
      options[index] = replacement;
      await persistDraw();
      if (openIndex === index) openBubble(index);
      else renderSlots();
      announce("Option replaced.");
    } catch (error) {
      var message = (error && error.message) ? String(error.message) : "Crossroads could not redraw that option.";
      toast(cap(message, 220));
      announce("Redraw failed.");
    } finally {
      setBusy(false);
      renderBadge();
    }
  }

  async function transformOption(index, mode) {
    if (busy) return;
    if (!chatOpen()) { toast("Open a chat before enhancing options."); announce("No chat selected."); return; }
    var target = options[index];
    if (!target) return;
    var enhancing = mode === "enhance";
    var customOoc = enhancing && enhanceOocEl ? enhanceOocEl.value.trim() : "";
    if (enhancing && !customOoc) {
      setEnhancePrompt(true);
      announce("Add a custom enhancement instruction first.");
      return;
    }
    var targetId = target.id;
    var beforeWords = wordCount(target.text);
    setBusy(true, mode);
    announce(enhancing ? "Enhancing this option with the custom OOC instruction." : "Expanding this option.");
    try {
      var messages = await recentMessages();
      var ids = await identities(messages);
      var prompt = enhancing
        ? buildCustomEnhancePrompt(target, customOoc, ids)
        : buildExpandPrompt(target, ids);
      var raw = await Connection.generate(prompt);
      var transformed = parseProseText(raw);

      // A chat switch can happen while generation is in flight. Never let the result from
      // the old chat overwrite an option that merely occupies the same slot in the new one.
      if (!options[index] || options[index].id !== targetId) {
        announce("Expansion discarded because the chat changed.");
        return;
      }

      options[index].text = transformed;
      delete usedIds[targetId];
      await persistDraw();
      if (openIndex === index) openBubble(index);
      var afterWords = wordCount(transformed);
      announce(enhancing
        ? "Option enhanced with the custom OOC instruction."
        : "Option expanded from " + beforeWords + " to " + afterWords + " words.");
    } catch (error) {
      var fallback = enhancing
        ? "Crossroads could not enhance that option."
        : "Crossroads could not expand that option.";
      var message = (error && error.message) ? String(error.message) : fallback;
      toast(cap(message, 220));
      announce(enhancing ? "Enhancement failed." : "Expansion failed.");
    } finally {
      setBusy(false);
      renderBadge();
    }
  }

  function expandOption(index) { return transformOption(index, "expand"); }
  function enhanceOption(index) { return transformOption(index, "enhance"); }

  async function persistDraw() {
    await Store.writeDraw({ at: new Date().toISOString(), options: options, used: Object.keys(usedIds) });
    renderSlots();
  }

  function restoreDraw() {
    var saved = Store.readDraw();
    if (!saved || !Array.isArray(saved.options)) return;
    options = saved.options.filter(function (item) {
      return item && typeof item === "object" && typeof item.text === "string" && item.text.trim();
    }).map(function (item, index) {
      return {
        id: String(item.id || "opt-restored-" + index),
        tone: TONES[item.tone] ? item.tone : FALLBACK_TONE,
        label: cap(String(item.label || ""), 60) || "Option " + (index + 1),
        text: cap(String(item.text), MAX_OPTION_CHARS)
      };
    });
    (Array.isArray(saved.used) ? saved.used : []).forEach(function (id) { usedIds[id] = true; });
  }

  /* ---------- render ---------- */

  function renderSlots() {
    if (!slotsEl) return;
    slotsEl.innerHTML = options.map(function (option, index) {
      var used = usedIds[option.id] ? " is-used" : "";
      var active = index === openIndex ? " is-active" : "";
      return '<button class="cr__slot' + used + active + '" type="button" data-cr-slot="' + index + '" ' +
        'title="' + escapeHtml(option.label) + '" aria-label="' + escapeHtml(toneLabel(option.tone) + ": " + option.label) + '">' +
        toneIcon(option.tone) + '<span class="cr__slot-dot"></span></button>';
    }).join("");
    if (drawTextEl && !busy) drawTextEl.textContent = options.length ? "Redraw" : "Draw";
    if (toggleEl) {
      toggleEl.disabled = options.length === 0;
      toggleEl.setAttribute("aria-expanded", ui.open && options.length ? "true" : "false");
    }
    root.classList.toggle("is-open", ui.open && options.length > 0);
    renderBadge();
  }

  function openBubble(index) {
    var option = options[index];
    if (!option) return;
    openIndex = index;
    setPanel(themeEl, false);
    if (bubbleIconEl) bubbleIconEl.innerHTML = toneIcon(option.tone);
    if (bubbleLabelEl) bubbleLabelEl.textContent = toneLabel(option.tone) + " · " + option.label;
    if (bubbleBodyEl) bubbleBodyEl.textContent = option.text;
    positionPanels();
    setPanel(bubbleEl, true);
    renderSlots();
    announce(toneLabel(option.tone) + " option open.");
  }

  function closeBubble() {
    openIndex = -1;
    setEnhancePrompt(false);
    setPanel(bubbleEl, false);
    renderSlots();
  }

  // Writes straight into ST's compose textarea, the same way other extensions (e.g.
  // Triggeryze's injectToInput) hand text to the user without sending it: set .value, then
  // dispatch a real "input" event so ST's own listeners (char counter, autosize) pick it up.
  function setInputText(text) {
    var el = document.getElementById("send_textarea");
    if (!el) throw new Error("Input box not found.");
    el.value = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async function useOption() {
    var option = options[openIndex];
    if (!option) return;
    if (!chatOpen()) { toast("Open a chat before using an option."); announce("No chat selected."); return; }
    try {
      setInputText(option.text);
      usedIds[option.id] = true;
      await persistDraw();
      closeBubble();
      announce("Option placed in the input box.");
    } catch (_) {
      toast("Crossroads could not write to the input box.");
    }
  }

  /* ---------- events ---------- */

  root.addEventListener("click", function (event) {
    // A drag that finishes over a control still fires a click; ignore that one. The window
    // only needs to cover the click the browser emits right after pointerup, so keep it
    // short enough that a deliberate tap straight after repositioning still registers.
    if (Date.now() - dragEndedAt < 150) return;

    if (event.target.closest("[data-cr-toggle]")) {
      if (!options.length) return;
      if (ui.open) closeBar();
      else openBar();
      return;
    }

    var slot = event.target.closest("[data-cr-slot]");
    if (slot) {
      // Ignore slots mid-draw: they still show the outgoing set and are about to be replaced.
      if (busy) return;
      var index = Number(slot.getAttribute("data-cr-slot"));
      if (index === openIndex) closeBubble();
      else openBubble(index);
      return;
    }
    // Draw always generates. Reopening an existing set is the toggle's job, so pressing
    // this never silently gives back the old options instead of new ones.
    if (event.target.closest("[data-cr-draw]")) { draw(); return; }
    if (event.target.closest("[data-cr-expand]")) { expandOption(openIndex); return; }
    if (event.target.closest("[data-cr-enhance]")) { enhanceOption(openIndex); return; }
    if (event.target.closest("[data-cr-ooc-toggle]")) {
      setEnhancePrompt(!enhancePromptOpen());
      positionPanels();
      return;
    }
    if (event.target.closest("[data-cr-bubble-redraw]")) { redrawOne(openIndex); return; }
    if (event.target.closest("[data-cr-use]")) { useOption(); return; }
    if (event.target.closest("[data-cr-bubble-close]")) { closeBubble(); return; }
    if (event.target.closest("[data-cr-palette]")) {
      var showing = !panelOpen(themeEl);
      if (showing) { closeBubble(); renderTheme(); positionPanels(); }
      setPanel(themeEl, showing);
      return;
    }
    if (event.target.closest("[data-cr-theme-close]")) { setPanel(themeEl, false); return; }

    var accent = event.target.closest("[data-cr-accent]");
    if (accent) { ui.accent = accent.getAttribute("data-cr-accent"); applyUi(); saveUi(); renderTheme(); return; }
    var backdrop = event.target.closest("[data-cr-backdrop]");
    if (backdrop) { ui.backdrop = backdrop.getAttribute("data-cr-backdrop"); applyUi(); saveUi(); renderTheme(); return; }
  });

  root.addEventListener("input", function (event) {
    if (event.target.closest("[data-cr-enhance-ooc]")) syncEnhanceControls();
  });

  root.addEventListener("change", function (event) {
    var accentHex = event.target.closest("[data-cr-accent-hex]");
    if (accentHex) {
      if (isHexColor(accentHex.value)) { ui.accent = accentHex.value; applyUi(); saveUi(); }
      renderTheme();
      return;
    }
    var backdropHex = event.target.closest("[data-cr-backdrop-hex]");
    if (backdropHex) {
      if (isHexColor(backdropHex.value)) { ui.backdrop = backdropHex.value; applyUi(); saveUi(); }
      renderTheme();
    }
  });

  // The whole bar is the drag handle, so there is no gesture that both moves and closes.
  // A press only becomes a drag once it passes DRAG_START_PX; below that it stays a tap and
  // the button under the finger receives its normal click.
  (function enableBarDrag() {
    if (!barEl) return;
    var dragging = false;
    var moved = false;
    var captured = false;
    var startX = 0;
    var startY = 0;
    var originX = 0;
    var originY = 0;
    var threshold = DRAG_START_PX;

    barEl.addEventListener("pointerdown", function (event) {
      if (event.button != null && event.button !== 0) return;
      dragging = true;
      moved = false;
      startX = event.clientX;
      startY = event.clientY;
      originX = ui.barX;
      originY = ui.barY;
      threshold = event.pointerType === "touch" ? DRAG_START_PX_TOUCH : DRAG_START_PX;
      // Deliberately NOT capturing the pointer yet. Chrome retargets the follow-up
      // `click` event to whichever element holds pointer capture, so capturing here
      // (on every press, before the drag threshold) made every click on Draw / the
      // slots / the palette arrive at the bar itself instead of the button pressed.
      // The delegated handler resolves controls with event.target.closest(), which
      // only walks UPWARD - and those buttons are descendants of the bar, never
      // ancestors - so nothing matched and every button silently did nothing.
      // Capture is taken in pointermove instead, the moment this stops being a tap.
    });

    barEl.addEventListener("pointermove", function (event) {
      if (!dragging) return;
      var dx = event.clientX - startX;
      var dy = event.clientY - startY;
      if (!moved) {
        if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;
        moved = true;
        barEl.classList.add("is-dragging");
        // Now that it IS a drag, capture so the pointer can leave the bar without
        // dropping it. Retargeting the resulting click is fine (and wanted) here:
        // endDrag stamps dragEndedAt, which the click handler swallows anyway.
        try { barEl.setPointerCapture(event.pointerId); captured = true; } catch (_) {}
      }
      ui.barX = originX + dx;
      ui.barY = originY + dy;
      clampBar();
      applyBarPosition();
    });

    function endDrag(event) {
      if (!dragging) return;
      dragging = false;
      if (captured) {
        try { barEl.releasePointerCapture(event.pointerId); } catch (_) {}
        captured = false;
      }
      if (!moved) return;
      barEl.classList.remove("is-dragging");
      // Swallow the click this drag is about to produce so releasing over a button
      // does not also trigger it.
      dragEndedAt = Date.now();
      saveUi();
    }
    barEl.addEventListener("pointerup", endDrag);
    barEl.addEventListener("pointercancel", endDrag);
  })();

  window.addEventListener("resize", function () { clampBar(); applyBarPosition(); });

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    if (panelOpen(bubbleEl) && enhancePromptOpen()) setEnhancePrompt(false);
    else if (panelOpen(bubbleEl)) closeBubble();
    else if (panelOpen(themeEl)) setPanel(themeEl, false);
    else if (ui.open) closeBar();
  });

  /* ---------- boot ---------- */

  loadUi();
  restoreDraw();
  applyUi();
  renderSlots();
  setBusy(false);
  syncChatState();
  // The bar's width is only known once it has laid out, so settle its position after paint,
  // then reveal it. Showing it earlier would flash it at an unpositioned spot.
  setTimeout(function () {
    clampBar();
    applyBarPosition();
    if (Store.settings ? Store.settings.showBar !== false : true) root.hidden = false;
  }, 60);

  try {
    var es = Store.scriptModule && Store.scriptModule.eventSource;
    var et = Store.scriptModule && Store.scriptModule.event_types;
    if (es && et && et.CHAT_CHANGED) {
      es.on(et.CHAT_CHANGED, function () {
        options = [];
        usedIds = Object.create(null);
        restoreDraw();
        closeBubble();
        applyUi();
        renderSlots();
        syncChatState();
      });
    }
  } catch (_) {}
}

// Lets index.js's settings-panel "Show the Crossroads bar" toggle take effect immediately
// instead of only on next reload.
export function setBarVisible(visible) {
  var root = document.querySelector("[data-cr-root]");
  if (root) root.hidden = !visible;
}
