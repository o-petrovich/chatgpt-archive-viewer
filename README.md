# ChatGPT Archive Viewer

**English** | [Українська](README_UA.md)

**ChatGPT Archive Viewer** is a local viewer and archive manager for exported ChatGPT conversations.

It preserves messages, images and attachments, provides full-text navigation, and adds a **semantic table of contents** for long conversations. Unlike ordinary text search, semantic topics can point directly to the exact part of a conversation where a project stage, experiment, decision, or conclusion was discussed.

```text
ChatGPT
   ↓
ChatGPT Helper
   ↓
export files in ~/Downloads
   ↓
ChatGPT Archive Viewer
   ↓
local archive with conversations and attachments
```

After import, a conversation can be viewed locally without reopening the original chat on the ChatGPT website.

> The project is under active development, but the core workflow — archiving, viewing, search, Questions navigation, and the semantic Table of Contents — is already implemented and working.

---

## 1. What is ChatGPT Helper?

[`D1DX/chatgpt-helper`](https://github.com/D1DX/chatgpt-helper) is a separate Chrome extension used to export ChatGPT conversations and attachments.

ChatGPT Archive Viewer does **not** download conversations directly from ChatGPT. Instead, ChatGPT Helper creates the export, and Archive Viewer imports it into a local archive and renders it in a convenient HTML interface.

For Archive Viewer, use a **JSON export with attachments**.

### Installing ChatGPT Helper

Clone the Helper repository:

```bash
git clone https://github.com/D1DX/chatgpt-helper.git
```

Then in Chrome:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the cloned `chatgpt-helper` directory.
5. Pin the **ChatGPT Helper** extension if desired.

Before exporting, open `chatgpt.com` and make sure you are signed in.

---

## 2. Exporting a conversation

A single conversation can be exported using its Conversation ID.

For example, for:

```text
https://chatgpt.com/c/6a7f4b0d-4e70-83ed-9060-e7234ac3ea0d
```

the Conversation ID is:

```text
6a7f4b0d-4e70-83ed-9060-e7234ac3ea0d
```

Then:

1. Open the conversation on `chatgpt.com`.
2. Copy the Conversation ID from the URL — the part after `/c/`.
3. Open **ChatGPT Helper**.
4. Go to **Export Conversations**.
5. Select **By IDs**.
6. Paste the Conversation ID.
7. Under **Fetch**, enable `Conversations` and `Attachments`.
8. Under **Output**, select `ZIP (auto-split 100 MB)`.
9. Click **Run**.
10. Wait for `Done`.

The Helper saves the export set into the browser's standard **Downloads** directory.

A typical export contains:

```text
chatgpt-run-..._conversations.json
chatgpt-run-..._attachments-index.json
chatgpt-run-..._attachments-vol01.zip
chatgpt-run-..._run-manifest.json
```

Large exports may contain multiple attachment ZIP volumes. **Do not unpack them manually.** Archive Viewer handles them during import.

---

## 3. Installing ChatGPT Archive Viewer

Requirements: Python 3 and Git.

```bash
git clone git@github.com:o-petrovich/chatgpt-archive-viewer.git
cd chatgpt-archive-viewer
```

The current version uses Python's standard library only, so no separate `pip install` step is required.

### Project structure

```text
ChatGPT_Archive/
├── viewer/
│   ├── index.html
│   ├── app.js
│   ├── v5.js
│   ├── toc-enhancements.js
│   ├── toc-enhancements.css
│   ├── toc-rules.md
│   └── style.css
├── chats/
│   └── 2026-08-07_Conversation-title/
│       ├── conversation.json
│       ├── attachments-index.json
│       ├── attachments/
│       └── topics.json
├── catalog.json
├── add_archive.py
└── view.py
```

`chats/` contains local conversation archives. `catalog.json` is the Viewer's local conversation catalog. Both are intentionally excluded from Git.

---

## 4. Running the Viewer

```bash
python3 view.py
```

`view.py` starts a local HTTP server bound only to `127.0.0.1`, selects a free local port, and opens the Viewer in your browser.

Press `Ctrl+C` in the terminal to stop it.

---

## 5. Adding an archive

Click the `+` button in the upper-left corner.

The Viewer looks in `~/Downloads` for available `*_conversations.json` files, checks the matching export set, and lets you choose which archive to import.

After a successful import:

- a separate conversation directory is created under `chats/`;
- `conversation.json` is stored;
- attachments are copied locally;
- a local `attachments-index.json` is created;
- an initial `topics.json` is created;
- `catalog.json` is updated;
- the processed source export files are removed from `~/Downloads`.

---

## 6. Conversation list

The left column contains all imported conversations.

Each entry shows:

```text
Conversation title
YYYY-MM-DD HH:MM
```

The timestamp is derived from the **first real message in the conversation**, not the import time or directory name. Conversations are sorted by this timestamp, newest first.

Use **Search archives...** to filter the list by title.

---

## 7. Conversation view

The main view is intentionally close to the familiar ChatGPT layout.

User messages are displayed as separate **blue bubbles**. Normal assistant responses are shown as conversation blocks.

The Viewer filters internal export records such as reasoning, reasoning recaps, thoughts, tool calls and execution output based primarily on the export structure rather than simple text matching.

One important exception is generated images: ChatGPT exports may represent generated images as `role=tool`. The Viewer recognizes these image messages and keeps them visible while hiding internal tool records.

---

## 8. Attachments and images

During import, `attachments-index.json` maps `sediment://...` pointers to actual files inside the Helper's ZIP volumes.

Attachments are copied into the directory of the corresponding conversation. After import, the archived conversation no longer depends on the source files in `Downloads`.

---

## 9. Middle column: Table of Contents and Questions

The middle column provides two complementary navigation modes for long conversations.

### Table of Contents — semantic conversation navigation

The **Table of Contents** is an implemented feature, not a planned placeholder. It divides a long conversation into meaningful stages rather than merely listing headings or matching keywords.

Each conversation stores its semantic map in:

```text
chats/<conversation>/topics.json
```

Example topic:

```json
{
  "title": "PERF-05 — Gaussian Blur",
  "start_message_id": "abc123",
  "end_message_id": "def456",
  "summary": "Study of the effect of Gaussian Blur 9×9 on noise, FPS, and detection stability.",
  "level": 1
}
```

Fields:

- `title` — readable topic title shown in the Table of Contents;
- `start_message_id` — the message where the topic starts;
- `end_message_id` — the final message belonging to the topic;
- `summary` — a short description of what was discussed, tested, decided, or concluded;
- `level` — nesting level for hierarchical topics.

### Creating the semantic Table of Contents

In the **Table of Contents** tab, click **Prepare for ChatGPT** (`Підготувати для ChatGPT` in the current UI).

The Viewer generates:

```text
toc_source.md
```

This file contains a readable sequence of real user and assistant messages together with their `message_id` values. Internal service/tool messages are filtered out.

The Viewer also automatically appends rules for producing `topics.json`. The intended workflow is:

```text
archived conversation
   ↓
Prepare for ChatGPT
   ↓
toc_source.md
   ↓
ChatGPT reads the complete material
   ↓
ChatGPT proposes a human-readable table of contents
   ↓
review / corrections by the user
   ↓
topics.json
   ↓
Import topics.json
   ↓
interactive semantic Table of Contents
```

The rules embedded in `toc_source.md` explicitly require every `start_message_id` and `end_message_id` to be verified against the source file before the final JSON is produced. IDs must never be invented from memory.

### Importing `topics.json`

Click **Import topics.json** (`Імпортувати topics.json` in the current UI).

Before saving the file, the Viewer validates its structure, `level`, and referenced `start_message_id` / `end_message_id` values against the current conversation.

After a successful import, the new semantic Table of Contents appears immediately.

### Navigating topics

Clicking a topic scrolls the main conversation to its `start_message_id`.

The active topic is **highlighted**. When the conversation is scrolled manually, the Viewer follows the current position and automatically highlights the semantic topic being read. Topic boundaries are determined by `start_message_id` and `end_message_id`.

This makes the Table of Contents an **interactive semantic map of a long conversation**, rather than a static index.

### Questions

The **Questions** mode lists all user messages as navigation links — questions, commands, short replies, URLs, code, and messages with attachments.

Long entries are shortened to approximately 130 characters without cutting a word in the middle.

Clicking an entry scrolls the main conversation directly to that user message.

---

## 10. Search inside an open conversation

The **Search in chat...** field searches the currently open conversation.

Matches are highlighted, the current result and total count are displayed, and the up/down controls move between results.

This is separate from the archive-title search in the left column.

---

## 11. Local archive format

Each conversation is stored independently:

```text
chats/
└── 2026-08-07_Conversation-title/
    ├── conversation.json
    ├── attachments-index.json
    ├── attachments/
    └── topics.json
```

One HTML Viewer can therefore handle any number of local archives without embedding conversation data into the Viewer itself.

---

## 12. Manual import

A conversation export can also be imported from the command line:

```bash
python3 add_archive.py ~/Downloads/chatgpt-run-..._conversations.json
```

To delete the source export set after a successful import:

```bash
python3 add_archive.py ~/Downloads/chatgpt-run-..._conversations.json --delete-source
```

Imports performed through the Viewer's `+` button automatically remove the successfully processed source set.

---

## 13. Implemented features

- one Viewer for many archived conversations;
- local storage of conversations and attachments;
- import without manually unpacking ZIP volumes;
- export selection directly from `~/Downloads`;
- automatic cleanup of successfully processed exports;
- sorting by the real timestamp of the first conversation message;
- date and time shown below every archive title;
- archive-title search;
- full-text search inside the open conversation;
- highlighted search matches and result navigation;
- **Questions** mode as an index of all user messages;
- ChatGPT-like blue user-message bubbles;
- filtering of internal reasoning/tool records;
- support for generated images represented as tool messages;
- semantic **Table of Contents** based on `topics.json`;
- generation of `toc_source.md` directly from the Viewer;
- automatic inclusion of `topics.json` generation rules in `toc_source.md`;
- validation of referenced `message_id` values during import;
- `topics.json` import through the UI;
- direct navigation from a topic to its conversation location;
- automatic highlighting of the active semantic topic while reading.

---

## 14. Why semantic navigation?

Ordinary text search is often not enough for long technical ChatGPT conversations. A single chat may contain many consecutive experiments, decisions, returns to earlier questions, implementation attempts, and intermediate conclusions.

Archive Viewer therefore provides two different navigation models:

```text
Questions         → chronological index of user messages
Table of Contents → semantic map of conversation stages and topics
```

In the current implementation, ChatGPT performs semantic analysis using the Viewer-generated `toc_source.md`. The Viewer itself prepares the source material, preserves message IDs, validates and imports `topics.json`, performs topic navigation, and highlights the active topic.

`topics.json` remains separate from `conversation.json`: the original archived conversation is not modified, while the semantic annotation can be refined or regenerated independently.

---

## 15. Privacy

The Viewer runs locally. `view.py` listens only on:

```text
127.0.0.1
```

so your archive is not automatically published to the Internet.

The files under `chats/` may contain complete conversation text and attachments. Do not commit or publish that directory without reviewing its contents.

---

## Related projects

- [ChatGPT Helper — D1DX/chatgpt-helper](https://github.com/D1DX/chatgpt-helper)
- [ChatGPT Archive Viewer — o-petrovich/chatgpt-archive-viewer](https://github.com/o-petrovich/chatgpt-archive-viewer)
