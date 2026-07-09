#!/usr/bin/env python3
"""
GitHub Actions: DepotDownloader helper
Usage:
  python3 download.py download-dd                       # Fetch DepotDownloader binary
  python3 download.py fetch-data <path>                 # Decode base64 data/ file → release_data/
  python3 download.py run <appid> '<depots_json>'       # Download depots (参数模式)
  python3 download.py package <appid>                   # Package output into game.zip
  python3 download.py delete-data <path>                # Delete data file after run
"""
import json, os, subprocess, sys, shutil, urllib.request, urllib.error, time

RELEASE_DIR = "release_data"
OUT_DIR = "output"
DD_PATH = "depotdownloader/DepotDownloader"
ZIP_NAME = "game.zip"

def log(msg):
    print(msg, flush=True)

def gh(*args, capture=False, check=True):
    """Run `gh` CLI (available in GitHub Actions)."""
    cmd = ["gh"] + list(args)
    if capture:
        return subprocess.run(cmd, capture_output=True, text=True, check=check)
    return subprocess.run(cmd, check=check)

# ── Step 1: Download DepotDownloader ──────────────────────

def download_dd():
    log("::group::Fetch DepotDownloader")
    api_url = "https://api.github.com/repos/SteamRE/DepotDownloader/releases/latest"
    dl_url = None

    try:
        req = urllib.request.Request(api_url)
        req.add_header("Accept", "application/vnd.github+json")
        resp = urllib.request.urlopen(req, timeout=15)
        data = json.loads(resp.read().decode())
        for a in data.get("assets", []):
            n = a["name"].lower()
            if "linux" in n and "x64" in n and n.endswith(".zip"):
                dl_url = a["browser_download_url"]
                break
    except Exception as e:
        log(f"  API: {e}")

    if not dl_url:
        dl_url = ("https://github.com/SteamRE/DepotDownloader/releases/download/"
                  "DepotDownloader_2.5.0/DepotDownloader-linux-x64.zip")
        log(f"  Fallback: {dl_url}")

    log(f"  URL: {dl_url}")
    urllib.request.urlretrieve(dl_url, "dd.zip")
    subprocess.run(["unzip", "-o", "dd.zip", "-d", "depotdownloader/"],
                   capture_output=True, check=True)
    os.chmod(DD_PATH, 0o755)

    v = subprocess.run([DD_PATH, "--version"],
                       capture_output=True, text=True, timeout=10)
    log(f"  ✅ {v.stdout.strip() or v.stderr.strip() or 'ready'}")
    log("::endgroup::")

# ── Step 2: Fetch data file (base64) ────────────────────────

def fetch_data(path):
    """Read base64 file from repo data/, decode → ZIP → extract."""
    log("::group::Fetch data file")
    os.makedirs(RELEASE_DIR, exist_ok=True)

    log(f"  Path: {path}")
    if not os.path.exists(path):
        log(f"  ⚠️ File not found at {path}")
        sys.exit(1)

    with open(path, 'r') as f:
        b64 = f.read().strip()

    import base64
    try:
        raw = base64.b64decode(b64)
    except Exception as e:
        log(f"  ❌ base64 decode failed: {e}")
        sys.exit(1)

    zip_path = os.path.join(RELEASE_DIR, "data.zip")
    with open(zip_path, 'wb') as f:
        f.write(raw)
    log(f"  ✅ Decoded {len(raw)} bytes")

    # Extract
    subprocess.run(["unzip", "-o", zip_path, "-d", RELEASE_DIR],
                   capture_output=True, check=True)
    os.remove(zip_path)
    log(f"  ✅ Extracted to {RELEASE_DIR}/")
    for f in sorted(os.listdir(RELEASE_DIR)):
        fp = os.path.join(RELEASE_DIR, f)
        if os.path.isfile(fp):
            log(f"    {f} ({os.path.getsize(fp)} bytes)")

    depots_json_path = os.path.join(RELEASE_DIR, "depots.json")
    if os.path.exists(depots_json_path):
        with open(depots_json_path) as f:
            depots = json.load(f)
        log(f"  ✅ depots.json: {len(depots)} depots")
    else:
        log("  ⚠️ depots.json not found in asset")

    log("::endgroup::")

# ── Step 5: Delete data file ─────────────────────────────

def delete_data(path):
    """Remove the data file from the repo after workflow completes."""
    log("::group::Cleanup data file")
    try:
        r = subprocess.run(["gh", "api", "-X", "DELETE",
                           f"/repos/CheckCheats/DDGameBox/contents/{path}"],
                           capture_output=True, text=True, check=False)
        if r.returncode == 0:
            log(f"  ✅ Deleted {path}")
        else:
            log(f"  ⚠️ gh api failed: {r.stderr.strip()}")
            # Try git rm
            subprocess.run(["git", "rm", path, "--ignore-unmatch"],
                           capture_output=True, check=False)
            subprocess.run(["git", "commit", "-m", f"Cleanup {path}"],
                           capture_output=True, check=False)
            subprocess.run(["git", "push"], capture_output=True, check=False)
            log(f"  ✅ Deleted via git rm: {path}")
    except Exception as e:
        log(f"  ⚠️ Cleanup: {e}")
    log("::endgroup::")


# ── Step 3: Run DepotDownloader ───────────────────────────

