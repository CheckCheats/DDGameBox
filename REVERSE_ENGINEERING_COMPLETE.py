# 地道游戏盒 V14 (DD Game Box V14) - Complete Reverse Engineering Analysis
# Author: 德印小馆长
# QQ群: 971469953

"""
ARCHITECTURE OVERVIEW
=====================
This is a PyInstaller-packaged Python application using PyQt6 GUI.
It downloads Steam games via DepotDownloader (ddv20.exe).

KEY COMPONENTS:
===============
"""

# =====================================================================
# 1. CONFIGURATION
# =====================================================================
BASE_DIR = None  # _MEIPASS or executable directory
CONFIG_FILE = "config.json"
DEPOT_DIR = "./DepotDownloader"

# Default config structure
DEFAULT_CONFIG = {
    "download_dir": "C:\\GAMEBOX",
    "version": "V14",
    "auto_retry": True,
}

# =====================================================================
# 2. API ENDPOINTS
# =====================================================================
STEAMCMD_API = "https://api.steamcmd.net/v1/info/{appid}"
STORE_API = "https://store.steampowered.com/api/appdetails?appids={appid}&l=english"
WUDRM_API = "http://gmrc.wudrm.com/manifest/{manifest_id}"
STEAMRUN_API = "https://manifest.steam.run/api/manifest/{manifest_id}"
STEAMOOO_API = "https://manifest.steam.ooo/{manifest_id}"
CDN_BASE = "http://steampipe.akamaized.net"

# External links
GAME_LIST_URL = "https://link3.cc/guanzhang"
QQ_GROUP_URL = "https://qm.qq.com/q/TfLRtz50cK"
BILIBILI_URL = "https://space.bilibili.com/286896221"
VERSION_URL = "https://pan.quark.cn/s/ad08ad1f1d06"

# HTTP Headers
HEADERS = {
    "User-Agent": "Valve/Steam HTTP Client 1.0",
    "Accept": "*/*",
    "Accept-Encoding": "deflate, gzip",
}

# =====================================================================
# 3. UI COLOR SCHEME (Warm Beige/Dark Gold)
# =====================================================================
C_BG = "#fef9ef"           # Main background
C_PANEL = "#fdf5e6"        # Panel background
C_TITLE_BG = "#c41e3a"     # Title bar background (red)
C_TITLE_FG = "#ffd700"     # Title text (gold)
C_BTN_IDLE = "#f0c040"     # Button idle (gold)
C_BTN_HOVER = "#e8b830"    # Button hover (darker gold)
C_BTN_OK = "#6b8e23"       # Success button (green)
C_BTN_FAIL = "#c41e3a"     # Fail button (red)
C_BTN_FG = "#3d2b1f"       # Button text (dark brown)
C_BTN_DISABLED = "#d0c8b0" # Disabled button (pale)
C_LOG_BG = "#5c3d2e"       # Log background (dark brown)
C_LOG_FG = "#d4c5a9"       # Log text (light tan)
C_LABEL = "#8b7355"        # Label text (brown)
C_LINK = "#c41e3a"         # Link color (red)
C_PROGRESS = "#6b8e23"     # Progress bar (green)
C_BORDER = "#d4c5a9"       # Border color

# =====================================================================
# 4. CORE FUNCTIONS
# =====================================================================

def get_base_dir():
    """Get application base directory (PyInstaller frozen or dev mode)"""
    import sys, os
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    else:
        return os.path.abspath(os.path.dirname(__file__))


def load_config():
    """Load config from config.json"""
    import json
    # Returns dict with defaults: download_dir='', version='V14', auto_retry=True
    ...


def save_config(config):
    """Save config to config.json"""
    import json
    ...


def get_download_path(game_name):
    """Get download path for a game (config.download_dir/game_name or C:/GAMEBOX/game_name)"""
    ...


def api_get(appid):
    """Fetch app info from SteamCMD API with caching"""
    import requests
    _api_cache = {}
    if appid in _api_cache:
        return _api_cache[appid]
    resp = requests.get(STEAMCMD_API.format(appid=appid))
    resp.raise_for_status()
    data = resp.json()
    _api_cache[appid] = data
    return data


