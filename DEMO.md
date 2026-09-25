# Title TBD — Live Demo Guide

**The pitch (30 seconds):**
> AI answers feel free, but they're not — one chatbot query burns ~10× the energy
> of a web search, and all that compute concentrates in giant data centers that
> drink a city's water. Our fix: don't concentrate it. *Distribute it.* Three
> students with old laptops can run an AI model none of them could run alone —
> no data center, no subscription, and it even works offline.

---

## How it works (one paragraph)

Every device runs the app. One is the **coordinator** (the laptop with the chat UI),
the others are **workers**. A worker dials *out* to the coordinator over one TCP
connection (port 9501) — that direction matters, it punches through every NAT, hotel
Wi-Fi, school network, or Tailscale tunnel with zero config. The coordinator reads
each machine's **real available RAM**, picks the biggest model that fits on *every*
node, and splits the model's layers across the cluster. When you send a prompt, the
machines process their layers in sequence and tokens stream to everyone, live.

## The one command

```bash
start-cluster            # VM + rpc backend + tunnel + coordinator, waits for the node
start-cluster ask "..."  # question through the model whose layers RUN IN THE VM
start-cluster status     # live node status (layers held, RAM, connection)
start-cluster stop       # shut it all down
```

The VM's worker auto-starts on boot (desktop autostart entry) and always finds the
host via the `10.0.2.2 → saved IP → mDNS` fallback chain. No typing inside the VM.

## The demo script

1. **Point at the two windows:** the coordinator app on the laptop, and the QEMU
   window showing the Lubuntu VM running its **terminal node** (`ttd-node.py`) —
   a live diagnostic dashboard: connection status, layer assignment, RAM bar,
   event log. No GUI app needed in the node; the terminal IS the UI.
2. **`start-cluster ask "What is 7 times 8?"`** → `56`. The point: the model's
   layers are OFFLOADED to the VM via llama.cpp's RPC backend (MIT) — the laptop
   orchestrates, the VM computes its layer range on its own CPU, activations
   cross the wire token by token. This is true pipeline offload, not a
   simulation. Verified answers: 7×8 → 56, Japan → Tokyo, plus coherent
   long-form answers about distributed computing.
3. **Show the split:** the coordinator's RAM picker auto-assigns layers
   (e.g. gemma2:2b → VM holds L8-25) and the node's dashboard displays the
   assignment live. More free RAM on a node → bigger model picked.
4. **Kill it on purpose:** close the VM → coordinator keeps running; the node
   reconnects with backoff when it returns. `start-cluster status` shows it all.

## Facts to drop (from the README)

- ~2.9 Wh per AI query vs ~0.3 Wh per search (~10×); 4%+ of US electricity;
  29+ billion liters of drinking water a year at Google alone.
- 95% of enterprise AI pilots fail; $700B invested in 2025 with ~zero GDP effect.
- Apple's AI summarized BBC news into a fake headline; CBSE's rushed digitization
  of 1.7M exam papers collapsed. The pattern: **concentrate first, fix later.**
- Our pattern instead: small, local, edge-first. A classroom of laptops is already
  the data center — idle. This puts it to work.

## Q&A armor

- **"Where does the model run?"** Locally, on the cluster. No cloud, no API keys.
  Works with Wi-Fi off.
- **"Why not just use a big server?"** A big server concentrates power, water,
  heat, and failure. We distribute all four — and scale by adding a laptop,
  not building a facility.
- **"What does the worker actually do?"** In the true-offload path, it literally
  computes its assigned layers of the GGUF model (llama.cpp RPC backend, MIT
  licensed) and ships intermediate activations back over the wire — salvaged
  from upstream llama.cpp rather than reinvented. The custom `ttd-node.py`
  terminal app adds cluster membership, diagnostics, and the coordinator
  protocol (hello/assign/heartbeat) on top.
- **"Does it scale?"** The RAM picker picks the best model for whatever nodes
  show up. More nodes → bigger model, not just faster. (Design notes: Exo's
  zero-config discovery and Petals' layer-routing are the upstream patterns
  this architecture follows.)

*Footnote:* two engines, two jobs — the Electron coordinator runs the chat UI
and cluster bookkeeping (Ollama), while the *true* tensor relay runs on
llama.cpp's RPC backend with the terminal node in the VM. Both are open source;
neither was reinvented.
