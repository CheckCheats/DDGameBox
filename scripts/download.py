#!/usr/bin/env python3
"""
GitHub Actions: DepotDownloader helper
Usage:
  python3 download.py download-dd              # Fetch DepotDownloader binary
  python3 download.py run <appid> '<depots_json>'  # Download depots
  python3 download.py package <appid>          # Package output into game.zip
"""
import json, os, subprocess, sys, shutil, urllib.request

def log(msg):
    print(msg, flush=True)

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
    os.chmod("depotdownloader/DepotDownloader", 0o755)

    v = subprocess.run(["./depotdownloader/DepotDownloader", "--version"],
                       capture_output=True, text=True, timeout=10)
    log(f"  ✅ {v.stdout.strip() or v.stderr.strip() or 'ready'}")
    log("::endgroup::")

def run_download(appid, depots_json):
    depots = json.loads(depots_json)
    dd_path = os.path.abspath("depotdownloader/DepotDownloader")
    out_dir = os.path.abspath("output")
    os.makedirs(out_dir, exist_ok=True)

    log(f"AppID: {appid}, Depots: {len(depots)}")

    if not os.path.exists(dd_path):
        log("::error::DepotDownloader not found — run download-dd first")
        sys.exit(1)

    total_before = sum(
        os.path.getsize(os.path.join(dp, f))
        for dp, _, fs in os.walk(out_dir) for f in fs
    ) if os.path.isdir(out_dir) else 0

    for d in depots:
        did = str(d["id"])
        mid = d.get("manifestId", "")
        key = d.get("key", "")

        if not mid:
            log(f"  ⚠️ Depot {did}: no manifest ID, skipping")
            continue

        cmd = [dd_path, "-app", appid, "-depot", did,
               "-manifest", mid,
               "-dir", out_dir,
               "-username", "anonymous"]
        if key:
            cmd.extend(["-depot-key", key])

        label = f"Depot {did}" + (" (encrypted)" if key else " (anon)")
        log(f"  ▶ {label}  manifest={mid}")
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
    for dp, _, fs in os.walk(out_dir):
        for f in fs:
            if not f.endswith(".manifest"):
                fp = os.path.join(dp, f)
                total_after += os.path.getsize(fp)
                file_count += 1

    downloaded = total_after - total_before
    log(f"\n  📦 Downloaded: {downloaded/1024/1024:.1f} MB ({file_count} files total)")

def package(appid):
    out_dir = "output"
    zip_name = "game.zip"
    os.makedirs(out_dir, exist_ok=True)

    # Strip .manifest metadata files
    for dp, _, fs in os.walk(out_dir):
        for f in fs:
            if f.endswith(".manifest"):
                os.remove(os.path.join(dp, f))

    file_count = sum(1 for _, _, fs in os.walk(out_dir) for f in fs)
    if file_count == 0:
        log("::warning::No game files — creating placeholder")
        with open(os.path.join(out_dir, "README.txt"), "w") as f:
            f.write("No files were downloaded.\n")
            f.write("Possible causes:\n")
            f.write("  - Invalid or expired manifest ID\n")
            f.write("  - Wrong depot key\n")
            f.write("  - Anonymous download not allowed for this depot\n")

    shutil.make_archive(zip_name.replace(".zip", ""), "zip", out_dir)
    size = os.path.getsize(zip_name)
    log(f"  📦 Package: {zip_name} ({size/1024/1024:.1f} MB)")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: download.py <command> [args...]", file=sys.stderr)
        sys.exit(1)

    cmd = sys.argv[1]
    if cmd == "download-dd":
        download_dd()
    elif cmd == "run":
        if len(sys.argv) < 4:
            print("Usage: download.py run <appid> '<depots_json>'", file=sys.stderr)
            sys.exit(1)
        run_download(sys.argv[2], sys.argv[3])
    elif cmd == "package":
        package(sys.argv[2] if len(sys.argv) > 2 else "game")
    else:
        print(f"Unknown command: {cmd}", file=sys.stderr)
        sys.exit(1)
