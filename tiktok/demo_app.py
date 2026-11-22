#!/usr/bin/env python3
"""Daily Video Poster の投稿画面 (ローカルで動かす小さな Web アプリ)。

TikTok の Content Sharing Guidelines に沿った投稿フローを画面で操作できる:
投稿先アカウントの表示、公開範囲の手動選択、コメント/デュエット/ステッチの許可、
商用コンテンツの開示、同意文の表示、投稿後の処理状況の表示。

使い方: python3 demo_app.py VIDEO_DIR [PORT]
必要な環境変数は tiktok_post.py と同じ (TIKTOK_CLIENT_KEY / SECRET / REFRESH_TOKEN / REDIRECT_URI)。
"""
import html
import json
import os
import subprocess
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import tiktok_post as t

VIDEO_DIR = sys.argv[1] if len(sys.argv) > 1 else "videos"
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8000
PRIVACY_LABELS = {
    "PUBLIC_TO_EVERYONE": "Everyone",
    "MUTUAL_FOLLOW_FRIENDS": "Friends",
    "FOLLOWER_OF_CREATOR": "Followers",
    "SELF_ONLY": "Only me",
}
STATE = {"token": None, "posts": {}}

CSS = """
body{font-family:system-ui,sans-serif;background:#f6f6f8;color:#161823;margin:0}
header{background:#161823;color:#fff;padding:14px 24px;font-weight:700;font-size:18px}
main{max-width:860px;margin:28px auto;padding:0 20px}
.card{background:#fff;border-radius:12px;padding:24px;margin-bottom:20px;box-shadow:0 1px 4px rgba(0,0,0,.08)}
.btn{display:inline-block;background:#fe2c55;color:#fff;border:0;border-radius:8px;padding:12px 22px;font-size:16px;font-weight:600;cursor:pointer;text-decoration:none}
.btn[disabled]{background:#ccc;cursor:not-allowed}
.row{display:flex;gap:24px;flex-wrap:wrap}.col{flex:1;min-width:260px}
label{display:block;font-weight:600;margin:16px 0 6px}
textarea,select{width:100%;box-sizing:border-box;padding:10px;font-size:15px;border:1px solid #ccc;border-radius:8px;font-family:inherit}
.check{font-weight:400;margin:6px 0}.muted{color:#666;font-size:14px}
.who{display:flex;align-items:center;gap:12px}.who img{width:48px;height:48px;border-radius:50%}
video,img.preview{width:100%;border-radius:10px;background:#000}
.ok{color:#0a8a3a;font-weight:700}.ng{color:#c0392b;font-weight:700}
"""


def page(title, body):
    return (f"<!doctype html><html lang='en'><head><meta charset='utf-8'><title>{title} - Daily Video Poster</title>"
            f"<style>{CSS}</style></head><body><header>Daily Video Poster</header><main>{body}</main></body></html>")


def token():
    if not STATE["token"]:
        STATE["token"] = t.access_token()
    return STATE["token"]


def videos():
    return sorted(f for f in os.listdir(VIDEO_DIR) if f.lower().endswith(".mp4"))


def auth_url():
    return "https://www.tiktok.com/v2/auth/authorize/?" + urllib.parse.urlencode({
        "client_key": os.environ["TIKTOK_CLIENT_KEY"], "scope": "user.info.basic,video.publish",
        "response_type": "code", "redirect_uri": os.environ["TIKTOK_REDIRECT_URI"], "state": "tiktok-post"})


def home():
    return page("Home", f"""
<div class="card"><h1>Schedule your own videos to TikTok</h1>
<p>Daily Video Poster uploads your prepared videos with a caption and hashtags to your TikTok account.</p>
<p><a class="btn" id="login" href="{html.escape(auth_url())}">Continue with TikTok</a></p>
<p class="muted">You will be asked by TikTok to authorize this app to post videos to your account.</p></div>
<div class="card"><h2>Already connected?</h2><p><a class="btn" id="compose" href="/compose">Create a post</a></p></div>""")


def compose(selected, caption):
    creator = t.api_post(token(), "/v2/post/publish/creator_info/query/", {})
    files = videos()
    selected = selected if selected in files else files[0]
    options = "".join(f"<option value='{p}'>{PRIVACY_LABELS.get(p, p)}</option>" for p in creator["privacy_level_options"])
    picks = "".join(f"<option {'selected' if f == selected else ''}>{html.escape(f)}</option>" for f in files)

    def check(name, label, disabled):
        return (f"<label class='check'><input type='checkbox' name='{name}' {'disabled' if disabled else ''}> "
                f"{label}{' (turned off in your TikTok settings)' if disabled else ''}</label>")

    return page("Create a post", f"""
<div class="card"><div class="who"><img src="{html.escape(creator.get('creator_avatar_url', ''))}" alt="" onerror="this.style.display='none'">
<div><div class="muted">Posting to TikTok account</div><b>{html.escape(creator['creator_nickname'])}</b>
<span class="muted">@{html.escape(creator['creator_username'])}</span></div></div></div>
<form class="card" method="post" action="/post"><div class="row">
<div class="col"><label>Video</label>
<select name="video" onchange="location='/compose?video='+encodeURIComponent(this.value)">{picks}</select>
<p><img class="preview" style="max-width:260px" src="/poster?video={urllib.parse.quote(selected)}" alt="Video preview"></p>
<p class="muted">Max length for this account: {creator.get('max_video_post_duration_sec', '?')} seconds</p></div>
<div class="col"><label>Caption</label><textarea name="caption" rows="6" maxlength="2200">{html.escape(caption)}</textarea>
<label>Who can view this video</label>
<select name="privacy" id="privacy" required onchange="document.getElementById('post').disabled=!this.value">
<option value="" selected disabled>Select who can view</option>{options}</select>
<label>Allow users to</label>
{check('comment', 'Comment', creator.get('comment_disabled'))}
{check('duet', 'Duet', creator.get('duet_disabled'))}
{check('stitch', 'Stitch', creator.get('stitch_disabled'))}
<label>Disclose video content</label>
<label class="check"><input type="checkbox" name="brand_organic"> Your brand - you are promoting yourself or your own business</label>
<label class="check"><input type="checkbox" name="brand_content"> Branded content - you are promoting another brand or a third party</label>
<p class="muted">By posting, you agree to TikTok's
<a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank">Music Usage Confirmation</a>.</p>
<p><button class="btn" id="post" disabled>Post to TikTok</button></p></div></div></form>""")


