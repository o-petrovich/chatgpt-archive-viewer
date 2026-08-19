#!/usr/bin/env python3

from pathlib import Path
from datetime import datetime
import http.server
import socketserver
import webbrowser
import threading
import json
import urllib.parse
import re

ROOT = Path(__file__).resolve().parent
DOWNLOADS = Path.home() / "Downloads"
CATALOG = ROOT / "catalog.json"

from add_archive import (
    find_set_from_conversations,
    validate_set,
    import_conversations_file,
    delete_source_set,
)


def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def find_chat_entry(chat_id):
    try:
        catalog = load_json(CATALOG)
    except Exception:
        catalog = []

    for item in catalog if isinstance(catalog, list) else []:
        if str(item.get("id")) == str(chat_id):
            return item

    raise RuntimeError("Чат не знайдено в catalog.json")


def chat_paths(chat_id):
    entry = find_chat_entry(chat_id)
    folder = (ROOT / entry["path"]).resolve()

    if ROOT.resolve() not in folder.parents:
        raise RuntimeError("Некоректний шлях чату")

    conversation = folder / "conversation.json"
    topics = folder / "topics.json"

    if not conversation.is_file():
        raise RuntimeError("conversation.json не знайдено")

    return entry, folder, conversation, topics


def active_nodes(conv):
    mapping = conv.get("mapping") or {}
    current = conv.get("current_node")

    if current and current in mapping:
        ids = []
        seen = set()
        node_id = current

        while node_id and node_id in mapping and node_id not in seen:
            seen.add(node_id)
            ids.append(node_id)
            node_id = (mapping[node_id] or {}).get("parent")

        ids.reverse()
        return [(node_id, mapping[node_id]) for node_id in ids]

    rows = [
        (node_id, node)
        for node_id, node in mapping.items()
        if node and node.get("message")
    ]

    rows.sort(
        key=lambda pair: ((pair[1].get("message") or {}).get("create_time") or 0)
    )

    return rows


def message_has_image(message):
    content = message.get("content") or {}

    if content.get("content_type") != "multimodal_text":
        return False

    return any(
        isinstance(part, dict)
        and part.get("content_type") == "image_asset_pointer"
        and isinstance(part.get("asset_pointer"), str)
        for part in (content.get("parts") or [])
    )


def is_service_message(message):
    role = (message.get("author") or {}).get("role") or ""
    content = message.get("content") or {}
    content_type = content.get("content_type") or ""
    metadata = message.get("metadata") or {}
    recipient = message.get("recipient") or "all"

    if role == "user":
        return False

    if role == "tool":
        return not message_has_image(message)

    if role in {"system", "developer"}:
        return True

    if role != "assistant":
        return True

    if recipient != "all":
        return True

    if metadata.get("reasoning_status") in {"is_reasoning", "reasoning_ended"}:
        return True

    if metadata.get("can_save") is False and content_type == "code":
        return True

    if content_type in {
        "thoughts",
        "reasoning_recap",
        "execution_output",
        "tool_result",
        "computer_initialize_state",
        "computer_output",
        "code_execution_output",
    }:
        return True

    return False


def clean_message_text(message):
    content = message.get("content") or {}
    content_type = content.get("content_type") or ""
    out = []

    if content_type in {"text", "multimodal_text"}:
        for part in content.get("parts") or []:
            if isinstance(part, str):
                out.append(part)
            elif isinstance(part, dict):
                ptype = part.get("content_type")

                if ptype == "image_asset_pointer":
                    out.append("[ЗОБРАЖЕННЯ]")
                elif ptype == "audio_asset_pointer":
                    out.append("[АУДІО]")
                elif ptype == "audio_transcription" and part.get("text"):
                    out.append(part["text"])

    elif content_type == "code":
        text = content.get("text") or ""
        if text:
            out.append(f"```\n{text}\n```")

    return "\n\n".join(x.strip() for x in out if str(x).strip()).strip()


def format_time(timestamp):
    if not isinstance(timestamp, (int, float)) or timestamp <= 0:
        return ""

    return datetime.fromtimestamp(timestamp).strftime("%Y-%m-%d %H:%M:%S")


