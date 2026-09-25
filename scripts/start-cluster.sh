#!/usr/bin/env bash
# ============================================================
# Title TBD — start the TRUE distributed-inference cluster
#  laptop (orchestrator + its layers) <--RPC over SSH tunnel--> VM (its layers)
# Usage:
#   start-cluster            start everything (VM, rpc, tunnel, coordinator, node)
#   start-cluster stop       shut it all down
#   start-cluster ask "..."  one question through the VM-offloaded model
#   start-cluster status     VM node status via its control port (9666)
# ============================================================
set -u
DIR="$HOME/schol-comp-thingy"
LLAMA_DIR="$HOME/llamacpp/llama-b11191"
MODEL="$HOME/models/qwen25-3b.gguf"
SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p 2222"
VM_SSH="vmuser@127.0.0.1"

say(){ echo -e "\033[1;36m== $1\033[0m"; }
ok(){ echo "  ✅ $1"; }
warn(){ echo "  ⚠️  $1"; }

if [ "${1:-}" = "stop" ]; then
  say "Stopping cluster"
  pkill -f 'llama-server.*8080' 2>/dev/null; pkill -f 'llama-cli.*19556' 2>/dev/null
  pkill -f '19556:127.0.0.1:9555' 2>/dev/null && echo "  tunnel closed"
  pkill -f 'electron \.' 2>/dev/null && echo "  coordinator closed"
  pkill -f 'vite' 2>/dev/null
  export XDG_RUNTIME_DIR=/run/user/$(id -u)
  systemctl --user stop ttbd-vm 2>/dev/null && echo "  VM stopped"
  exit 0
fi

if [ "${1:-}" = "ask" ]; then
  shift
  export LD_LIBRARY_PATH="$LLAMA_DIR"
  exec "$LLAMA_DIR/llama-cli" -m "$MODEL" --rpc 127.0.0.1:19556 \
       -p "$1" -n 120 --temp 0 -st 2>/dev/null | grep -v '^$' | tail -n +2
  exit 0
fi

if [ "${1:-}" = "status" ]; then
  printf 'STATUS\n' | timeout 4 python3 -c "
import socket
s=socket.create_connection(('127.0.0.1',9666),timeout=3)
s.sendall(b'STATUS'); print(s.recv(65536).decode())"
  exit 0
fi

echo "  ╔══════════════════════════════════════════╗"
echo "  ║  TITLE TBD — true distributed inference  ║"
echo "  ╚══════════════════════════════════════════╝"

# 1. VM (kill-proof systemd user unit)
say "Starting worker VM"
export XDG_RUNTIME_DIR=/run/user/$(id -u)
if systemctl --user is-active --quiet ttbd-vm 2>/dev/null; then
  ok "VM already running"
else
  systemctl --user reset-failed ttbd-vm 2>/dev/null
  systemd-run --user --unit=ttbd-vm -p Environment="DISPLAY=:0" "$DIR/scripts/vm-run.sh" >/dev/null 2>&1
  sleep 8; ok "VM booting"
fi

# 2. wait for guest sshd
say "Waiting for guest SSH"
for i in $(seq 1 24); do
  ssh $SSH_OPTS $VM_SSH 'true' >/dev/null 2>&1 && break
  sleep 5
done
ssh $SSH_OPTS $VM_SSH 'true' >/dev/null 2>&1 && ok "guest sshd up" || warn "guest ssh not reachable"

# 3. guest rpc-server + terminal node (autostart normally handles this)
say "Ensuring guest services"
ssh $SSH_OPTS $VM_SSH '
  ss -tln | grep -q ":9555 " || { (setsid nohup /home/vmuser/start-rpc.sh >/home/vmuser/rpc/rpc.log 2>&1 &); sleep 3; }
  pgrep -f ttd-node.py >/dev/null || { (setsid nohup python3 /home/vmuser/ttd/ttd-node.py >>/home/vmuser/ttd/node.log 2>&1 &); sleep 2; }
  ss -tln | grep -q ":9555 " && echo "  rpc-server: up" || echo "  rpc-server: DOWN"
  pgrep -f ttd-node.py >/dev/null && echo "  terminal node: up" || echo "  terminal node: DOWN"
' 2>/dev/null

# 4. SSH tunnel for RPC (host -> guest 9555)
say "Opening RPC tunnel"
if ss -tln | grep -q 19556; then
  ok "tunnel already up (19556)"
else
  ssh $SSH_OPTS -f -N -L 19556:127.0.0.1:9555 $VM_SSH >/dev/null 2>&1
  sleep 1
  ss -tln | grep -q 19556 && ok "tunnel up (host 19556 -> VM 9555)" || warn "tunnel failed"
fi

# 5. ollama + coordinator + UI
say "Starting coordinator stack"
curl -s --max-time 2 localhost:11434/api/tags >/dev/null || { (setsid nohup ollama serve </dev/null >/dev/null 2>&1 & disown); sleep 3; }
ok "ollama"
[ -d "$DIR/node_modules/electron/dist/electron" ] || { ok "skipping coordinator (electron missing)"; exit 0; }
ss -tln | grep -q :5173 || (cd "$DIR" && setsid nohup npx vite </dev/null >/tmp/ttbd-vite.log 2>&1 & disown)
if ss -tln | grep -q :9501; then
  ok "coordinator already on 9501"
else
  (cd "$DIR" && setsid nohup npx electron . </dev/null >/tmp/ttbd-coord.log 2>&1 & disown)
  for i in $(seq 1 10); do sleep 2; ss -tln | grep -q :9501 && break; done
  ss -tln | grep -q :9501 && ok "coordinator on 9501" || warn "coordinator failed — check /tmp/ttbd-coord.log"
fi

# 6. wait for the terminal node to join the coordinator
say "Waiting for node hello"
for i in $(seq 1 15); do
  grep -qE 'Worker hello' /tmp/ttbd-coord.log 2>/dev/null && break
  sleep 5
done
grep -E 'Auto-assigned' /tmp/ttbd-coord.log 2>/dev/null | tail -1 | sed 's/^/     /'

echo "
  ──────────────────────────────────────────────
  CLUSTER READY
   • true layer offload : start-cluster ask \"your question\"
   • VM node status     : start-cluster status
   • VM node logs       : ssh -p 2222 vmuser@127.0.0.1 'tail /home/vmuser/ttd/node.log'
   • chat UI            : coordinator window (port 5173)
   • shut down          : start-cluster stop
  ──────────────────────────────────────────────"