def get_game_name_from_api(appid):
    """Get game name from Steam store API"""
    import requests
    try:
        resp = requests.get(STORE_API.format(appid=appid))
        if resp.status_code == 200:
            data = resp.json()
            return data.get(str(appid), {}).get("data", {}).get("common", {}).get("name", "")
    except:
        pass
    return ""


def fetch_latest_manifests(appid, depot_ids):
    """Fetch latest manifest IDs for given depots from SteamAPI"""
    data = api_get(appid)
    depots = data.get("data", {}).get("depots", {})
    manifests = {}
    for depot_id in depot_ids:
        depot_info = depots.get(str(depot_id), {})
        public = depot_info.get("public", {})
        if "gid" in public:
            manifests[depot_id] = public["gid"]
        elif "manifests" in depot_info:
            manifests[depot_id] = depot_info["manifests"].get("public", {}).get("gid", "")
    return manifests


def filter_windows_depots(appid, depot_ids):
    """Filter out macOS/Linux/steamchina depots"""
    data = api_get(appid)
    depots = data.get("data", {}).get("depots", {})
    result = []
    for depot_id in depot_ids:
        depot_info = depots.get(str(depot_id), {})
        config = depot_info.get("config", {})
        oslist = config.get("oslist", "")
        realm = config.get("realm", "")
        if "windows" in oslist.lower() or not oslist:
            if "steamchina" not in realm.lower():
                result.append(depot_id)
    return result


def fetch_request_code(mid):
    """Fetch request code for manifest download (multi-API fallback)"""
    import requests
    # Try steam.ooo
    resp = requests.get(STEAMOOO_API.format(manifest_id=mid))
    if resp.status_code == 200 and resp.text.strip().isdigit():
        return resp.text.strip()
    
    # Try wudrm
    resp = requests.get(WUDRM_API.format(manifest_id=mid))
    if resp.status_code == 200:
        return resp.text.strip()
    
    # Try steam.run
    resp = requests.get(STEAMRUN_API.format(manifest_id=mid))
    if resp.status_code == 200:
        data = resp.json()
        return data.get("content", "")
    
    return ""


def download_manifest(did, mid, rc, out_dir):
    """Download manifest file from Steam CDN"""
    import requests, zipfile, io, os
    url = f"{CDN_BASE}/depot/{did}/manifest/{mid}/5/{rc}"
    resp = requests.get(url, headers=HEADERS)
    resp.raise_for_status()
    
    # Handle ZIP response
    content = resp.content
    if content[:2] == b'PK':  # ZIP magic
        zf = zipfile.ZipFile(io.BytesIO(content))
        for name in zf.namelist():
            if name.endswith('.manifest'):
                with open(os.path.join(out_dir, f"{did}_{name}"), 'wb') as f:
                    f.write(zf.read(name))
    else:
        # Save as .manifest file
        filename = f"{did}_{mid}.manifest"
        with open(os.path.join(out_dir, filename), 'wb') as f:
            f.write(content)


def generate_config_vdf(info, out_dir):
    """Generate Steam config.vdf with depot decryption keys"""
    import os
    depots = info.get("depots", [])
    lines = ['"depots"', '{']
    for depot in depots:
        did = depot.get("id", "")
        sha = depot.get("sha", "")
        lines.append(f'    "{did}"')
        lines.append('    {')
        lines.append(f'        "DecryptionKey" "{sha}"')
        lines.append('    }')
    lines.append('}')
    
    with open(os.path.join(out_dir, 'config.vdf'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))


def parse_lua(content):
    """Parse SteamCMD Lua script to extract game info"""
    import re
    
    info = {
        "appid": None,
        "depots": [],
        "dlc_depots": [],
        "tokens": [],
        "dlc_only": False,
        "missing_keys": False,
    }
    
    # Extract main appid
    m = re.search(r'主游戏APPID[：:]\s*(\d+)', content)
    if m:
        info["appid"] = int(m.group(1))
    
    # Extract addappid(...) - depot entries
    for m in re.finditer(r'addappid\((\d+)\)\s*(?:--.*)?$', content, re.MULTILINE):
        info["depots"].append({"id": int(m.group(1)), "sha": None})
    
    # Check for missing keys
    if re.search(r'缺少密钥|无仓库', content):
        info["missing_keys"] = True
    
    # Extract addappid with SHA keys
    for m in re.finditer(r'addappid\((\d+),\s*\d+,\s*"([^"]*)"\)', content):
        did = int(m.group(1))
        sha = m.group(2)
        info["depots"].append({"id": did, "sha": sha})
    
    # Extract tokens
    for m in re.finditer(r'addtoken\((\d+),\s*"(\d+)"\)', content):
        info["tokens"].append({"appid": int(m.group(1)), "token": m.group(2)})
    
    return info


