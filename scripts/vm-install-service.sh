#!/bin/bash
# Install the worker as a systemd service inside the VM so it
# auto-starts on every boot (runs headless before login).
set -e
PW=lubuntu123
echo "$PW" | sudo -S bash -c '
cat > /etc/systemd/system/title-tbd-worker.service <<UNIT
[Unit]
Description= distributed AI worker
After=network-online.target ollama.service

[Service]
User=vmuser
WorkingDirectory=/home/vmuser/ttbd-worker/worker
Environment=COORDINATOR_IP=10.0.2.2
Environment=NODE_ENV=production
ExecStart=/usr/bin/npx electron . --disable-gpu --no-sandbox
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable title-tbd-worker.service
systemctl restart title-tbd-worker.service
'
sleep 3
systemctl --no-pager -l status title-tbd-worker.service | head -6
echo "SERVICE INSTALLED — worker auto-starts on every VM boot"
