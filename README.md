# Crossroads

*Four roads out of every scene. Pick one, bend it, or write your own.*

You're mid-roleplay, the message box is empty, and the cursor is just sitting there judging you. Crossroads is the extension for that exact moment: a small floating bar that reads the scene and hands you four genuinely different ways forward — a bold one, a guarded one, a sly one, whatever the moment calls for — each tagged with a tone icon so you know what you're looking at before you open it. Like one. Don't like it? Redraw just that one. Almost like it? Stretch it out with Expand, or grab the wand and tell it exactly what to change. Nothing gets sent until you say so — Crossroads only ever writes into your input box and waits.

It's not a co-writer that takes over. It's a lure — four hooks cast into the scene to catch whatever your character would actually do next, so you're editing instead of staring at a blank line.

## Features

- **Draw** — reads the recent scene and your persona/character cards, then proposes four distinct directions in one pass, each labeled with a short summary and a tone (bold, guarded, warm, sly, curious, wry, grim, tender).
- **Tap to preview** — open any option in a bubble to read the whole thing before committing.
- **Redraw this** — not feeling one of the four? Replace just that slot; the other three stay put, and the replacement is steered away from repeating them.
- **Expand** — one tap turns a short option into a fuller, more detailed turn, using built-in rules and the live chat for continuity.
- **The wand** — opens a custom OOC field for when you want to steer the rewrite yourself: *"make this more guarded,"* *"add more sensory detail,"* *"keep the length but sharpen the dialogue."*
- **Use this** — drops the chosen text straight into your message box, pre-filled and ready to edit. Crossroads never sends anything on your own behalf.
- **Drag anywhere** — the whole bar is the handle. Park it wherever it stays out of your way; it remembers where you left it.
- **Your own voice, not a takeover** — Crossroads writes only the player character's turn. It's told explicitly never to narrate or speak for anyone else in the scene, and never to let your character react to information they were never actually shown.

## Installation

1. In SillyTavern, open the **Extensions** panel (the plug icon) → **Install Extension**.
2. Paste `https://github.com/jeppsterrr/CrossRoads` and confirm.
3. Reload SillyTavern. A compact bar appears near the bottom of the chat screen.

Prefer doing it by hand instead? Clone this repo directly into:

```
SillyTavern/public/scripts/extensions/third-party/Crossroads
```

then restart (or reload) SillyTavern.

## Using it

1. Open a chat and press **Draw**. Four icons slide out of the bar — each one is an option.
2. Tap an icon to read it in full.
3. From there:
   - **Use this** — sends it straight to your input box.
   - **Redraw this** — swaps just that option for a new one.
   - **Expand** (the arrows icon) — grows it into a longer, fuller turn.
   - **The wand** — opens a one-line instruction field; type what you want changed and hit *Enhance with OOC*.
4. The arrow on the left of the bar shows or hides your current set without discarding it — only **Draw**/**Redraw** ever throws it away for a fresh one.
5. Click the palette icon to change the bar's accent color and backdrop, or just drag the bar itself to reposition it. Both are remembered on this device.

## Settings

Find these under **Extensions → Crossroads** in the SillyTavern settings panel:

| Setting | What it does |
|---|---|
| **Show the Crossroads bar** | Hides the bar entirely without disabling the extension. |
| **Choice instruction** | The heart of the plugin. Rewrite it to change what kind of options you get — darker, funnier, always dialogue, always physical action, more cautious. Leave blank to use the built-in default. |
| **Language for generated options** | Leave blank for English/default, or name any language the model can write. |
| **Generation source** | Where Crossroads sends its (quiet, background-only) generation requests — see below. |

### Generation source

Crossroads never touches your chat's active connection or history — every draw, redraw, and expansion is a standalone request that only ever writes back into your input box. Pick how that request gets sent:

- **Connection Manager profile** — routed through a saved [Connection Profile](https://docs.sillytavern.app/usage/core-concepts/connection-profiles/), so Crossroads can use a completely different backend/model than your main chat without you ever having to switch anything.
- **OpenAI-compatible endpoint** — point it directly at any OpenAI-compatible API (a local server like koboldcpp/text-generation-webui/LM Studio, or a hosted one) with its own URL, key, and model. Local endpoints are routed through SillyTavern's own CORS proxy automatically.

## How it thinks

Every option is built from the same guardrails, baked into the prompt regardless of what you put in the Choice instruction:

- Written **only** as your character's next turn — never narration or dialogue for anyone else in the scene.
- Continues directly from the last line of the actual conversation, not a vague continuation of "the story so far."
- Can't react to information your character was never shown — no answering a question no one asked, no knowing a secret only the narration revealed.
- Pulls real grounding from your persona and character card descriptions, not just the raw chat log.

## Credits

Originally built as a plugin for the [Tavo](https://tavo.app/) app, then ported to SillyTavern. The bubble's enhancement workflow was adapted, with permission, from Clowuds' Message Enhancer.

Author: **Jeppsterrr**
