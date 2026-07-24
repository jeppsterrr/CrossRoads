/*
 * Crossroads — SillyTavern Extension
 * Choose-your-own-adventure prompt bar. Draw four distinct directions, preview
 * and expand any option, or custom-enhance it with an OOC instruction before
 * sending it to the input box. Ported from the Tavo plugin of the same name
 * (com.jeppsterrr.crossroads) — see panel.js for the ported bar itself.
 *
 * This file is a classic (non-module) script — SillyTavern loads it directly,
 * not as type="module" — so it can't use static `import`. store.js/
 * connection.js/panel.js are real ES modules, reached via dynamic import()
 * below (same technique Deep Story Reforged uses for the same reason). This
 * file itself only does three things: bootstrap those modules with ST's
 * handles, mount the bar's markup into the page, and build the Extensions-
 * panel settings drawer.
 */

var Store, Connection, Panel;

var SETTINGS_HTML = `
<div class="inline-drawer">
  <div class="inline-drawer-toggle inline-drawer-header">
    <b><i class="fa-solid fa-shuffle"></i> Crossroads</b>
    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
  </div>
  <div class="inline-drawer-content">
    <div class="cr-settings-row">
      <label class="checkbox_label"><input type="checkbox" id="cr-s-show"><span>Show the Crossroads bar</span></label>
    </div>

    <div class="cr-settings-row">
      <label for="cr-s-prompt">Choice instruction</label>
      <textarea id="cr-s-prompt" class="text_pole" placeholder="Suggest what the player character could do or say next. Every option must be a genuinely different direction for the scene..."></textarea>
      <p class="cr-settings-hint">Rewrite this to change what kind of options you get — darker, funnier, always dialogue, always physical action, more cautious, whatever suits the story. Leave blank to use the built-in default. Crossroads always adds its own rules on top, so options stay in the player's voice and never speak for anyone else.</p>
    </div>

    <div class="cr-settings-row">
      <label for="cr-s-context">Scene context: recent responses to send</label>
      <input type="number" id="cr-s-context" class="text_pole" min="1" max="10" step="1">
      <p class="cr-settings-hint">How many of the character's most recent replies Crossroads reads as the live scene. Your own turns in between are always included, and each one is tagged so the model can study your voice and write options that sound like you. Default 2, max 10 — raising it gives deeper context but costs proportionally more tokens on every draw.</p>
    </div>

    <div class="cr-settings-row">
      <label class="checkbox_label"><input type="checkbox" id="cr-s-planning"><span>Planning step (helps fast / non-thinking models)</span></label>
      <p class="cr-settings-hint">Gives the model a short scratch space to plan before it answers, which is discarded before anything is shown. Recommended when Crossroads points at a fast or non-thinking model (e.g. a Flash variant), where it keeps the four options genuinely distinct instead of near-duplicates. Thinking models already reason on their own, so their output is unchanged either way; turn this off if you want Crossroads to send the leanest possible prompt.</p>
    </div>

    <hr>
    <div class="cr-settings-row">
      <label for="cr-s-source">Generation source</label>
      <select id="cr-s-source" class="text_pole">
        <option value="profile">Connection Manager profile</option>
        <option value="openai">OpenAI-compatible endpoint</option>
      </select>
      <p class="cr-settings-hint">Crossroads always generates quietly in the background — either path leaves the chat's active connection and history untouched.</p>
    </div>

    <div class="cr-settings-row" id="cr-s-profile-row">
      <label for="cr-s-profile">Connection profile</label>
      <select id="cr-s-profile" class="text_pole"></select>
      <p class="cr-settings-hint">Sent via ST's Connection Manager. Requires the Connection Manager extension and at least one saved profile.</p>
    </div>

    <div class="cr-settings-row" id="cr-s-openai-row">
      <label for="cr-s-openai-url">OpenAI-compatible URL</label>
      <input type="text" id="cr-s-openai-url" class="text_pole" placeholder="http://localhost:5001/v1 or https://api.example.com/v1">
      <label for="cr-s-openai-key">API key (optional)</label>
      <input type="password" id="cr-s-openai-key" class="text_pole" placeholder="Leave blank if the endpoint needs none">
      <label for="cr-s-openai-model">Model</label>
      <input type="text" id="cr-s-openai-model" class="text_pole" placeholder="Model name the endpoint expects">
      <label for="cr-s-openai-maxtokens">Max tokens (optional)</label>
      <input type="number" id="cr-s-openai-maxtokens" class="text_pole" min="0" step="1" placeholder="0 = provider default">
      <label for="cr-s-openai-temp">Temperature</label>
      <input type="number" id="cr-s-openai-temp" class="text_pole" min="0" max="2" step="0.05" placeholder="0.9">
      <p class="cr-settings-hint">Temperature is the most direct lever on how different the four options are from each other: raise it for wilder variety, lower it for safer, more grounded choices. Default 0.9. (Connection Manager profiles use their own preset's sampler instead.)</p>
      <p class="cr-settings-hint">Local endpoints (koboldcpp, text-generation-webui, LM Studio, ...) are tried through ST's CORS proxy first, then directly if the proxy is disabled. The API key above is stored in SillyTavern's settings file in plain text, so take the same care with it you would with any other key kept there.</p>
    </div>
  </div>
</div>
`;

