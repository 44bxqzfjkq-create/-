#!/usr/bin/env python3
"""TikTok への動画投稿ツール (Content Posting API / 標準ライブラリのみ)。

サブコマンド:
  auth-url            認証用URLを表示する (最初の1回だけ)
  exchange CODE       認証コードをリフレッシュトークンに交換する (最初の1回だけ)
  frames VIDEO        動画から静止画を等間隔に切り出す (内容確認・キャプション作成用)
  post VIDEO          動画をキャプション付きで投稿する
  status PUBLISH_ID   投稿の処理状況を確認する

必要な環境変数:
  TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET   開発者アプリの値
  TIKTOK_REFRESH_TOKEN                      exchange で得た値 (post / status で使用)
  TIKTOK_REDIRECT_URI                       アプリに登録したリダイレクトURI (auth-url / exchange で使用)
"""
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://open.tiktokapis.com"
MB = 1024 * 1024
SINGLE_UPLOAD_MAX = 64 * MB   # これ以下は1回で送る
CHUNK_SIZE = 10 * MB          # それより大きい場合の分割サイズ
CAPTION_MAX = 2200            # UTF-16 換算の上限


def env(name):
    value = os.environ.get(name)
    if not value:
        sys.exit(f"環境変数 {name} が設定されていません")
    return value


def http(method, url, headers=None, data=None):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=300) as res:
            return res.status, res.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def token_request(fields):
    status, body = http(
        "POST",
        f"{API}/v2/oauth/token/",
        {"Content-Type": "application/x-www-form-urlencoded"},
        urllib.parse.urlencode(fields).encode(),
    )
    data = json.loads(body or b"{}")
    if status != 200 or "access_token" not in data:
        sys.exit(f"トークン取得に失敗しました (HTTP {status}): {data.get('error')} {data.get('error_description')}")
    return data


def access_token():
    refresh = env("TIKTOK_REFRESH_TOKEN")
    data = token_request({
        "client_key": env("TIKTOK_CLIENT_KEY"),
        "client_secret": env("TIKTOK_CLIENT_SECRET"),
        "grant_type": "refresh_token",
        "refresh_token": refresh,
    })
    if data.get("refresh_token") and data["refresh_token"] != refresh:
        # TikTok が新しいリフレッシュトークンを返した。保存し直さないと次回から失敗する。
        print("注意: リフレッシュトークンが更新されました。環境変数 TIKTOK_REFRESH_TOKEN を"
              "新しい値に差し替える必要があります (値は ./.tiktok_new_refresh_token に保存)。",
              file=sys.stderr)
        with open(".tiktok_new_refresh_token", "w") as f:
            f.write(data["refresh_token"])
        os.chmod(".tiktok_new_refresh_token", 0o600)
    return data["access_token"]


def api_post(token, path, payload):
    status, body = http(
        "POST",
        f"{API}{path}",
        {"Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=UTF-8"},
        json.dumps(payload).encode(),
    )
    data = json.loads(body or b"{}")
    code = data.get("error", {}).get("code")
    if status != 200 or code != "ok":
        sys.exit(f"{path} が失敗しました (HTTP {status}): {json.dumps(data.get('error'), ensure_ascii=False)}")
    return data["data"]


def plan_chunks(size):
    """(chunk_size, [(start, end_inclusive), ...]) を返す。端数は最後のチャンクにまとめる。"""
    if size <= SINGLE_UPLOAD_MAX:
        return size, [(0, size - 1)]
    count = size // CHUNK_SIZE
    ranges = [(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE - 1) for i in range(count)]
    ranges[-1] = (ranges[-1][0], size - 1)
    return CHUNK_SIZE, ranges


def duration_seconds(video):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    return float(out)


def cmd_auth_url(args):
    query = urllib.parse.urlencode({
        "client_key": env("TIKTOK_CLIENT_KEY"),
        "scope": "video.publish",
        "response_type": "code",
        "redirect_uri": env("TIKTOK_REDIRECT_URI"),
        "state": "tiktok-post",
    })
    print(f"https://www.tiktok.com/v2/auth/authorize/?{query}")


def cmd_exchange(args):
    data = token_request({
        "client_key": env("TIKTOK_CLIENT_KEY"),
        "client_secret": env("TIKTOK_CLIENT_SECRET"),
        "grant_type": "authorization_code",
        "code": urllib.parse.unquote(args.code),
        "redirect_uri": env("TIKTOK_REDIRECT_URI"),
    })
    print("TIKTOK_REFRESH_TOKEN に設定する値 (約1年有効):")
    print(data["refresh_token"])


