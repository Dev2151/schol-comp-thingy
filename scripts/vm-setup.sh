#!/usr/bin/env bash
# ============================================================
# Title TBD — Worker VM setup (run INSIDE the Lubuntu VM)
# Installs Node.js + Ollama, gets the worker code (prefers the
# 9p shared folder from the host — it has the latest patches),
# builds and starts the worker. The worker auto-connects to the
# host laptop at 10.0.2.2 (the host as seen from QEMU NAT).
# ============================================================
set -e

echo "==> [1/5] Installing Node.js 20 + git (enter your sudo password if asked)"
sudo apt-get update -y
sudo apt-get install -y curl git ca-certificates rsync
if ! command -v node >/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "==> [2/5] Installing Ollama (also starts it as a service)"
if ! command -v ollama >/dev/null; then
  curl -fsSL https://ollama.com/install.sh | sh
fi
sudo systemctl enable --now ollama 2>/dev/null || (nohup ollama serve >/dev/null 2>&1 &)
sleep 2

echo "==> [3/5] Getting the worker code"
cd ~
MNT=/mnt/hostrepo
if sudo mkdir -p "$MNT" && sudo mount -t 9p -o trans=virtio,version=9p2000.L hostrepo "$MNT" 2>/dev/null; then
  echo "    Using patched code from the host 9p share"
  rsync -a --exclude node_modules --exclude dist --exclude dist-electron "$MNT/" ~/schol-comp-thingy/
  sudo umount "$MNT"
else
  echo "    9p share not available — falling back to GitHub clone"
  [ -d schol-comp-thingy ] || git clone https://github.com/Dev2151/schol-comp-thingy.git
fi
cd ~/schol-comp-thingy/worker
npm install

echo "==> [4/5] Building the worker"
npm run build || {
  echo "Build failed — installing the Electron binary manually and retrying"
  node node_modules/electron/install.js || true
  npm run build
}

echo "==> [5/5] Starting the worker (it will find the host at 10.0.2.2)"
echo "    (You can also force an IP later with: COORDINATOR_IP=<ip> npm start)"
nohup npx electron . > ~/worker.log 2>&1 &
sleep 5
tail -20 ~/worker.log

echo ""
echo "DONE. Check the coordinator app on the host — the VM should appear as a node."
echo "Worker log: ~/worker.log"
