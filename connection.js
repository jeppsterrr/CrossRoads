/*
 * connection.js
 * ---------------------------------------------------------------------------
 * generate(prompt) -> Promise<string>. Replaces the Tavo host's tavo.generate()
 * with a quiet, chat-independent generation call: it never touches ST's active
 * connection, chat history, or context injection - Crossroads always builds
 * every bit of context it needs directly into `prompt` itself (see panel.js's
 * buildPrompt/buildExpandPrompt/buildCustomEnhancePrompt), so nothing here
 * needs to layer ST's own template pipeline on top.
 *
 * Two backends, chosen by settings.connectionSource (a dropdown in the
 * Crossroads settings panel):
 *   - "profile": ST's Connection Manager, via ConnectionManagerRequestService.
 *     sendRequest(profileId, messages) sends one request through a saved
 *     profile without switching the chat's globally active connection -
 *     no restore-on-finish dance needed, unlike the older /profile slash-
 *     command switching Deep Story Reforged uses for its trackers.
 *   - "openai": a directly-configured OpenAI-compatible endpoint (URL/key/
 *     model), fetched straight from the browser. Routed through ST's /proxy/
 *     CORS proxy for local hosts (koboldcpp, text-generation-webui, LM
 *     Studio, ...), since those rarely send CORS headers of their own.
 * ---------------------------------------------------------------------------
 */

import * as Store from "./store.js";

const LOCAL_HOST_RE = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?/i;

export async function generate(prompt) {
    var source = (Store.settings && Store.settings.connectionSource) || "profile";
    return source === "openai" ? await sendViaOpenAI(prompt) : await sendViaProfile(prompt);
}

async function sendViaProfile(prompt) {
    var profileId = Store.settings && Store.settings.connectionProfileId;
    if (!profileId) {
        throw new Error("No Connection Manager profile selected. Pick one in Crossroads settings.");
    }
    var context = Store.getContext();
    var service = context && context.ConnectionManagerRequestService;
    if (!service || typeof service.sendRequest !== "function") {
        throw new Error("Connection Manager is unavailable. Install/enable it, or switch Crossroads to the OpenAI-Compatible mode.");
    }
    var raw;
    try {
        // sendRequest's real signature is (profileId, messages, maxTokens, custom, overridePayload) -
        // maxTokens is a NUMBER, not an options object. An options object here (an earlier bug)
        // wasn't stripped as undefined would be, so it went straight into the request body as
        // max_tokens itself; most backends tolerated the garbage value, but at least one (Google AI
        // Studio) validates it strictly and rejected it with a max_output_tokens error. undefined
        // lets the profile's own preset-configured response length govern, matching how the
        // OpenAI-Compatible path also applies no cap of its own unless the user sets one.
        // includeInstruct: false (the actual custom option; "ignoreInstruct" was never real) stops
        // Crossroads' already-self-contained prompt from being wrapped in the profile's Instruct
        // Template on text-completion-type profiles (local backends like koboldcpp) - it's a no-op
        // for chat-completion-type profiles, which don't apply an instruct template at all.
        raw = await service.sendRequest(profileId, [{ role: "user", content: prompt }], undefined, { includeInstruct: false });
    } catch (error) {
        throw new Error("Connection Manager request failed: " + (error && error.message ? error.message : String(error)));
    }
    var text = extractText(raw);
    if (!text) throw new Error("Connection Manager returned an empty response.");
    return text;
}

function extractText(raw) {
    if (typeof raw === "string") return raw;
    if (raw && typeof raw.content === "string") return raw.content;
    if (raw && raw.message && typeof raw.message.content === "string") return raw.message.content;
    if (raw && Array.isArray(raw.choices) && raw.choices[0] && raw.choices[0].message) {
        return raw.choices[0].message.content || "";
    }
    return "";
}

function proxiedUrl(url) { return "/proxy/" + url; }

function getProxyHeaders() {
    try {
        var context = Store.getContext();
        if (context && typeof context.getRequestHeaders === "function") return context.getRequestHeaders();
    } catch (e) { /* fall through to default */ }
    return { "Content-Type": "application/json" };
}

function endpointUrl(base) {
    var trimmed = String(base || "").replace(/\/+$/, "");
    if (trimmed.endsWith("/chat/completions")) return trimmed;
    if (trimmed.endsWith("/v1")) return trimmed + "/chat/completions";
    return trimmed + "/v1/chat/completions";
}

async function sendViaOpenAI(prompt) {
    var settings = Store.settings || {};
    var url = String(settings.openaiUrl || "").trim();
    var model = String(settings.openaiModel || "").trim();
    if (!url) throw new Error("OpenAI-Compatible URL is not set. Add one in Crossroads settings.");
    if (!model) throw new Error("OpenAI-Compatible model name is not set. Add one in Crossroads settings.");

    var endpoint = endpointUrl(url);
    var isLocal = LOCAL_HOST_RE.test(endpoint);
    var headers = { "Content-Type": "application/json" };
    if (settings.openaiKey) headers.Authorization = "Bearer " + settings.openaiKey;

    // Crossroads' longest possible reply (a 700-word Expand) is well inside every
    // provider's non-streaming ceiling, so a plain JSON request is enough - no need
    // for the SSE streaming some extensions use to dodge that ceiling on longer jobs.
    var body = { model: model, messages: [{ role: "user", content: prompt }], temperature: 0.9, stream: false };
    var maxTokens = Number(settings.openaiMaxTokens) || 0;
    if (maxTokens > 0) body.max_tokens = maxTokens;
    var payload = JSON.stringify(body);

    var response;
    if (isLocal) {
        try {
            response = await fetch(proxiedUrl(endpoint), { method: "POST", headers: Object.assign({}, getProxyHeaders(), headers), body: payload });
        } catch (proxyError) {
            try {
                response = await fetch(endpoint, { method: "POST", headers: headers, body: payload });
            } catch (directError) {
                throw new Error("Could not reach " + url + ". Enable the CORS proxy (enableCorsProxy: true in config.yaml) or confirm the endpoint is running. " + directError.message);
            }
        }
    } else {
        try {
            response = await fetch(endpoint, { method: "POST", headers: headers, body: payload });
        } catch (fetchError) {
            throw new Error("Could not reach " + url + ": " + fetchError.message);
        }
    }

    if (!response.ok) {
        var errorText = await response.text().catch(function () { return "Unknown error"; });
        if (response.status === 401) throw new Error("OpenAI-Compatible endpoint returned 401 Unauthorized. Check the API key.");
        throw new Error("OpenAI-Compatible request failed (" + response.status + "): " + errorText);
    }

    var data = await response.json();
    var text = data && data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content
        : "";
    if (!text || !String(text).trim()) throw new Error("OpenAI-Compatible endpoint returned an empty response.");
    return text;
}

// --- Settings-panel helper: fills a <select> with the user's saved Connection
// Manager profiles using ST's own populate routine, same as the profile picker
// Connection Manager renders for every other extension that supports it. ---
export function populateProfileDropdown(selectElement, currentValue) {
    try {
        var context = Store.getContext();
        var service = context && context.ConnectionManagerRequestService;
        if (service && typeof service.handleDropdown === "function") {
            service.handleDropdown(selectElement);
            if (currentValue) selectElement.value = currentValue;
            return true;
        }
    } catch (e) {
        console.warn("[Crossroads] populateProfileDropdown failed:", e);
    }
    return false;
}