def run_download(appid, depots_json_str):
    """Download depots. depots_json_str is optional — if empty, read from release_data/."""
    if not os.path.exists(DD_PATH):
        log("::error::DepotDownloader not found — run download-dd first")
        sys.exit(1)

    # Determine depot list from parameter or release data
    depots = None
    if depots_json_str and depots_json_str.strip():
        depots = json.loads(depots_json_str)
        log(f"📋 参数模式: {len(depots)} depots")
    else:
        rj = os.path.join(RELEASE_DIR, "depots.json")
        if os.path.exists(rj):
            with open(rj) as f:
                depots = json.load(f)
            log(f"📋 Release mode: {len(depots)} depots (from release_data/)")
        else:
            log("::error::No depots_json param and no release_data/depots.json")
            sys.exit(1)

    os.makedirs(OUT_DIR, exist_ok=True)

    # Count existing size
    total_before = 0
    for dp, _, fs in os.walk(OUT_DIR):
        for f in fs:
            fp = os.path.join(dp, f)
            total_before += os.path.getsize(fp)

    for d in depots:
        did = str(d["id"])
        mid = d.get("manifestId", "")
        key = d.get("key", "")

        if not mid:
            log(f"  ⚠️ Depot {did}: no manifest ID, skipping")
            continue

        cmd = [DD_PATH, "-app", appid, "-depot", did,
               "-manifest", mid,
               "-dir", OUT_DIR,
               "-username", "anonymous"]
        if key:
            cmd.extend(["-depot-key", key])

        # Check if we have manifest file on disk (Release mode)
        mf_path = os.path.join(RELEASE_DIR, "manifests", f"{did}_{mid}.manifest")
        if os.path.exists(mf_path):
            # Use file-based manifest for reliability
            cmd = [DD_PATH, "-app", appid, "-depot", did,
                   "-manifest-file", mf_path,
                   "-dir", OUT_DIR,
                   "-username", "anonymous"]
            if key:
                cmd.extend(["-depot-key", key])
            log(f"  ▶ {did}  (manifest-file, {os.path.getsize(mf_path)} bytes)")
        else:
            log(f"  ▶ {did}  (manifest-id={mid})")

        sys.stdout.flush()

        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
            for line in result.stdout.strip().split("\n")[-20:]:
                if line.strip():
                    log(f"    {line.strip()}")
            if result.stderr:
                for line in result.stderr.strip().split("\n")[-5:]:
                    if line.strip():
                        log(f"    ! {line.strip()}")
            if result.returncode == 0:
                log(f"  ✅ Depot {did} OK")
            else:
                log(f"  ⚠️ Depot {did} exit={result.returncode}")
        except subprocess.TimeoutExpired:
            log(f"  ⚠️ Depot {did} timed out (30 min)")
        except Exception as e:
            log(f"  ❌ Depot {did}: {e}")

        sys.stdout.flush()

    # Summary
    total_after = 0
    file_count = 0
    for dp, _, fs in os.walk(OUT_DIR):
        for f in fs:
            if not f.endswith(".manifest"):
                fp = os.path.join(dp, f)
                total_after += os.path.getsize(fp)
                file_count += 1

    downloaded = total_after - total_before
    log(f"\n  📦 Downloaded: {downloaded/1024/1024:.1f} MB ({file_count} files total)")

# ── Step 4: Package ──────────────────────────────────────

def package(appid):
    os.makedirs(OUT_DIR, exist_ok=True)

    # Strip .manifest metadata files
    for dp, _, fs in os.walk(OUT_DIR):
        for f in fs:
            if f.endswith(".manifest"):
                os.remove(os.path.join(dp, f))

    file_count = sum(1 for _, _, fs in os.walk(OUT_DIR) for f in fs)
    if file_count == 0:
        log("::warning::No game files — creating placeholder")
        with open(os.path.join(OUT_DIR, "README.txt"), "w") as f:
            f.write("No files were downloaded.\n")
            f.write("Possible causes:\n")
            f.write("  - Invalid or expired manifest ID\n")
            f.write("  - Wrong depot key\n")
            f.write("  - Anonymous download not allowed for this depot\n")

    shutil.make_archive(ZIP_NAME.replace(".zip", ""), "zip", OUT_DIR)
    size = os.path.getsize(ZIP_NAME)
    log(f"  📦 Package: {ZIP_NAME} ({size/1024/1024:.1f} MB)")

    # Show top-level contents
    log("  📋 Contents (top 20 files):")
    entries = []
    for dp, _, fs in os.walk(OUT_DIR):
        for f in fs:
            fp = os.path.join(dp, f)
            rel = os.path.relpath(fp, OUT_DIR)
            entries.append((rel, os.path.getsize(fp)))
    entries.sort(key=lambda x: -x[1])
    for name, sz in entries[:20]:
        log(f"    {name} ({sz/1024:.1f} KB)" if sz < 1024*1024 else f"    {name} ({sz/1024/1024:.1f} MB)")

# ── Main
if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: download.py <command> [args...]", file=sys.stderr)
        sys.exit(1)

    cmd = sys.argv[1]
    if cmd == "download-dd":
        download_dd()
    elif cmd == "fetch-data":
        if len(sys.argv) < 3:
            print("Usage: download.py fetch-data <path>", file=sys.stderr)
            sys.exit(1)
        fetch_data(sys.argv[2])
    elif cmd == "run":
        if len(sys.argv) < 3:
            print("Usage: download.py run <appid> '[<depots_json>]'", file=sys.stderr)
            sys.exit(1)
        appid = sys.argv[2]
        depots_json = sys.argv[3] if len(sys.argv) > 3 else ""
        run_download(appid, depots_json)
    elif cmd == "package":
        package(sys.argv[2] if len(sys.argv) > 2 else "game")
    elif cmd == "delete-data":
        if len(sys.argv) < 3:
            print("Usage: download.py delete-data <path>", file=sys.stderr)
            sys.exit(1)
        delete_data(sys.argv[2])
    else:
        print(f"Unknown command: {cmd}", file=sys.stderr)
        sys.exit(1)