# =====================================================================
# 5. CLASSES
# =====================================================================

class KillThread:
    """Thread for killing the ddv20 process"""
    def __init__(self):
        pass
    
    def run(self):
        pass


class SettingsDialog(QDialog):
    """Settings dialog for configuring download path and options"""
    def __init__(self, parent=None):
        pass
    
    def browse_folder(self):
        """Browse for download directory"""
        pass
    
    def save_settings(self):
        """Save settings to config.json"""
        pass


class TaskManager:
    """Manage task statuses (save/load to task_status.json)"""
    TASK_FILE = "task_status.json"
    
    @staticmethod
    def save_task(game_name, status):
        pass
    
    @staticmethod
    def load_task(game_name):
        pass
    
    @staticmethod
    def clear_task(game_name):
        pass


class WorkerThread(QThread):
    """Background worker for game processing"""
    # Signals
    log_msg = pyqtSignal(str)           # Log message signal
    btn_color = pyqtSignal(str, str)    # Button color signal (color, text)
    info_signal = pyqtSignal(str)       # Info/status signal
    game_name_signal = pyqtSignal(str)  # Game name signal
    
    found_manifests = pyqtSignal(list)  # Found manifests signal
    ask_continue = pyqtSignal(str)      # Ask user to continue
    finished_job = pyqtSignal()         # Job finished
    
    def __init__(self, game_name, appid, depots, download_path, auto_retry=True):
        pass
    
    def run(self):
        """Main worker thread execution"""
        # 1. Log start
        # 2. _load() - load manifest info
        # 3. _install() - run ddv20.exe
        # 4. Signal completion
        pass
    
    def log(self, msg):
        """Emit log message"""
        pass
    
    def _load(self):
        """Load manifest info from APIs and local files"""
        # Try to find manifests via API
        # Download manifests if needed
        # Generate config.vdf
        # Check for local ZIP/7z/RAR compressed manifests
        pass
    
    def _do_clean(self):
        """Clean up temporary files"""
        pass
    
    def _do_load(self):
        """Load game data from APIs"""
        pass
    
    def _finish_load(self):
        """Finish loading and prepare for install"""
        pass
    
    def use_local_manifests(self):
        """Use locally saved manifest files"""
        pass
    
    def _check_manifests_in_zip(self, path):
        """Check for manifest files inside ZIP archives"""
        pass
    
    def _read_zip(self, path):
        """Read manifest from ZIP file"""
        pass
    
    def _read_7z(self, path):
        """Read manifest from 7z file"""
        pass
    
    def _read_rar(self, path):
        """Read manifest from RAR file"""
        pass
    
    def _remove_non_windows_manifests(self, manifests):
        """Remove non-Windows depot manifests"""
        pass
    
    def _install(self):
        """Run ddv20.exe to install the game"""
        pass
    
    def _install_local(self):
        """Install from local manifest files"""
        pass
    
    def _clear(self):
        """Clear temporary files"""
        pass


class ColorButton(QPushButton):
    """Custom styled QPushButton with color management"""
    DEFAULT_IDLE = "#f0c040"
    DEFAULT_FG = "#3d2b1f"
    
    def __init__(self, text, parent=None):
        pass
    
    def _apply_style(self, bg, fg=C_BTN_FG):
        """Apply CSS style to button"""
        pass
    
    def set_color(self, color):
        """Set button background color"""
        pass
    
    @staticmethod
    def _darken(hex_color, factor=0.8):
        """Darken a hex color by a factor"""
        pass


