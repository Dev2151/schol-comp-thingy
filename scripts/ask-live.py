#!/usr/bin/env python3
"""
Simple CLI ask: shows node status briefly, prompt and answer as plain text.
No animations.
"""
import json, os, re, socket, subprocess, sys

LLAMA = os.path.expanduser("~/llamacpp/llama-b11191/llama-cli")
MODEL = os.path.expanduser("~/models/qwen25-3b.gguf")
RPC = "127.0.0.1:19556"


def node_status(timeout=2.0):
    try:
        s = socket.create_connection(("127.0.0.1", 9666), timeout=timeout)
        s.sendall(b"STATUS")
        data = s.recv(65536).decode()
        s.close()
        return json.loads(data.split("\n")[0])
    except Exception:
        return None


def main():
    question = sys.argv[1] if len(sys.argv) > 1 else "Hello"
    try:
        max_tokens = int(sys.argv[2]) if len(sys.argv) > 2 else 80
    except ValueError:
        max_tokens = 80

    status = node_status()
    if status:
        layers = status.get("layers") or {}
        print(
            f"[node {status.get('hostname','?')} | "
            f"{layers.get('model','?')} layers {layers.get('range','?')} | "
            f"connected]"
        )
    else:
        print("[node offline - answering coordinator-only]")

    env = dict(os.environ)
    env["LD_LIBRARY_PATH"] = os.path.expanduser("~/llamacpp/llama-b11191")

    proc = subprocess.run(
        [LLAMA, "-m", MODEL, "--rpc", RPC, "-p", question,
         "-n", str(max_tokens), "--temp", "0", "-st", "--log-disable"],
        capture_output=True, text=True, env=env,
    )
    raw = proc.stdout

    # answer = last '> ' prompt echo block, minus stats/exit lines
    parts = re.split(r"\n> ", raw)
    answer = parts[-1] if len(parts) > 1 else raw
    answer = "\n".join(answer.split("\n")[1:])
    answer = re.split(r"\n\[ Prompt:", answer)[0]
    answer = re.split(r"\nExiting", answer)[0]
    print(question)
    print(answer.strip())


if __name__ == "__main__":
    main()
