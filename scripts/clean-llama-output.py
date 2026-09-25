#!/usr/bin/env python3
"""Clean llama.cpp CLI output: keeps only the prompt echo and the answer.
Removes the ASCII logo, build banner, model info, spinner frames, the
available-commands help block, performance stats, and exit lines."""
import sys, re

out = sys.stdin.read()

# 1. cut everything up to and including the LAST '> ' prompt-echo line.
#    (that's the interactive prompt containing our question; everything
#     before it is banner/logo/model-info/help block/spinner)
idx = out.rfind("\n> ")
if idx != -1:
    out = out[idx + 1:]
else:
    # no prompt echo at all: strip known junk line-wise
    out = re.sub(r"Loading model\.[^\n]*", "", out)

# 1b. drop the interactive prompt-echo line ("> question") itself
out = re.sub(r"^> .*\n", "", out)

# 2. within the remainder, drop perf stats / exit lines / help remnants
out = re.sub(r"\[ Prompt:.*?\]\n?", "", out)
out = re.sub(r"\n?Exiting\.\.\.\n?", "", out)
out = re.sub(r"available commands:.*", "", out, flags=re.S)
out = re.sub(r"/exit or Ctrl+C.*", "", out, flags=re.S)

# 3. spinner frames (backspace sequences) anywhere
out = re.sub(r"(\|\x08|/\x08|\\\x08|-\x08)+", "", out)
out = out.replace("\b", "")

# 4. collapse blank lines
out = re.sub(r"\n{3,}", "\n\n", out)
sys.stdout.write(out.strip("\n") + "\n")
