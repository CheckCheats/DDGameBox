#!/usr/bin/env python3
"""
GitHub Actions helper: DepotDownloader + manifest processing
Called from .github/workflows/steam-downloader.yml
"""
import json, base64, os, subprocess, sys, urllib.request, urllib.error, shutil

ACTIONS_STEP_DEBUG = os.environ.get("ACTIONS_STEP_DEBUG", "").lower() == "true"

def log(msg):
    print(msg, flush=True)

def debug(msg):
    if ACTIONS_STEP_DEBUG:
        print(f"[DEBUG] {msg}", flush=True)

# ──────────────────────────────────────────────
# Step 1: Prepare — write manifest files + env
# ──────────────────────────────────────────────
def cmd_prepare(request_id):
    req_path = f"requests/{request_id}.json"
    log(f"Reading {req_path}...")
    with open(req_path) as f:
        data = json.load(f)

    appid = data["appid"]
    keys  = data.get("keys", {})
    manifests = data.get("manifests", [])
    depots    = data.get("depots", [])

    # Set env for later steps
    env_out = os.environ.get("GITHUB_ENV", "")
    if env_out:
        with open(env_out, "a") as envf:
            envf.write(f"APPID={appid}\n")
            envf.write(f"KEYS_JSON={json.dumps(keys)}\n")
    else:
        os.environ["APPID"] = appid
        os.environ["KEYS_JSON"] = json.dumps(keys)

    # Write manifest files
    os.makedirs("manifests", exist_ok=True)
    depot_map = {}
    for m in manifests:
        fname = m["filename"]
        raw = base64.b64decode(m["content_b64"])
        with open(f"manifests/{fname}", "wb") as fout:
            fout.write(raw)
        did = str(m.get("depotId", ""))
        depot_map[did] = fname
        size_kb = len(raw) / 1024
        log(f"  ✓ {fname} ({size_kb:.1f} KB)")

    # Write depot_map to env
    depot_map_json = json.dumps(depot_map)
    if env_out:
        with open(env_out, "a") as envf:
            envf.write(f"DEPOT_MAP={depot_map_json}\n")
    else:
        os.environ["DEPOT_MAP"] = depot_map_json

    log(f"AppID: {appid}, Keys: {len(keys)}, Manifests: {len(manifests)}, Depots: {len(depots)}")

# ──────────────────────────────────────────────
# Step 2: Download DepotDownloader binary
# ──────────────────────────────────────────────
def cmd_download_dd():
    log("Fetching latest DepotDownloader release...")
    api = "https://api.github.com/repos/SteamRE/DepotDownloader/releases/latest"
    dl_url = None

    try:
        req = urllib.request.Request(api)
        req.add_header("Accept", "application/vnd.github+json")
        # Use GITHUB_TOKEN if available for higher rate limit
        token = os.environ.get("GITHUB_TOKEN", "")
        if token:
            req.add_header("Authorization", f"Bearer {token}")
        resp = urllib.request.urlopen(req, timeout=15)
        data = json.loads(resp.read().decode())

        for asset in data.get("assets", []):
            n = asset["name"].lower()
            if "linux" in n and "x64" in n and n.endswith(".zip"):
                dl_url = asset["browser_download_url"]
                break
    except Exception as e:
        log(f"  ⚠️ Release API: {e}")

    if not dl_url:
        dl_url = (
            "https://github.com/SteamRE/DepotDownloader/"
            "releases/download/DepotDownloader_2.5.0/"
            "DepotDownloader-linux-x64.zip"
        )
        log(f"  Using fallback: {dl_url}")

    log(f"  Downloading: {dl_url}")
    urllib.request.urlretrieve(dl_url, "dd.zip")
    subprocess.run(["unzip", "-o", "dd.zip", "-d", "depotdownloader/"],
                   capture_output=True, check=True)
    os.chmod("depotdownloader/DepotDownloader", 0o755)

    # Verify
    result = subprocess.run(
        ["./depotdownloader/DepotDownloader", "--version"],
        capture_output=True, text=True, timeout=10
    )
    ver = result.stdout.strip() or result.stderr.strip() or "(unknown)"
    log(f"  ✅ DepotDownloader ready: {ver}")