def download_safe_title(title):
    title = str(title or "Без назви").strip()
    title = re.sub(r'[\\/:*?"<>|]+', "-", title)
    title = re.sub(r"\s+", " ", title).strip(" .-")
    return title[:120] or "Без назви"


def make_toc_source(conv, entry):
    lines = [
        f"# {conv.get('title') or entry.get('title') or 'Без назви'}",
        "",
        f"Conversation ID: {conv.get('conversation_id') or entry.get('id') or ''}",
        "",
        "> ## Призначення файла",
        ">",
        "> Цей файл є повним текстовим представленням архівованого ChatGPT-чату",
        "> зі збереженням ролей, `message_id` і часу повідомлень.",
        ">",
        "> Файл використовується для двох задач:",
        ">",
        "> 1. як джерело для створення та перевірки семантичного змісту `topics.json`;",
        "> 2. як повна історія розмови для ChatGPT при продовженні роботи над проєктом",
        ">    у нових чатах, коли `PROJECT_STATE.md`, `DECISIONS.md` або короткого",
        ">    `summary` у `topics.json` недостатньо.",
        ">",
        "> `message_id` є стабільними посиланнями на повідомлення цього чату.",
        "> Значення `start_message_id` та `end_message_id` у `topics.json`",
        "> повинні посилатися на реальні `message_id` цього файла.",
        ">",
        "> Не скорочувати і не перефразовувати текст повідомлень:",
        "> цей файл є першоджерелом історії розмови.",
        "",
        "---",
        "",
    ]

    for node_id, node in active_nodes(conv):
        message = (node or {}).get("message")

        if not message or is_service_message(message):
            continue

        role = (message.get("author") or {}).get("role") or ""
        text = clean_message_text(message)

        if not text:
            continue

        if role == "user":
            label = "USER"
        elif role == "tool" and message_has_image(message):
            label = "CHATGPT IMAGE"
        else:
            label = "CHATGPT"

        message_id = message.get("id") or node_id

        lines.extend([
            f"## {label}",
            f"message_id: {message_id}",
        ])

        timestamp = format_time(message.get("create_time"))
        if timestamp:
            lines.append(f"time: {timestamp}")

        lines.extend(["", text, "", "---", ""])

    return "\n".join(lines).rstrip() + "\n"


def normalize_topics(raw_topics, conv):
    if not isinstance(raw_topics, list):
        raise RuntimeError("topics.json повинен містити JSON-масив")

    valid_ids = set()
    for node_id, node in (conv.get("mapping") or {}).items():
        message = (node or {}).get("message")
        if message:
            valid_ids.add(str(message.get("id") or node_id))

    result = []

    for index, raw in enumerate(raw_topics, start=1):
        if not isinstance(raw, dict):
            raise RuntimeError(f"Пункт {index}: очікується JSON-об'єкт")

        title = str(raw.get("title") or "").strip()
        if not title:
            raise RuntimeError(f"Пункт {index}: відсутній title")

        start_id = raw.get("start_message_id")
        end_id = raw.get("end_message_id")

        if start_id is not None:
            start_id = str(start_id)
            if start_id not in valid_ids:
                raise RuntimeError(
                    f"Пункт {index}: start_message_id не знайдено в чаті: {start_id}"
                )

        if end_id is not None:
            end_id = str(end_id)
            if end_id not in valid_ids:
                raise RuntimeError(
                    f"Пункт {index}: end_message_id не знайдено в чаті: {end_id}"
                )

        summary = str(raw.get("summary") or "").strip()

        try:
            level = int(raw.get("level", 1))
        except Exception:
            raise RuntimeError(f"Пункт {index}: level повинен бути числом")

        if level < 1 or level > 6:
            raise RuntimeError(f"Пункт {index}: level повинен бути від 1 до 6")

        result.append({
            "title": title,
            "start_message_id": start_id,
            "end_message_id": end_id,
            "summary": summary,
            "level": level,
        })

    if not any(item["start_message_id"] is None for item in result):
        result.insert(0, {
            "title": "Огляд чату",
            "start_message_id": None,
            "end_message_id": None,
            "summary": "Повний огляд розмови від початку.",
            "level": 1,
        })

    return result


