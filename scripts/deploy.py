# -*- coding: utf-8 -*-
"""
一键部署：创建 GitHub 仓库 → 推送 → 打开 Pages → 生成并打印专属地址。

用法：双击「一键部署.bat」，按提示填 3 样东西：
    GitHub 用户名 / Personal Access Token / 给仓库起个名
本机只需装了 git 和 Python，其余全自动。
"""
import os
import re
import sys
import json
import secrets
import subprocess
import urllib.request
import urllib.error
import urllib.parse
import ssl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONF_PATH = os.path.join(ROOT, "box.json")
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE
API = "https://api.github.com"


def ask(prompt, default=""):
    if default:
        s = input("%s [%s]: " % (prompt, default)).strip()
        return s or default
    while True:
        s = input("%s: " % prompt).strip()
        if s:
            return s


def api(method, path, token, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        API + path, data=data, method=method,
        headers={
            "Authorization": "Bearer " + token,
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "tvbox-private-deploy",
            "X-GitHub-Api-Version": "2022-11-28",
        })
    try:
        with urllib.request.urlopen(req, context=CTX, timeout=25) as f:
            raw = f.read().decode()
            return f.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"message": raw[:300]}
    except Exception as e:
        return 0, {"message": str(e)}


def redact(text):
    """把可能出现在 git 输出里的 token 抹掉，绝不让它打到用户屏幕或日志。"""
    if not text:
        return text
    # https://user:TOKEN@github.com/... 形式
    text = re.sub(r"(https?://[^:/\s]+:)[^@/\s]+@", r"\1***@", text)
    # 形如 ghp_xxx / github_pat_xxx 的裸 token
    text = re.sub(r"\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b",
                  "***TOKEN***", text)
    return text


def run(cmd, cwd=None, capture=True):
    r = subprocess.run(
        cmd, cwd=cwd, shell=True, text=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.STDOUT if capture else None,
        encoding="utf-8", errors="replace")
    if capture and getattr(r, "stdout", None):
        r.stdout = redact(r.stdout)
    return r