# ──────────────────────────────────────────────
# Step 3: Run DepotDownloader for each depot
# ──────────────────────────────────────────────
def cmd_run(request_id):
    appid = os.environ.get("APPID", "")
    keys = json.loads(os.environ.get("KEYS_JSON", "{}"))
    depot_map = json.loads(os.environ.get("DEPOT_MAP", "{}"))

    if not appid:
        log("::error::APPID not set")
        sys.exit(1)

    dd_path = os.path.abspath("depotdownloader/DepotDownloader")
    out_dir = os.path.abspath("output")
    os.makedirs(out_dir, exist_ok=True)

    if not os.path.exists(dd_path):
        log("::error::DepotDownloader not found")
        sys.exit(1)

    total_downloaded = 0
    file_count = 0

    for did, fname in depot_map.items():
        mpath = os.path.abspath(f"manifests/{fname}")
        depot_key = keys.get(str(did), "")

        if not os.path.exists(mpath):
            log(f"  ⚠️ Manifest not found: {fname}")
            continue

        cmd = [dd_path, "-app", appid, "-depot", str(did),
               "-manifest-file", mpath,
               "-username", "anonymous",
               "-dir", out_dir,
               "-remember-password"]

        # DepotDownloader: if depot has key, it's not anonymous
        if depot_key:
            cmd.extend(["-depot-key", depot_key])
            log(f"  📥 Depot {did} (encrypted, key present)")
        else:
            log(f"  📥 Depot {did} (anonymous)")

        log(f"  ▶ Running DepotDownloader...")
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=1200)

            # Print last 30 lines
            lines = result.stdout.strip().split("\n")
            for line in lines[-30:]:
                if line.strip():
                    log(f"    {line.strip()}")

            if result.returncode == 0:
                log(f"  ✅ Depot {did} complete")
            else:
                log(f"  ⚠️ Depot {did} exit {result.returncode}")
                for line in lines[-10:]:
                    if line.strip():
                        log(f"    {line.strip()}")
        except subprocess.TimeoutExpired:
            log(f"  ⚠️ Depot {did} timed out (20 min)")
        except Exception as e:
            log(f"  ❌ Depot {did} error: {e}")

    # Count results
    for root, dirs, files in os.walk(out_dir):
        for f in files:
            fp = os.path.join(root, f)
            total_downloaded += os.path.getsize(fp)
            file_count += 1

    log(f"\n  📦 Downloaded: {total_downloaded/1024/1024:.1f} MB ({file_count} files)")

# ──────────────────────────────────────────────
# Step 4: Package into ZIP
# ──────────────────────────────────────────────
def cmd_package(request_id):
    out_dir = "output"
    zip_name = f"game-{request_id}.zip"

    if os.path.isdir(out_dir):
        # Remove .manifest files from output
        for root, dirs, files in os.walk(out_dir):
            for f in files:
                if f.endswith(".manifest"):
                    os.remove(os.path.join(root, f))

        # Check if anything remains
        has_files = any(
            f for _, _, files in os.walk(out_dir) for f in files
            if not f.endswith(".manifest")
        )
        if not has_files:
            log("::warning::No game files downloaded — creating placeholder")
            os.makedirs(out_dir, exist_ok=True)
            with open(os.path.join(out_dir, "README.txt"), "w") as f:
                f.write("No files were downloaded.\n")
                f.write("Check the workflow logs for DepotDownloader output.\n")
    else:
        log("::warning::Output directory missing")
        os.makedirs(out_dir, exist_ok=True)
        with open(os.path.join(out_dir, "README.txt"), "w") as f:
            f.write("Output directory was missing.\n")

    # Create ZIP: archive everything under output/ into game-{id}.zip in repo root
    shutil.make_archive(zip_name.replace(".zip", ""), "zip", out_dir)
    log(f"  📦 Package: {zip_name} ({os.path.getsize(zip_name)/1024/1024:.1f} MB)")

# ──────────────────────────────────────────────
# Step 5: Cleanup request file via GitHub API
# ──────────────────────────────────────────────
def cmd_cleanup(request_id):
    token = os.environ.get("GH_TOKEN", "")
    repo = os.environ.get("GITHUB_REPOSITORY", "")

    if not token or not repo:
        log("  ⚠️ No GH_TOKEN or GITHUB_REPOSITORY, skip cleanup")
        return

    url = f"https://api.github.com/repos/{repo}/contents/requests/{request_id}.json"
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Accept", "application/vnd.github+json")

    try:
        resp = urllib.request.urlopen(req)
        existing = json.loads(resp.read().decode())
        sha = existing.get("sha", "")
        if not sha:
            log("  ⚠️ No SHA, skip")
            return

        data = json.dumps({
            "message": f"cleanup: remove request {request_id}",
            "sha": sha
        }).encode()
        del_req = urllib.request.Request(url, data=data, method="DELETE")
        del_req.add_header("Authorization", f"Bearer {token}")
        del_req.add_header("Content-Type", "application/json")
        urllib.request.urlopen(del_req)
        log(f"  🧹 Request {request_id}.json deleted")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            log("  ✓ Already cleaned up")
        else:
            log(f"  ⚠️ Cleanup error: {e.code} {e.reason}")

# ──────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────
if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: download.py <command> [args...]", file=sys.stderr)
        print("Commands: prepare, download-dd, run, package, cleanup", file=sys.stderr)
        sys.exit(1)

    cmd = sys.argv[1]
    if cmd == "prepare":
        cmd_prepare(sys.argv[2])
    elif cmd == "download-dd":
        cmd_download_dd()
    elif cmd == "run":
        cmd_run(sys.argv[2])
    elif cmd == "package":
        cmd_package(sys.argv[2])
    elif cmd == "cleanup":
        cmd_cleanup(sys.argv[2])
    else:
        print(f"Unknown command: {cmd}", file=sys.stderr)
        sys.exit(1)
