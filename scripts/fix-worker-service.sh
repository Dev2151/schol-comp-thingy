#!/bin/bash
# Repair the worker service: Electron needs an X display; systemd has none.
# xvfb-run provides a virtual display so the worker runs headless-but-happy.
{
echo "== installing xvfb"
sudo apt-get install -y xvfb >/dev/null 2>&1
echo "xvfb: $(command -v xvfb-run || echo MISSING)"
NPX=$(command -v npx)
echo "npx: $NPX"

sudo tee /etc/systemd/system/title-tbd-worker.service >/dev/null <<UNIT
[Unit]
Description= distributed AI worker
After=network-online.target ollama.service

[Service]
User=vmuser
Environment=HOME=/home/vmuser
Environment=COORDINATOR_IP=10.0.2.2
WorkingDirectory=/home/vmuser/ttbd-worker/worker
ExecStart=/usr/bin/xvfb-run -a $NPX electron . --disable-gpu --no-sandbox
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl restart title-tbd-worker
sleep 8
echo "active: $(systemctl is-active title-tbd-worker)"
echo "== tcp 10.0.2.2:9501 test"
timeout 2 bash -c 'echo > /dev/tcp/10.0.2.2/9501' && echo OPEN || echo CLOSED
echo "== journal tail"
journalctl -u title-tbd-worker -n 6 --no-pager
} > ~/fix-status.txt 2>&1
cat ~/fix-status.txt