def main():
    print("=" * 62)
    print("  创建你自己的专属影视仓（只有你知道地址，一个人用）")
    print("=" * 62)
    print()

    try:
        old = json.load(open(CONF_PATH, encoding="utf-8"))
    except Exception:
        old = {}

    print("需要 3 样东西，脚本会一步步带你填：\n")
    # GitHub 用户名只允许 [A-Za-z0-9-]；仓库名会被规范化成 [A-Za-z0-9._-]。
    # 含空格/中文/大写会生成非法 URL，导致 Pages、workflow_dispatch 全灭，
    # 连打印出来的「自救链接」本身也是非法的。必须在最前面校验并拒绝。
    def valid_name(kind, v, pattern):
        if re.fullmatch(pattern, v):
            return True
        print("   %s不合法：只能含字母、数字、%s，且不能含空格/中文/符号。"
              % (kind, "连字符 -" if kind == "用户名" else "点 . _ -"))
        return False

    while True:
        print("【1/3】GitHub 用户名（github.com/你的用户名）")
        user = ask("  用户名", old.get("user", ""))
        if valid_name("用户名", user, r"[A-Za-z0-9-]+"):
            break

    print("\n【2/3】Personal Access Token（只勾 repo 权限）")
    print("  生成页面：https://github.com/settings/tokens/new")
    print("  → Note 随便写，Expiration 选 No expiration，勾选 repo")
    print("  → 拉到最底 Generate token，复制 ghp_ 开头那串")
    print("  （只在本机用于建仓和推送，不写进仓库文件）")
    token = ask("  Token", "")

    while True:
        print("\n【3/3】仓库名（随便起，别人看不出来是干嘛的）")
        repo = ask("  仓库名", old.get("repo") or ("mybox-" + secrets.token_hex(3)))
        if valid_name("仓库名", repo, r"[A-Za-z0-9._-]+"):
            break

    # 重跑必须复用旧随机目录，否则仓库里会同时留下多套 x/<rand>/，
    # 旧的那个依然公开可达，用户以为「旧地址作废」其实没有。
    sub = old.get("sub") or ("x/" + secrets.token_hex(4) + secrets.token_hex(3))
    pages = "https://%s.github.io/%s/%s" % (user, repo, sub)
    cdn = "https://cdn.jsdelivr.net/gh/%s/%s@main" % (user, repo)

    print("\n>> 检查 Token ...")
    code, me = api("GET", "/user", token)
    if code != 200:
        print("   Token 校验失败：", code, me.get("message"))
        print("   重新运行这个脚本，贴一个勾选了 repo 的新 token。")
        sys.exit(1)
    print("   已登录为：", me.get("login"))
    if str(me.get("login", "")).lower() != user.lower():
        print("   注意：token 属于 %s，但你填的用户名是 %s，已按 token 实际身份继续。"
              % (me.get("login"), user))
        user = str(me["login"])
        pages = "https://%s.github.io/%s/%s" % (user, repo, sub)
        cdn = "https://cdn.jsdelivr.net/gh/%s/%s@main" % (user, repo)

    print("\n>> 创建仓库（公开 · 免费账户 Pages 才能用）...")
    code, r = api("POST", "/user/repos", token, {
        "name": repo,
        "private": False,
        "description": "Personal media config",
        "has_issues": False,
        "has_wiki": False,
        "has_projects": False,
        "auto_init": False,
    })
    # GitHub 真实 422 响应体：
    #   重名：{"message":"Repository creation failed.",
    #          "errors":[{"message":"name already exists on this account"}]}
    #   非法名：{"message":"Repository creation failed.",
    #            "errors":[{"message":"name is invalid"}]}
    # 两者 message 完全一样、都带 errors —— 绝不能用「有 errors 就当已存在」，
    # 那只认明确的重名信号，否则非法名会被吞掉并继续部署出一个 404 地址。
    errs = r.get("errors") or []
    exists = any(
        "already exists" in str(e.get("message", "")).lower()
        or str(e.get("code", "")).lower() in ("already_exists", "name_exists")
        for e in errs if isinstance(e, dict)
    ) or "name already exists" in str(r.get("message", "")).lower()

    if code == 201:
        # 采用 GitHub 规范化后的真实名字（大写会变小写、空格会变连字符），
        # 否则 pages/cdn/API path 全用错名字。
        full = str(r.get("full_name") or "")
        if "/" in full:
            user, repo = full.split("/", 1)
            pages = "https://%s.github.io/%s/%s" % (user, repo, sub)
            cdn = "https://cdn.jsdelivr.net/gh/%s/%s@main" % (user, repo)
        print("   新建成功：", full or (user + "/" + repo))
    elif code == 422 and exists:
        print("   仓库已存在，直接复用：", user + "/" + repo)
    elif code == 409:
        print("   仓库已存在（409），直接复用：", user + "/" + repo)
    else:
        print("   建仓失败：", code, r.get("message"))
        print("   完整响应：", json.dumps(r, ensure_ascii=False)[:400])
        sys.exit(1)

    # 写配置
    cfg = {
        "user": user, "repo": repo, "sub": sub,
        "pages": pages, "cdn": cdn,
        "note": "由一键部署自动生成。填进电视的是 status.json 里的 entries.main 地址。",
    }
    with open(CONF_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)

    # 用配置里的真实地址先本地生成一遍，保证第一次推送就有完整产物
    print("\n>> 生成初始配置（拉上游 + 实测线路）...")
    env = dict(os.environ, BOX_OUT=ROOT, BOX_SUB=sub,
               BOX_PAGES=pages, BOX_CDN=cdn)
    r = subprocess.run(
        [sys.executable, os.path.join(ROOT, "scripts", "build.py")],
        cwd=ROOT, env=env, text=True, capture_output=True,
        encoding="utf-8", errors="replace")
    if r.returncode != 0:
        print((r.stdout or "") + (r.stderr or ""))
        print("   初始配置生成失败，已停止。请检查上游可用性后重跑本脚本。")
        sys.exit(1)
    print("   ", (r.stdout or "").strip()[-400:])
    # 一致性断言：读回 build.py 生成的 status.json，确认地址一致
    st_path = os.path.join(ROOT, sub, "status.json")
    try:
        _st = json.load(open(st_path, encoding="utf-8"))
        _main = _st["entries"]["main"]
        assert _main == pages + "/index.json", (_main, pages)
    except Exception as e:
        print("   地址一致性校验失败：", e)
        sys.exit(1)

    # git 初始化并推送。PAT 会短暂出现在 remote URL 里，必须用
    # try/finally 保证「无论 push 成功/失败/抛异常」都把它抹掉，
    # 否则 .git/config 会残留明文 PAT（此前只在成功路径清理）。
    print("\n>> 推送到 GitHub ...")
    clean_remote = 'git remote set-url origin "https://github.com/%s/%s.git"' % (user, repo)
    try:
        run("git init -q", cwd=ROOT)
        run('git config user.name "tvbox-bot"', cwd=ROOT)
        run('git config user.email "tvbox-bot@users.noreply.github.com"', cwd=ROOT)
        run("git checkout -q -B main", cwd=ROOT)
        remote = "https://%s:%s@github.com/%s/%s.git" % (
            urllib.parse.quote(user), urllib.parse.quote(token), user, repo)
        run("git remote remove origin", cwd=ROOT)
        run('git remote add origin "%s"' % remote, cwd=ROOT)
        # 我的专属地址.txt 抬头写着「不要外传」，绝不能被 git add -A
        # 提交进公开仓库。box.json 必须保留（workflow 要读）。
        with open(os.path.join(ROOT, ".gitignore"), "w", encoding="utf-8") as f:
            f.write("_site/\n*.pyc\n__pycache__/\n.tvbox-token\n"
                    "我的专属地址.txt\n")

        # 清掉历史随机目录，避免重跑后仓库里同时存在多套 x/<rand>/，
        # 旧地址依然公开可达。只删与当前 sub 不同的目录。
        xdir = os.path.join(ROOT, "x")
        if os.path.isdir(xdir):
            cur = os.path.basename(sub)
            for name in os.listdir(xdir):
                p2 = os.path.join(xdir, name)
                if os.path.isdir(p2) and name != cur:
                    import shutil
                    shutil.rmtree(p2, ignore_errors=True)
                    print("   已清理旧随机目录：x/" + name)

        run("git add -A", cwd=ROOT)
        run('git commit -q -m "init: personal tvbox config"', cwd=ROOT)
        p = run('git push -q -u origin main --force', cwd=ROOT)
        if p.returncode != 0:
            print("   推送失败：", redact(p.stdout or "")[-600:])
            print("   大概率是 token 权限不足，确认勾了 repo 后重跑本脚本。")
            sys.exit(1)
        print("   推送完成。")
    finally:
        run(clean_remote, cwd=ROOT)
        print("   已清理 .git/config 中的 token（含失败路径）。")
        # 显式把默认分支设为 main，避免 workflow_dispatch 因默认分支
        # 是 master 而 404（空仓库 auto_init=false 时默认分支不固定）。
        api("PATCH", "/repos/%s/%s" % (user, repo), token,
            {"default_branch": "main", "name": repo})

    # 打开 Pages，源设为 GitHub Actions。
    # 409 = Conflict（站点未创建/冲突），绝不能当成成功；只有 201/204 算数。
    # 失败后用 GET /pages 复核真实状态（用同一个 PAT），而不是靠
    # configure-pages（它的 enablement 对 GITHUB_TOKEN 必然失败）。
    print("\n>> 开启 GitHub Pages ...")
    import time as _t
    pages_ok = False
    last_code, last_msg = 0, ""
    for attempt in (1, 2, 3):
        code, r = api("POST", "/repos/%s/%s/pages" % (user, repo), token,
                      {"build_type": "workflow"})
        last_code, last_msg = code, str(r.get("message", ""))
        if code in (201, 204):
            pages_ok = True
            print("   Pages 已启用（build_type=workflow）")
            break
        if code == 409:
            # 409 可能表示站点已存在，用 GET 复核而不是直接判成功
            gcode, gr = api("GET", "/repos/%s/%s/pages" % (user, repo), token)
            if gcode == 200 and str(gr.get("build_type", "")) == "workflow":
                pages_ok = True
                print("   Pages 已存在且为 workflow 模式（409 + GET 复核）")
                break
        if attempt < 3:
            _t.sleep(2)
    if not pages_ok:
        print("   Pages 启用失败：", last_code, last_msg)
        print("   >>> 请手动做一次：Settings → Pages → Build and deployment")
        print("       Source 选 GitHub Actions。否则主地址会一直 404。")
        print("       https://github.com/%s/%s/settings/pages" % (user, repo))

    # 触发一次 workflow —— 这是「首次部署必须成功」的关键一步。
    # 之前忽略返回值，失败时用户会拿到一个永远 404 的地址。
    print("\n>> 触发首次自动构建 ...")
    dispatch_ok = False
    for attempt in (1, 2, 3):
        code, r = api("POST", "/repos/%s/%s/actions/workflows/sync.yml/dispatches"
                      % (user, repo), token, {"ref": "main"})
        if code in (204, 201, 200):
            dispatch_ok = True
            print("   已触发（workflow_dispatch）")
            break
        # 404 = workflow 文件刚 push 还没被索引，等几秒重试
        import time as _t
        _t.sleep(3)
    if not dispatch_ok:
        print("   自动触发失败：", code, r.get("message"))
        print("   >>> 请手动做一次（只需这一次）：")
        print("       https://github.com/%s/%s/actions/workflows/sync.yml" % (user, repo))
        print("       点右侧 Run workflow → Run workflow")
        print("   否则 Pages 站点不会生成，主地址会一直 404。")

    # 轮询确认 Pages 真的上线，避免把「还没建好」当成功
    # build.py 最坏耗时约 11 分钟（直播多镜像重试为主因），
    # 180 秒轮询必然落空并误报。放宽到 72×10s = 12 分钟。
    print("\n>> 等待站点上线（最多约 12 分钟，首次构建较慢）...")
    site_ok = False
    try:
        import time as _t
        import urllib.request as _u
        import ssl as _s
        _ctx = _s.create_default_context()
        _ctx.check_hostname = False
        _ctx.verify_mode = _s.CERT_NONE
        for i in range(72):
            try:
                req = _u.Request(pages + "/index.json",
                                 headers={"User-Agent": "tvbox-deploy-check",
                                          "Cache-Control": "no-cache"})
                with _u.urlopen(req, context=_ctx, timeout=8) as f:
                    body = f.read(2000).decode("utf-8", "replace")
                if f.status == 200 and body.lstrip().startswith("{"):
                    site_ok = True
                    print("   站点已上线（第 %d 次探测）" % (i + 1))
                    break
            except Exception:
                pass
            _t.sleep(10)
    except Exception:
        pass
    if not site_ok:
        print("   12 分钟内未探测到站点（首次 Actions 建站偶有排队）。")
        print("   稍后打开体检报告确认：", pages + "/status.json")
        print("   若持续 404，去 Actions 页手动 Run workflow 一次。")

    print("\n" + "=" * 62)
    if site_ok:
        print("  已实测站点可访问。填进影视仓 / TVBox 的专属地址（复制这一条）：\n")
        print("      " + pages + "/index.json")
    else:
        # 站点没就绪就别喊「搞定」——用户关窗后只看地址文件，
        # 会拿着一条 404 的地址去填电视，还以为成功了。
        print("  已提交，但主地址尚未生效（需等 Actions 首次建站）。")
        print("  现在别填主地址。稍后按下面任一方式确认：\n")
        print("      Actions：https://github.com/%s/%s/actions" % (user, repo))
        print("      体检报告：%s" % (pages + "/status.json"))
        print("\n  临时可先用备用地址（需等 jsDelivr 收录几分钟~一小时）：\n")
        print("      " + cdn + "/" + sub + "/index.json")
    print("\n  备用地址说明：jsDelivr 对 @main 有 7 天浏览器缓存 / 12 小时 CDN 缓存，")
    print("  首次需等收录、日更会滞后，仅作主地址故障时的临时兜底。")
    print("\n  查看线路体检报告：")
    print("      " + pages + "/status.json")
    if not pages_ok:
        print("\n  ⚠ Pages 未启用成功：请到 Settings → Pages → Source 选 GitHub Actions")
        print("      https://github.com/%s/%s/settings/pages" % (user, repo))
        print("      不设置的话主地址会一直 404。")
    if not dispatch_ok:
        print("\n  ⚠ 首次 workflow 没能自动触发，请手动 Run 一次（否则站点不会生成）：")
        print("      https://github.com/%s/%s/actions/workflows/sync.yml" % (user, repo))
    print("\n  以后每天北京时间 10:10 自动更新，上游挂了自动换、")
    print("  线路死了自动踢，你什么都不用管。")
    print("=" * 62)
    print("\n  仓库：https://github.com/%s/%s" % (user, repo))
    print("  随机目录：%s （只有你和电视知道，别贴到群里）" % sub)

    with open(os.path.join(ROOT, "我的专属地址.txt"), "w", encoding="utf-8") as f:
        f.write("影视仓专属接口地址（不要外传；本文件已被 .gitignore 排除，不会进公开仓库）\n\n")
        if site_ok:
            f.write("主地址（已实测可访问）：\n" + pages + "/index.json\n\n")
        else:
            f.write("主地址（暂未生效，需先完成首次 Actions 建站）：\n"
                    + pages + "/index.json\n\n")
        f.write("备用地址（临时兜底）：\n" + cdn + "/" + sub + "/index.json\n")
        f.write("  首次需等 jsDelivr 收录（几分钟~一小时），且有 7 天浏览器缓存 /\n")
        f.write("  12 小时 CDN 缓存滞后，日常请用主地址。\n\n")
        f.write("体检报告：\n" + pages + "/status.json\n\n")
        f.write("仓库：https://github.com/%s/%s\n" % (user, repo))
        f.write("手动触发（首次若地址一直 404 时用）：\n")
        f.write("https://github.com/%s/%s/actions/workflows/sync.yml\n\n" % (user, repo))
        f.write("Pages 启用：%s\n" % ("成功" if pages_ok else
                "失败 —— 请到 https://github.com/%s/%s/settings/pages 把 Source 选成 GitHub Actions"
                % (user, repo)))
        f.write("首次 workflow 自动触发：%s\n" % ("成功" if dispatch_ok else "失败，请手动触发"))
        f.write("首次站点实测可访问：%s\n" % ("是" if site_ok else "否/超时"))
        f.write("随机目录：%s\n" % sub)
    print("\n  地址也已存到 我的专属地址.txt")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n已取消。")
    except Exception as e:
        import traceback
        print("\n部署未完成，出错：", e)
        traceback.print_exc()
        print("\n请把上面的报错截图发给我，或检查网络/token 后重新双击本文件。")
        if sys.stdin.isatty():
            input("\n按回车键关闭本窗口 ...")
        sys.exit(1)          # 致命错误必须非零退出，别让 rc=0 假装成功
    if sys.stdin.isatty():
        input("\n按回车键关闭本窗口 ...")