def cmd_frames(args):
    os.makedirs(args.out, exist_ok=True)
    duration = duration_seconds(args.video)
    paths = []
    for i in range(args.count):
        at = duration * (i + 0.5) / args.count
        path = os.path.join(args.out, f"frame_{i + 1:02d}.jpg")
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-ss", f"{at:.2f}", "-i", args.video,
             "-frames:v", "1", "-vf", "scale=480:-2", path],
            check=True,
        )
        paths.append(path)
    print(json.dumps({"duration_sec": round(duration, 1), "frames": paths}, ensure_ascii=False))


def cmd_post(args):
    caption = args.caption
    if len(caption.encode("utf-16-le")) // 2 > CAPTION_MAX:
        sys.exit(f"キャプションが長すぎます (上限 {CAPTION_MAX} 文字)")
    size = os.path.getsize(args.video)
    chunk_size, ranges = plan_chunks(size)
    if args.dry_run:
        print(json.dumps({"video_size": size, "chunk_size": chunk_size,
                          "total_chunk_count": len(ranges), "caption": caption,
                          "privacy": args.privacy}, ensure_ascii=False))
        return

    token = access_token()
    creator = api_post(token, "/v2/post/publish/creator_info/query/", {})
    options = creator.get("privacy_level_options", [])
    if args.privacy not in options:
        sys.exit(f"公開範囲 {args.privacy} は使えません。選べる値: {options}")
    max_duration = creator.get("max_video_post_duration_sec")
    if max_duration and duration_seconds(args.video) > max_duration:
        sys.exit(f"動画が長すぎます (このアカウントの上限 {max_duration} 秒)")

    init = api_post(token, "/v2/post/publish/video/init/", {
        "post_info": {
            "title": caption,
            "privacy_level": args.privacy,
            "disable_comment": False,
            "disable_duet": False,
            "disable_stitch": False,
        },
        "source_info": {
            "source": "FILE_UPLOAD",
            "video_size": size,
            "chunk_size": chunk_size,
            "total_chunk_count": len(ranges),
        },
    })
    publish_id = init["publish_id"]

    with open(args.video, "rb") as f:
        for start, end in ranges:
            f.seek(start)
            status, body = http("PUT", init["upload_url"], {
                "Content-Type": "video/mp4",
                "Content-Range": f"bytes {start}-{end}/{size}",
            }, f.read(end - start + 1))
            if status not in (201, 206):
                sys.exit(f"アップロードに失敗しました (HTTP {status}, publish_id={publish_id}): {body[:300]!r}")

    # TikTok 側の処理完了を待つ
    for _ in range(40):
        state = api_post(token, "/v2/post/publish/status/fetch/", {"publish_id": publish_id})
        if state["status"] in ("PUBLISH_COMPLETE", "FAILED"):
            break
        time.sleep(15)
    print(json.dumps({"publish_id": publish_id, **state}, ensure_ascii=False))
    if state["status"] != "PUBLISH_COMPLETE":
        sys.exit(1)


def cmd_status(args):
    state = api_post(access_token(), "/v2/post/publish/status/fetch/", {"publish_id": args.publish_id})
    print(json.dumps(state, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description="TikTok 動画投稿ツール")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("auth-url").set_defaults(func=cmd_auth_url)

    p = sub.add_parser("exchange")
    p.add_argument("code")
    p.set_defaults(func=cmd_exchange)

    p = sub.add_parser("frames")
    p.add_argument("video")
    p.add_argument("--out", default="frames")
    p.add_argument("--count", type=int, default=8)
    p.set_defaults(func=cmd_frames)

    p = sub.add_parser("post")
    p.add_argument("video")
    p.add_argument("--caption", required=True, help="説明文とハッシュタグ")
    p.add_argument("--privacy", default="SELF_ONLY",
                   help="SELF_ONLY (非公開) / PUBLIC_TO_EVERYONE (公開) など。審査前は SELF_ONLY のみ")
    p.add_argument("--dry-run", action="store_true", help="送信せず内容だけ確認する")
    p.set_defaults(func=cmd_post)

    p = sub.add_parser("status")
    p.add_argument("publish_id")
    p.set_defaults(func=cmd_status)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