class Handler(http.server.SimpleHTTPRequestHandler):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        pass

    def send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_text_download(self, text, filename, content_type="text/markdown; charset=utf-8"):
        body = text.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        encoded = urllib.parse.quote(filename)
        self.send_header(
            "Content-Disposition",
            f"attachment; filename*=UTF-8''{encoded}"
        )
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)

        if parsed.path == "/api/import-candidates":
            rows = []

            if DOWNLOADS.exists():
                candidates = sorted(
                    DOWNLOADS.glob("*_conversations.json"),
                    key=lambda x: x.stat().st_mtime,
                    reverse=True
                )

                for path in candidates:
                    try:
                        file_set = find_set_from_conversations(path)
                        missing = validate_set(file_set)
                        rows.append({
                            "name": path.name,
                            "path": str(path),
                            "missing": missing,
                            "volumes": [x.name for x in file_set["volumes"]],
                            "has_manifest": file_set["manifest"].is_file(),
                        })
                    except Exception as error:
                        rows.append({
                            "name": path.name,
                            "path": str(path),
                            "error": str(error),
                            "missing": ["invalid"],
                        })

            self.send_json({
                "downloads": str(DOWNLOADS),
                "candidates": rows,
            })
            return

        if parsed.path == "/api/toc-source":
            try:
                query = urllib.parse.parse_qs(parsed.query)
                chat_id = (query.get("chat_id") or [""])[0]

                if not chat_id:
                    raise RuntimeError("Не вказаний chat_id")

                entry, _, conversation_path, _ = chat_paths(chat_id)
                conv = load_json(conversation_path)
                markdown = make_toc_source(conv, entry)
                title = download_safe_title(conv.get("title") or entry.get("title"))

                self.send_text_download(markdown, f"toc_source_{title}.md")
            except Exception as error:
                self.send_json({"ok": False, "error": str(error)}, 400)
            return

        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)

        if parsed.path not in {"/api/add-archive", "/api/import-topics"}:
            self.send_json({"ok": False, "error": "Not found"}, 404)
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            data = json.loads(self.rfile.read(length) or b"{}")

            if parsed.path == "/api/import-topics":
                chat_id = data.get("chat_id")
                raw_topics = data.get("topics")

                if not chat_id:
                    raise RuntimeError("Не вказаний chat_id")

                _, _, conversation_path, topics_path = chat_paths(chat_id)
                conv = load_json(conversation_path)
                topics = normalize_topics(raw_topics, conv)

                with open(topics_path, "w", encoding="utf-8") as f:
                    json.dump(topics, f, ensure_ascii=False, indent=2)

                self.send_json({
                    "ok": True,
                    "topics": topics,
                    "message": f"Імпортовано пунктів змісту: {len(topics)}"
                })
                return

            source = Path(data.get("path", "")).resolve()

            if source.parent != DOWNLOADS.resolve():
                raise RuntimeError("Дозволено імпортувати лише з ~/Downloads")

            if not source.name.endswith("_conversations.json"):
                raise RuntimeError("Оберіть файл *_conversations.json")

            file_set = find_set_from_conversations(source)
            missing = validate_set(file_set)

            if missing:
                raise RuntimeError("Не вистачає файлів: " + ", ".join(missing))

            result = import_conversations_file(source)
            deleted = delete_source_set(result["file_set"])

            self.send_json({
                "ok": True,
                "added": result["added"],
                "deleted": deleted,
                "message":
                    f"Додано чатів: {len(result['added'])}. Source-файли видалено."
            })

        except Exception as error:
            self.send_json({"ok": False, "error": str(error)}, 400)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True


with Server(("127.0.0.1", 0), Handler) as httpd:
    port = httpd.server_address[1]
    url = f"http://127.0.0.1:{port}/viewer/index.html"

    print()
    print("ChatGPT Archive Viewer")
    print("----------------------")
    print("Archive root:", ROOT)
    print("Serving:     ", ROOT / "viewer" / "index.html")
    print("Downloads:   ", DOWNLOADS)
    print("URL:         ", url)
    print()

    threading.Timer(0.4, lambda: webbrowser.open(url)).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nЗупинено.")
