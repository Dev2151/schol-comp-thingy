#!/usr/bin/env bash
# 30s fallback demo — terminal only, deterministic, no Wi-Fi needed.
clear
echo "  distributed inference across consumer machines"
echo "  -------------------------------------------------------"
echo
echo "\$ start-cluster status"
~/schol-comp-thingy/scripts/start-cluster.sh status | python3 -c "
import json,sys
j=json.loads(sys.stdin.read())
print(f\"  node {j['hostname']}: {j['status']} to coordinator {j['coordinator'][0]}\")
print(f\"  holding {j['layers']['model']} layers {j['layers']['range']} ({j['layers']['n']} layers)\")
print(f\"  ram available: {j['ram']['avail']/1e9:.1f} GB   rpc backend: {'OPEN' if j['rpc_port_open'] else 'closed'}\")
"
echo
echo "\$ start-cluster ask \"What is 7 times 8? Answer with just the number.\""
export LD_LIBRARY_PATH=$HOME/llamacpp/llama-b11191
timeout 120 ~/llamacpp/llama-b11191/llama-cli -m ~/models/qwen25-3b.gguf \
  --rpc 127.0.0.1:19556 -p "What is 7 times 8? Answer with just the number." \
  -n 8 --temp 0 -st --log-disable 2>/dev/null | python3 scripts/clean-llama-output.py
echo
echo "  ↑ generated on the VM's CPU — layers offloaded over one TCP socket"
echo "  -------------------------------------------------------"
echo "\$ start-cluster ask \"Name the capital of Japan in one word.\""
timeout 120 ~/llamacpp/llama-b11191/llama-cli -m ~/models/qwen25-3b.gguf \
  --rpc 127.0.0.1:19556 -p "Name the capital of Japan in one word." \
  -n 6 --temp 0 -st --log-disable 2>/dev/null | python3 scripts/clean-llama-output.py
echo
echo "  DEMO COMPLETE — $0 infrastructure, two consumer machines." | sed 's|scripts/demo-reel.sh|$0|'
