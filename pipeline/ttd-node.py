#!/usr/bin/env python3
"""
 Worker - terminal edition (ttd-node.py)

Zero-dependency (stdlib only) replacement for the Electron worker.
Speaks the EXACT same coordinator TCP protocol as worker/main.ts:
  length-prefixed (4-byte BE) JSON messages
  WORKER_HELLO -> WORKER_WELCOME -> ASSIGN_LAYERS -> heartbeats
  INFER_START / INFER_PROGRESS / INFER_DONE streaming (display only)

Plus a CONTROL channel (default 9666) so the node can be driven
remotely by simple text commands from the host:
  STATUS / LOGS [n] / CONNECT <ip> / LAYERS / INFER <prompt> / QUIT
"""
import json, os, socket, struct, sys, threading, time, uuid, subprocess

COORD_PORT = 9501
CTRL_PORT = 9666
DATA_DIR = os.path.expanduser("~/.ttd-node")
NODE_ID_FILE = os.path.join(DATA_DIR, "node-id")

state = {
    "status": "searching",          # searching | connecting | connected | error
    "coordinator": None,            # (ip, port)
    "layers": None,                 # {"model":..., "range":..., "n":...}
    "infer": None,                  # {"model":..., "tokens": n, "last": "..."}
    "logs": [],                     # ring buffer
    "tokens_seen": 0,
    "connected_since": None,
}
sock = None
sock_lock = threading.Lock()
start_ts = time.time()


def log(msg):
    line = time.strftime("[%H:%M:%S] ") + msg
    state["logs"].append(line)
    if len(state["logs"]) > 400:
        del state["logs"][:-400]


def node_id():
    os.makedirs(DATA_DIR, exist_ok=True)
    if os.path.exists(NODE_ID_FILE):
        return open(NODE_ID_FILE).read().strip()
    nid = str(uuid.uuid4())
    open(NODE_ID_FILE, "w").write(nid)
    return nid


def ram_info():
    try:
        info = {}
        for line in open("/proc/meminfo"):
            k, v = line.split(":")
            info[k.strip()] = int(v.split()[0]) * 1024
        return info.get("MemTotal", 0), info.get("MemAvailable", 0)
    except Exception:
        import os as o
        return o.sysconf("SC_PAGE_SIZE") * o.sysconf("SC_PHYS_PAGES"), 0


def cpu_info():
    try:
        for line in open("/proc/cpuinfo"):
            if "model name" in line:
                return line.split(":", 1)[1].strip(), os.cpu_count()
    except Exception:
        pass
    return "unknown", os.cpu_count() or 1


def send_msg(s, obj):
    data = json.dumps(obj).encode()
    with sock_lock:
        s.sendall(struct.pack(">I", len(data)) + data)


def recv_exact(rfile, n):
    buf = rfile.read(n)
    return buf


def connection_loop(ip, port):
    """Blocking coordinator session; reconnects with backoff on drop."""
    global sock
    attempt = 0
    nid = node_id()
    total, _avail = ram_info()
    cpu_model, ncpu = cpu_info()
    host = socket.gethostname()

    while True:
        try:
            state["status"] = "connecting"
            state["coordinator"] = (ip, port)
            log(f"connecting to coordinator {ip}:{port} (attempt {attempt+1})")
            s = socket.create_connection((ip, port), timeout=5)
            s.settimeout(None)
            with sock_lock:
                sock = s
            state["status"] = "connected"
            state["connected_since"] = time.time()
            log(f"connected to coordinator {ip}:{port}")

            hello = {
                "type": "WORKER_HELLO",
                "nodeId": nid,
                "hostname": host,
                "ip": local_ip(),
                "port": COORD_PORT,
                "totalRam": total,
                "freeRam": ram_info()[1],
                "cpuCount": ncpu,
                "cpuModel": cpu_model,
            }
            send_msg(s, hello)
            log("sent WORKER_HELLO")

            rfile = s.makefile("rb")
            while True:
                hdr = recv_exact(rfile, 4)
                if not hdr or len(hdr) < 4:
                    raise ConnectionError("closed")
                (mlen,) = struct.unpack(">I", hdr)
                payload = recv_exact(rfile, mlen)
                if not payload:
                    raise ConnectionError("closed mid-message")
                msg = json.loads(payload.decode())
                handle_msg(s, msg)

        except Exception as e:
            with sock_lock:
                sock = None
            state["status"] = "error"
            state["connected_since"] = None
            state["layers"] = None
            log(f"connection lost: {e}; retrying in {min(3*(attempt+1),30)}s")
            attempt += 1
            time.sleep(min(3 * attempt, 30))
            # retry last known coordinator forever
            ip, port = state["coordinator"] or (ip, port)


