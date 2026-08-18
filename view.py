#!/usr/bin/env python3

from pathlib import Path
import http.server
import socketserver
import webbrowser
import threading
import json
import urllib.parse

ROOT = Path(__file__).resolve().parent
DOWNLOADS = Path.home() / "Downloads"

from add_archive import (
    find_set_from_conversations,
    validate_set,
    import_conversations_file,
    delete_source_set,
)


class Handler(http.server.SimpleHTTPRequestHandler):

    def __init__(self, *args, **kwargs):
        super().__init__(
            *args,
            directory=str(ROOT),
            **kwargs
        )

    def log_message(self, fmt, *args):
        pass

    def send_json(self, obj, status=200):
        body = json.dumps(
            obj,
            ensure_ascii=False
        ).encode("utf-8")

        self.send_response(status)

        self.send_header(
            "Content-Type",
            "application/json; charset=utf-8"
        )

        self.send_header(
            "Content-Length",
            str(len(body))
        )

        self.end_headers()

        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(
            self.path
        )

        if parsed.path == "/api/import-candidates":
            rows = []

            if DOWNLOADS.exists():
                candidates = sorted(
                    DOWNLOADS.glob(
                        "*_conversations.json"
                    ),
                    key=lambda x:
                        x.stat().st_mtime,
                    reverse=True
                )

                for path in candidates:
                    try:
                        file_set = (
                            find_set_from_conversations(
                                path
                            )
                        )

                        missing = validate_set(
                            file_set
                        )

                        rows.append({
                            "name":
                                path.name,

                            "path":
                                str(path),

                            "missing":
                                missing,

                            "volumes": [
                                x.name
                                for x
                                in file_set["volumes"]
                            ],

                            "has_manifest":
                                file_set[
                                    "manifest"
                                ].is_file(),
                        })

                    except Exception as error:
                        rows.append({
                            "name":
                                path.name,

                            "path":
                                str(path),

                            "error":
                                str(error),

                            "missing":
                                ["invalid"],
                        })

            self.send_json({
                "downloads":
                    str(DOWNLOADS),

                "candidates":
                    rows,
            })

            return

        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(
            self.path
        )

        if parsed.path != "/api/add-archive":
            self.send_json(
                {
                    "ok": False,
                    "error": "Not found"
                },
                404
            )

            return

        try:
            length = int(
                self.headers.get(
                    "Content-Length",
                    "0"
                )
            )

            data = json.loads(
                self.rfile.read(length)
                or b"{}"
            )

            source = Path(
                data.get(
                    "path",
                    ""
                )
            ).resolve()

            if source.parent != DOWNLOADS.resolve():
                raise RuntimeError(
                    "Дозволено імпортувати "
                    "лише з ~/Downloads"
                )

            if not source.name.endswith(
                "_conversations.json"
            ):
                raise RuntimeError(
                    "Оберіть файл "
                    "*_conversations.json"
                )

            file_set = (
                find_set_from_conversations(
                    source
                )
            )

            missing = validate_set(
                file_set
            )

            if missing:
                raise RuntimeError(
                    "Не вистачає файлів: "
                    + ", ".join(missing)
                )

            result = import_conversations_file(
                source
            )

            deleted = delete_source_set(
                result["file_set"]
            )

            self.send_json({
                "ok":
                    True,

                "added":
                    result["added"],

                "deleted":
                    deleted,

                "message":
                    f"Додано чатів: "
                    f"{len(result['added'])}. "
                    f"Source-файли видалено."
            })

        except Exception as error:
            self.send_json(
                {
                    "ok": False,
                    "error": str(error)
                },
                400
            )


class Server(
    socketserver.ThreadingTCPServer
):
    allow_reuse_address = True


with Server(
    ("127.0.0.1", 0),
    Handler
) as httpd:

    port = httpd.server_address[1]

    url = (
        f"http://127.0.0.1:"
        f"{port}/viewer/index.html"
    )

    print()
    print("ChatGPT Archive Viewer")
    print("----------------------")
    print("Archive root:", ROOT)
    print(
        "Serving:     ",
        ROOT / "viewer" / "index.html"
    )
    print("Downloads:   ", DOWNLOADS)
    print("URL:         ", url)
    print()

    threading.Timer(
        0.4,
        lambda:
            webbrowser.open(url)
    ).start()

    try:
        httpd.serve_forever()

    except KeyboardInterrupt:
        print("\nЗупинено.")
