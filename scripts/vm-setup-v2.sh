#!/bin/bash
# Worker VM setup v2 — non-interactive (sudo password embedded), installs
# Node + Ollama + the PATCHED worker code from the host tarball.
LOG=~/s2.log
exec > >(tee -a "$LOG") 2>&1
PW=lubuntu123

echo "== [1/5] base packages"
echo "$PW" | sudo -S apt-get update -y
echo "$PW" | sudo -S apt-get install -y curl git ca-certificates

if ! command -v node >/dev/null; then
  echo "== installing Node 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  echo "$PW" | sudo -S apt-get install -y nodejs
fi
node -v

echo "== [2/5] Ollama"
if ! command -v ollama >/dev/null; then
  curl -fsSL https://ollama.com/install.sh | sh
fi
sudo systemctl enable --now ollama 2>/dev/null || (nohup ollama serve >/dev/null 2>&1 &)
sleep 3

echo "== [3/5] patched worker code from host"
rm -rf ~/ttbd-worker
mkdir -p ~/ttbd-worker
curl -fsSL http://10.0.2.2:8090/worker-patched.tgz | tar -xz -C ~/ttbd-worker
ls ~/ttbd-worker

echo "== [4/5] build worker"
cd ~/ttbd-worker/worker
npm install
npm run build || { node node_modules/electron/install.js; npm run build; }

echo "== [5/5] start worker"
# --disable-gpu/--no-sandbox required inside QEMU VMs (SIGTRAP otherwise)
nohup npx electron . --disable-gpu --no-sandbox > ~/worker.log 2>&1 &
sleep 8
tail -n 15 ~/worker.log
echo "== SETUP DONE"