def handle_msg(s, msg):
    t = msg.get("type")
    if t == "WORKER_WELCOME":
        log(f"welcome: {msg.get('message','')}")
    elif t == "ASSIGN_LAYERS":
        rng = msg.get("layerRange", "0-0")
        try:
            a, b = (int(x) for x in rng.split("-"))
        except Exception:
            a, b = 0, 0
        state["layers"] = {"model": msg.get("model", "?"), "range": rng, "n": b - a + 1}
        log(f"ASSIGNED {msg.get('model')} layers {rng} ({b-a+1} layers)")
    elif t == "HEARTBEAT":
        send_msg(s, {"type": "HEARTBEAT_ACK", "nodeId": node_id(),
                     "timestamp": int(time.time() * 1000),
                     "freeRam": ram_info()[1]})
    elif t == "INFER_START":
        state["infer"] = {"model": msg.get("model", "?"), "prompt": msg.get("prompt", ""),
                          "tokens": 0, "last": ""}
        log(f"inference started on coordinator (model={msg.get('model')})")
    elif t == "INFER_PROGRESS":
        if state["infer"] is not None:
            state["infer"]["tokens"] += 1
            state["tokens_seen"] += 1
            state["infer"]["last"] = str(msg.get("token", ""))
    elif t == "INFER_DONE":
        n = 0
        if state["infer"]:
            n = state["infer"]["tokens"]
        log(f"inference done ({n} tokens streamed to this node)")
        state["infer"] = None
    elif t == "INFER_STOP":
        log("inference stopped by coordinator")
        state["infer"] = None
    else:
        log(f"unhandled message: {t}")


def local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.254.254.254", 1))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


# ---------------------------------------------------------------- control API
def ctrl_handle(cmd):
    parts = cmd.strip().split(" ", 1)
    op = parts[0].upper()
    arg = parts[1] if len(parts) > 1 else ""
    if op == "STATUS":
        up = int(time.time() - start_ts)
        return json.dumps({
            "status": state["status"],
            "coordinator": state["coordinator"],
            "layers": state["layers"],
            "infer": state["infer"],
            "tokens_seen": state["tokens_seen"],
            "uptime_s": up,
            "connected_since_s": (int(time.time() - state["connected_since"])
                                  if state["connected_since"] else None),
            "ram": dict(zip(("total", "avail"), ram_info())),
            "cpu": cpu_info(),
            "hostname": socket.gethostname(),
            "rpc_port_open": rpc_open(),
        })
    if op == "LOGS":
        n = int(arg) if arg.isdigit() else 15
        return "\n".join(state["logs"][-n:]) or "(no logs)"
    if op == "CONNECT":
        ip = arg.strip() or "10.0.2.2"
        state["coordinator"] = (ip, COORD_PORT)
        threading.Thread(target=connection_loop, args=(ip, COORD_PORT), daemon=True).start()
        return f"connecting to {ip}:{COORD_PORT}"
    if op == "LAYERS":
        return json.dumps(state["layers"])
    if op == "INFER":
        return "note: generation runs on coordinator; this node executes its layer slice via llama.cpp RPC backend on port 9555"
    if op == "PING":
        return "pong"
    if op == "QUIT":
        os._exit(0)
    return f"unknown op: {op} (try STATUS LOGS CONNECT LAYERS PING QUIT)"


def rpc_open():
    try:
        s = socket.create_connection(("127.0.0.1", 9555), timeout=1)
        s.close()
        return True
    except Exception:
        return False


def ctrl_server():
    srv = socket.socket()
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("0.0.0.0", CTRL_PORT))
    srv.listen(8)
    while True:
        c, _ = srv.accept()
        try:
            c.settimeout(3)
            data = c.recv(4096).decode(errors="replace").strip()
            if data:
                out = ctrl_handle(data)
                c.sendall(out.encode() + b"\n")
        except Exception as e:
            try:
                c.sendall(f"ERR {e}\n".encode())
            except Exception:
                pass
        finally:
            c.close()


# ---------------------------------------------------------------- dashboard UI
def render():
    total, avail = ram_info()
    cpu_model, ncpu = cpu_info()
    status = state["status"]
    layers = state["layers"]
    infer = state["infer"]

    def bar(frac, w=24):
        f = int(max(0.0, min(1.0, frac)) * w)
        return "[" + "#" * f + "-" * (w - f) + f"] {int(frac*100)}%"

    lines = []
    lines.append("=" * 62)
    lines.append(f" NODE  |  {socket.gethostname()}  |  {status.upper()}")
    lines.append("=" * 62)
    lines.append(f" coordinator : {state['coordinator'] or '-'}")
    lines.append(f" uptime      : {int(time.time()-start_ts)}s   tokens seen: {state['tokens_seen']}")
    lines.append(f" ram         : {avail/1e9:.2f} GB free / {total/1e9:.2f} GB  {bar(avail/max(total,1))}")
    lines.append(f" cpu         : {cpu_model[:34]} x{ncpu}")
    if layers:
        lines.append(f" layers      : {layers['model']}  {layers['range']}  ({layers['n']} layers)")
    else:
        lines.append(" layers      : (none assigned)")
    if infer:
        lines.append(f" inference   : {infer['model']}  tokens={infer['tokens']}  last={infer['last'][:20]!r}")
    lines.append("-" * 62)
    lines.append(" last events:")
    for l in state["logs"][-8:]:
        lines.append(" " + l[:60])
    lines.append("=" * 62)
    lines.append(f" control port: {CTRL_PORT}  |  rpc backend: 9555 {'OPEN' if rpc_open() else 'closed'}")
    return "\n".join(lines)


def dashboard():
    while True:
        sys.stdout.write("\x1b[2J\x1b[H")  # clear + home
        sys.stdout.write(render())
        sys.stdout.flush()
        time.sleep(1)


def main():
    print("ttd-node starting (terminal edition) — diagnostics only")
    threading.Thread(target=ctrl_server, daemon=True).start()
    threading.Thread(target=dashboard, daemon=True).start()
    ip = sys.argv[1] if len(sys.argv) > 1 else "10.0.2.2"
    connection_loop(ip, COORD_PORT)


if __name__ == "__main__":
    main()
