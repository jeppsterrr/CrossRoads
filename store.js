/*
 * store.js
 * ---------------------------------------------------------------------------
 * Shared state + persistence for Crossroads. index.js is a classic
 * (non-module) script SillyTavern loads directly, so it can't use static
 * import; this file and panel.js/connection.js are real ES modules reached
 * via dynamic import() inside index.js's bootstrap (same split Deep Story
 * Reforged uses for the same reason).
 *
 * Three storage tiers, mirroring the original Tavo plugin's three var scopes:
 *   - settings      -> extension_settings[MODULE], the fields the user edits
 *                      in the Extensions panel (Choice instruction, language,
 *                      connection source, ...). Tavo: tavo.plugin.config.get().
 *   - chat-scoped   -> chat_metadata[DRAW_KEY], the current draw (options +
 *                      used state). Tavo: tavo.get/set(key, "chat").
 *   - device-scoped -> extension_settings[MODULE].ui, appearance + bar
 *                      position, edited from the bar's own palette panel
 *                      rather than the settings drawer. Tavo: tavo.get/set
 *                      (key, "global") - extension_settings is already
 *                      per-user/device storage, so it doubles for both tiers.
 * ---------------------------------------------------------------------------
 */

export const MODULE = "crossroads";
const DRAW_KEY = "crossroads_draw_v1";

export const DEFAULT_SETTINGS = {
    showBar: true,
    storyLanguage: "",
    systemPrompt: "",
    // "profile" routes through ST's Connection Manager (ConnectionManagerRequestService,
    // a saved profile, no effect on the chat's active connection); "openai" hits a
    // directly-configured OpenAI-compatible endpoint. See connection.js.
    connectionSource: "profile",
    connectionProfileId: "",
    openaiUrl: "",
    openaiKey: "",
    openaiModel: "",
    openaiMaxTokens: 0,
    ui: {
        accent: "#c8a24a",
        backdrop: "#17171a",
        barX: null,
        barY: null,
        open: false
    }
};

// --- ST module handles, set once during bootstrap (see index.js) ---
export let extSettings = null;
export let saveFn = null;
export let scriptModule = null;
export let powerUser = null;
export let settings = null;

export function setBootstrap(vals) {
    if ("extSettings" in vals) extSettings = vals.extSettings;
    if ("saveFn" in vals) saveFn = vals.saveFn;
    if ("scriptModule" in vals) scriptModule = vals.scriptModule;
    if ("powerUser" in vals) powerUser = vals.powerUser;
}

export function loadSettings() {
    var merged = Object.assign({}, DEFAULT_SETTINGS);
    if (extSettings) {
        if (!extSettings[MODULE]) extSettings[MODULE] = {};
        Object.assign(merged, extSettings[MODULE]);
        merged.ui = Object.assign({}, DEFAULT_SETTINGS.ui, extSettings[MODULE].ui || {});
        extSettings[MODULE] = merged;
    }
    settings = merged;
    return settings;
}

export function save() {
    if (typeof saveFn === "function") return saveFn();
    if (scriptModule && typeof scriptModule.saveSettingsDebounced === "function") {
        return scriptModule.saveSettingsDebounced();
    }
}

export function saveUi() { save(); }

// --- Chat context helpers ---
export function getContext() {
    try {
        return (typeof SillyTavern !== "undefined" && typeof SillyTavern.getContext === "function")
            ? SillyTavern.getContext() : null;
    } catch (e) { return null; }
}

export function isChatOpen() {
    try {
        var context = getContext();
        var chat = context ? context.chat : (scriptModule ? scriptModule.chat : null);
        var chatId = context ? context.chatId : (scriptModule ? scriptModule.chatId : null);
        var charId = context ? context.characterId : (scriptModule ? scriptModule.this_chid : null);
        var groupId = context ? context.groupId : (scriptModule ? scriptModule.groupId : null);
        if (!chat || !chatId) return false;
        if ((charId === undefined || charId === null) && !groupId) return false;
        return true;
    } catch (e) { return false; }
}

// --- Chat-scoped draw persistence (chat_metadata) ---
export function readDraw() {
    try {
        var meta = scriptModule ? scriptModule.chat_metadata : null;
        return meta ? meta[DRAW_KEY] : null;
    } catch (e) { return null; }
}

export function writeDraw(value) {
    try {
        if (!isChatOpen() || !scriptModule || !scriptModule.chat_metadata) return false;
        scriptModule.chat_metadata[DRAW_KEY] = value;
        if (typeof scriptModule.saveMetadataDebounced === "function") {
            scriptModule.saveMetadataDebounced();
        }
        return true;
    } catch (e) { return false; }
}