jQuery(async function () {
    try {
        Store = await import("./store.js");
        Connection = await import("./connection.js");
        Panel = await import("./panel.js");

        var extMod = await import("../../../extensions.js");
        var scriptModule = await import("../../../../script.js");
        var puMod = await import("../../../power-user.js");

        Store.setBootstrap({
            extSettings: extMod.extension_settings,
            saveFn: extMod.saveSettingsDebounced,
            scriptModule: scriptModule,
            powerUser: puMod.power_user
        });

        Store.loadSettings();

        document.body.insertAdjacentHTML("beforeend", Panel.BAR_HTML);
        Panel.init();

        buildSettingsPanel();

        console.log("[Crossroads] Loaded!");
    } catch (e) {
        console.error("[Crossroads] Init error:", e);
    }
});

function buildSettingsPanel() {
    var $container = $("#extensions_settings2");
    if (!$container.length) $container = $("#extensions_settings");
    if (!$container.length) return;
    $container.append(SETTINGS_HTML);

    var s = Store.settings;
    $("#cr-s-show").prop("checked", s.showBar !== false);
    $("#cr-s-planning").prop("checked", s.planningStep !== false);
    $("#cr-s-context").val(s.contextResponses || 2);
    $("#cr-s-prompt").val(s.systemPrompt || "");
    $("#cr-s-source").val(s.connectionSource || "profile");
    $("#cr-s-openai-url").val(s.openaiUrl || "");
    $("#cr-s-openai-key").val(s.openaiKey || "");
    $("#cr-s-openai-model").val(s.openaiModel || "");
    $("#cr-s-openai-maxtokens").val(s.openaiMaxTokens || "");
    $("#cr-s-openai-temp").val(s.openaiTemperature == null ? 0.9 : s.openaiTemperature);

    Connection.populateProfileDropdown(document.getElementById("cr-s-profile"), s.connectionProfileId);

    function updateSourceVisibility() {
        var source = $("#cr-s-source").val();
        $("#cr-s-profile-row").toggle(source === "profile");
        $("#cr-s-openai-row").toggle(source === "openai");
    }
    updateSourceVisibility();

    $("#cr-s-show").on("change", function () {
        Store.settings.showBar = $(this).prop("checked");
        Store.save();
        Panel.setBarVisible(Store.settings.showBar);
    });
    $("#cr-s-planning").on("change", function () {
        Store.settings.planningStep = $(this).prop("checked");
        Store.save();
    });
    // Clamped on write as well as on read (panel.js's responseWindow), since a number input
    // still accepts out-of-range values typed directly rather than via its spinner.
    $("#cr-s-context").on("change", function () {
        var n = Math.round(Number($(this).val()));
        if (!Number.isFinite(n)) n = 2;
        n = Math.min(10, Math.max(1, n));
        Store.settings.contextResponses = n;
        $(this).val(n);
        Store.save();
    });
    $("#cr-s-prompt").on("input", function () {
        Store.settings.systemPrompt = $(this).val();
        Store.save();
    });
    $("#cr-s-source").on("change", function () {
        Store.settings.connectionSource = $(this).val();
        Store.save();
        updateSourceVisibility();
    });
    $("#cr-s-profile").on("change", function () {
        Store.settings.connectionProfileId = $(this).val();
        Store.save();
    });
    $("#cr-s-openai-url").on("input", function () {
        Store.settings.openaiUrl = $(this).val();
        Store.save();
    });
    $("#cr-s-openai-key").on("input", function () {
        Store.settings.openaiKey = $(this).val();
        Store.save();
    });
    $("#cr-s-openai-model").on("input", function () {
        Store.settings.openaiModel = $(this).val();
        Store.save();
    });
    $("#cr-s-openai-maxtokens").on("input", function () {
        Store.settings.openaiMaxTokens = Number($(this).val()) || 0;
        Store.save();
    });
    $("#cr-s-openai-temp").on("change", function () {
        var t = Number($(this).val());
        if (!Number.isFinite(t)) t = 0.9;
        t = Math.min(2, Math.max(0, t));
        Store.settings.openaiTemperature = t;
        $(this).val(t);
        Store.save();
    });
}