def do_post(form):
    video = form.get("video", "")
    if video not in videos():
        return page("Error", "<div class='card'><p class='ng'>Unknown video.</p></div>")
    path = os.path.join(VIDEO_DIR, video)
    size = os.path.getsize(path)
    chunk_size, ranges = t.plan_chunks(size)
    init = t.api_post(token(), "/v2/post/publish/video/init/", {
        "post_info": {
            "title": form.get("caption", ""), "privacy_level": form["privacy"],
            "disable_comment": "comment" not in form, "disable_duet": "duet" not in form,
            "disable_stitch": "stitch" not in form,
            "brand_organic_toggle": "brand_organic" in form, "brand_content_toggle": "brand_content" in form,
        },
        "source_info": {"source": "FILE_UPLOAD", "video_size": size, "chunk_size": chunk_size,
                        "total_chunk_count": len(ranges)},
    })
    with open(path, "rb") as f:
        for start, end in ranges:
            f.seek(start)
            status, body = t.http("PUT", init["upload_url"], {
                "Content-Type": "video/mp4", "Content-Range": f"bytes {start}-{end}/{size}"}, f.read(end - start + 1))
            if status not in (201, 206):
                return page("Error", f"<div class='card'><p class='ng'>Upload failed (HTTP {status}).</p></div>")
    STATE["posts"][init["publish_id"]] = video
    return None, init["publish_id"]


def status_page(publish_id):
    state = t.api_post(token(), "/v2/post/publish/status/fetch/", {"publish_id": publish_id})
    done = state["status"] in ("PUBLISH_COMPLETE", "FAILED")
    mark = "ok" if state["status"] == "PUBLISH_COMPLETE" else ("ng" if done else "muted")
    text = {"PUBLISH_COMPLETE": "Posted to TikTok. It may take a few minutes to appear on your profile.",
            "FAILED": "Posting failed: " + str(state.get("fail_reason"))}.get(
                state["status"], "Your video is being processed by TikTok...")
    refresh = "" if done else "<meta http-equiv='refresh' content='4'>"
    return page("Status", f"""{refresh}<div class="card"><h1>Post status</h1>
<p>Video: <b>{html.escape(STATE['posts'].get(publish_id, ''))}</b></p>
<p class="{mark}" id="status">{html.escape(text)}</p><p class="muted">Status: {state['status']} / ID: {html.escape(publish_id)}</p>
<p><a class="btn" href="/compose">Create another post</a></p></div>""")


class Handler(BaseHTTPRequestHandler):
    def send(self, body, ctype="text/html; charset=utf-8", code=200):
        data = body if isinstance(body, bytes) else body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        q = {k: v[0] for k, v in urllib.parse.parse_qs(url.query).items()}
        try:
            if url.path == "/":
                self.send(home())
            elif url.path == "/compose":
                self.send(compose(q.get("video"), q.get("caption", "")))
            elif url.path == "/status":
                self.send(status_page(q["id"]))
            elif url.path in ("/video", "/poster") and q.get("video") in videos():
                path = os.path.join(VIDEO_DIR, q["video"])
                if url.path == "/video":
                    self.send(open(path, "rb").read(), "video/mp4")
                else:
                    jpg = subprocess.run(["ffmpeg", "-v", "error", "-ss", "8", "-i", path, "-frames:v", "1",
                                          "-f", "image2", "-c:v", "mjpeg", "-"], capture_output=True).stdout
                    self.send(jpg, "image/jpeg")
            else:
                self.send("Not found", code=404)
        except SystemExit as e:
            self.send(page("Error", f"<div class='card'><p class='ng'>{html.escape(str(e))}</p></div>"), code=502)

    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0))).decode()
        form = {k: v[0] for k, v in urllib.parse.parse_qs(raw).items()}
        try:
            result = do_post(form)
            if isinstance(result, tuple):
                self.send_response(303)
                self.send_header("Location", "/status?id=" + urllib.parse.quote(result[1]))
                self.end_headers()
            else:
                self.send(result, code=400)
        except SystemExit as e:
            self.send(page("Error", f"<div class='card'><p class='ng' id='status'>{html.escape(str(e))}</p>"
                                    "<p><a class='btn' href='/compose'>Back</a></p></div>"), code=502)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    print(f"http://127.0.0.1:{PORT}/")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
