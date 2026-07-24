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
    systemPrompt: "",
    // Adds a discarded "plan" field to the options request (and an optional discarded
    // <plan> block to the expand/enhance prose requests) so fast / non-thinking models get
    // a place to reason before answering. Thinking models are unaffected: their reasoning
    // already happens out of band and the plan is parsed out and thrown away, so their
    // visible output is unchanged. See buildPrompt/parseProseText in panel.js.
    planningStep: true,
    // "profile" routes through ST's Connection Manager (ConnectionManagerRequestService,
    // a saved profile, no effect on the chat's active connection); "openai" hits a
    // directly-configured OpenAI-compatible endpoint. See connection.js.
    connectionSource: "profile",
    connectionProfileId: "",
    openaiUrl: "",
    openaiKey: "",
    openaiModel: "",
    openaiMaxTokens: 0,
    openaiTemperature: 0.9,
    // How many of the character's most recent responses to send as scene context. Player
    // turns that fall between them come along too, so this bounds cost by the expensive
    // messages rather than by raw count. Deliberately small by default: Crossroads only
    // needs the live moment, and the character card carries longer-term continuity.
    contextResponses: 2,
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

// Identifies WHICH chat is open right now. Every async path captures this before its
// generation call and re-checks it afterwards: chat_metadata and the panel's options array
// are both swapped out by CHAT_CHANGED mid-flight, so a result that resolves after the user
// switched chats would otherwise be written into the wrong chat's metadata - options built
// from a different transcript, persona and character. Same guard Deep Story Reforged uses.
export function getCurrentChatId() {
    try {
        var context = getContext();
        if (context && context.chatId !== undefined && context.chatId !== null) return context.chatId;
        return scriptModule ? (scriptModule.chatId !== undefined ? scriptModule.chatId : null) : null;
    } catch (e) { return null; }
}

// --- Chat-scoped draw persistence (chat_metadata) ---
export function readDraw() {
    try {
        var meta = scriptModule ? scriptModule.chat_metadata : null;
        return meta ? meta[DRAW_KEY] : null;
    } catch (e) { return null; }
}

// Actually persists to disk (awaited), not just to the in-memory chat_metadata object.
// scriptModule.saveMetadataDebounced - the name Deep Story Reforged calls, and what this
// used to call - does not exist as an export on this SillyTavern version's script.js; the
// typeof guard around it silently no-opped, so a drawn set survived only until the next
// reload or chat switch, then was gone with no error anywhere. saveMetadata() (an alias for
// saveChatConditional()) is the real, confirmed-exported, non-debounced save.
export async function writeDraw(value) {
    try {
        if (!isChatOpen() || !scriptModule || !scriptModule.chat_metadata) return false;
        scriptModule.chat_metadata[DRAW_KEY] = value;
        if (typeof scriptModule.saveMetadata === "function") {
            await scriptModule.saveMetadata();
        } else if (typeof scriptModule.saveMetadataDebounced === "function") {
            scriptModule.saveMetadataDebounced();
        } else {
            console.warn("[Crossroads] No metadata save function found on script.js; draw will not persist across a reload.");
        }
        return true;
    } catch (e) { return false; }
}