class MainWindow(QMainWindow):
    """Main application window"""
    def __init__(self):
        super().__init__()
        self.setup_ui()
        self.worker = None
        self.ddv_process = None
        self.download_path = get_download_path("")
    
    def setup_ui(self):
        """Set up the main UI layout"""
        # Title bar with app name
        # Game info area (name, progress)
        # Download/install/pause buttons
        # File load button (for .lua / .manifest)
        # Log output area
        # Bottom bar with settings, links
        pass
    
    def closeEvent(self, event):
        """Handle window close - kill processes"""
        pass
    
    def open_settings(self):
        """Open settings dialog"""
        pass
    
    def open_game_list(self):
        """Open game list URL in browser"""
        pass
    
    def log(self, msg):
        """Add message to log area"""
        pass
    
    def update_progress(self, value):
        """Update progress bar"""
        pass
    
    def set_info(self, text):
        """Set info/status text"""
        pass
    
    def set_game_name(self, name):
        """Set game name label"""
        pass
    
    def set_btn_color(self, color, text):
        """Set download button color"""
        pass
    
    def set_buttons_enabled(self, enabled):
        """Enable/disable action buttons"""
        pass
    
    def load_file(self):
        """Open file dialog to load .lua or .manifest files"""
        pass
    
    def toggle_download(self):
        """Handle download button click"""
        pass
    
    def start_install(self):
        """Start installation process"""
        pass
    
    def pause_download(self):
        """Pause active download"""
        pass
    
    def _set_downloading_ui(self, active):
        """Toggle UI between idle and downloading states"""
        pass
    
    def _reset_download_ui(self):
        """Reset UI to idle state"""
        pass
    
    def clear_cache(self):
        """Clear temporary cache/files"""
        pass
    
    def on_start_ddv(self):
        """Start DepotDownloader process"""
        pass
    
    def _start_ddv_process(self):
        """Launch ddv20.exe with appropriate arguments"""
        pass
    
    def _on_stdout(self):
        """Handle ddv20.exe stdout"""
        pass
    
    def _on_stderr(self):
        """Handle ddv20.exe stderr"""
        pass
    
    def _on_ddv_error(self):
        """Handle ddv20.exe error"""
        pass
    
    def _on_ddv_finished(self):
        """Handle ddv20.exe completion"""
        pass
    
    def _try_auto_retry(self):
        """Attempt automatic retry on failure"""
        pass
    
    def _auto_retry_download(self):
        """Execute auto-retry download"""
        pass
    
    def _run_worker(self, game_name, appid, depots):
        """Create and start a WorkerThread"""
        pass
    
    def _on_found_manifests(self, manifests):
        """Handle found manifests"""
        pass
    
    def _on_ask_continue(self, question):
        """Handle continue question"""
        pass


# =====================================================================
# 6. MAIN ENTRY POINT
# =====================================================================
if __name__ == "__main__":
    from PyQt6.QtWidgets import QApplication
    import sys
    
    # Ensure requests is installed
    try:
        import requests
    except ImportError:
        import subprocess, sys
        subprocess.check_call([sys.executable, "-m", "pip", "install", "requests"])
        import requests
    
    app = QApplication(sys.argv)
    app.setStyle("Fusion")
    
    window = MainWindow()
    window.show()
    
    sys.exit(app.exec())


# =====================================================================
# 7. ddv20.exe - DepotDownloader Integration
# =====================================================================
# ddv20.exe is a Steam DepotDownloader v2.0
# Usage: ddv20.exe -app <appid> -depot <depotid1> -depot <depotid2> ... 
#                  -manifest <manifest1> -manifest <manifest2> ...
#                  -dir <output_dir> -username <username> -password <password>
#
# Key arguments:
#   -app <appid>           Steam app ID
#   -depot <depotid>        Steam depot ID (repeatable)
#   -manifest <id>          Manifest ID per depot
#   -dir <path>             Output directory
#   -username <user>        Steam username (anonymous login supported)
#   -password <pass>        Steam password
#   -remember-password      Remember login
#   -language <lang>         Game language
#   -os <os>                Target OS (windows)
#   -all-platforms          Download all platforms
#   -validate               Validate existing files
#   -max-servers <n>        Max download servers
#   -max-downloads <n>      Max concurrent downloads
