#!/usr/bin/env python3
import os, sys, json, shutil, subprocess, tempfile, threading, urllib.request, time, socket, traceback
from http.server import HTTPServer, BaseHTTPRequestHandler

NOTES_FILE = os.path.expanduser("~/.coolbar_notes.json")
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

def load_key():
    try:
        if os.path.exists(NOTES_FILE):
            return json.load(open(NOTES_FILE)).get("gem_key","")
    except: pass
    return ""

def save_key(key):
    try:
        data = {}
        if os.path.exists(NOTES_FILE): data = json.load(open(NOTES_FILE))
        data["gem_key"] = key
        json.dump(data, open(NOTES_FILE,"w"))
    except: pass

class SetupHandler(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        if self.path == '/getkey':
            self.send_response(200); self.send_header('Content-Type','text/plain')
            self.send_header('Access-Control-Allow-Origin','*'); self.end_headers()
            self.wfile.write(load_key().encode())
        else:
            html = open(os.path.join(SCRIPT_DIR,"setup.html"), encoding="utf-8").read()
            self.send_response(200); self.send_header('Content-Type','text/html; charset=utf-8'); self.end_headers()
            self.wfile.write(html.encode())
    def do_POST(self):
        n = int(self.headers.get('Content-Length',0))
        body = self.rfile.read(n)
        if self.path == '/savekey':
            key = body.decode().strip()
            if key.startswith('AIza'): save_key(key)
            self.send_response(200); self.end_headers(); self.wfile.write(b'ok')
        elif self.path.startswith('/gemini'):
            key = load_key()
            if not key:
                self.send_response(200); self.end_headers()
                self.wfile.write(b'{"error":"No API key"}'); return
            model = "gemini-1.5-flash"
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
            try:
                req = urllib.request.Request(url, data=body, headers={"Content-Type":"application/json"})
                resp = urllib.request.urlopen(req, timeout=30)
                result = resp.read()
            except urllib.request.HTTPError as e:
                result = e.read()
            except Exception as ex:
                result = json.dumps({"error": str(ex)}).encode()
            self.send_response(200); self.send_header('Content-Type','application/json')
            self.send_header('Access-Control-Allow-Origin','*'); self.end_headers()
            self.wfile.write(result)
        else:
            self.send_response(404); self.end_headers()
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin','*')
        self.send_header('Access-Control-Allow-Methods','POST,GET,OPTIONS')
        self.send_header('Access-Control-Allow-Headers','Content-Type')
        self.end_headers()

def is_port_in_use(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('127.0.0.1', port)) == 0

def start_setup_server():
    try:
        server = HTTPServer(("127.0.0.1", 9999), SetupHandler)
        print("✅ Setup server started on http://127.0.0.1:9999")
        server.serve_forever()
    except Exception as e:
        print(f"❌ CRITICAL ERROR starting setup server: {e}")
        traceback.print_exc()
        sys.exit(1)

def wait_for_port(port, timeout=10):
    start = time.time()
    while time.time() - start < timeout:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                return True
        except:
            time.sleep(0.3)
    return False

def find_mitmdump():
    for p in [shutil.which("mitmdump"),
              "/Library/Frameworks/Python.framework/Versions/3.13/bin/mitmdump",
              "/Library/Frameworks/Python.framework/Versions/3.12/bin/mitmdump",
              os.path.expanduser("~/.local/bin/mitmdump"),
              "/usr/local/bin/mitmdump"]:
        if p and os.path.exists(p): return p
    return None

def main():
    if is_port_in_use(9999):
        print("❌ Port 9999 is already in use! Close any other CoolBar windows first.")
        print("   Run this to kill it:  sudo lsof -i :9999")
        input("Press Enter to exit...")
        sys.exit(1)

    mitmdump = find_mitmdump()
    if not mitmdump:
        print("ERROR: mitmdump not found! Run: pip3 install mitmproxy")
        sys.exit(1)

    # Start setup server in background (non-daemon so it survives)
    server_thread = threading.Thread(target=start_setup_server, daemon=False)
    server_thread.start()

    print("Waiting for setup server on port 9999...")
    if not wait_for_port(9999):
        print("❌ Setup server failed to start. Check errors above.")
        input("Press Enter to exit...")
        sys.exit(1)

    print("✅ Setup server is READY!")

    tmpdir = tempfile.mkdtemp(prefix="coolbar_")
    shutil.copy2(os.path.join(SCRIPT_DIR,"addon.py"), os.path.join(tmpdir,"addon.py"))
    shutil.copy2(os.path.join(SCRIPT_DIR,"snippet.html"), os.path.join(tmpdir,"snippet.html"))

    print("\n╔══════════════════════════════════════════╗")
    print("║         CoolBar v32 - Running!           ║")
    print("╠══════════════════════════════════════════╣")
    print("║  Proxy: 127.0.0.1:8080                   ║")
    print("║  Setup page should open automatically    ║")
    print("║  Click ✦ in SEB for Gemini               ║")
    print("╚══════════════════════════════════════════╝\n")

    subprocess.Popen(["open","http://127.0.0.1:9999"])

    # Start mitmproxy as separate process (so setup server stays alive)
    mitm_proc = subprocess.Popen([
        mitmdump,
        "--listen-host","127.0.0.1","--listen-port","8080",
        "--ssl-insecure","-s", os.path.join(tmpdir,"addon.py"),
        "--set","connection_strategy=lazy"
    ])

    print("✅ mitmproxy started successfully!")
    print("   (Leave this Terminal window open)")

    # Keep the launcher alive so setup server never dies
    try:
        server_thread.join()
    except KeyboardInterrupt:
        print("\nShutting down...")
        mitm_proc.terminate()
        sys.exit(0)

if __name__ == "__main__":
    main()
