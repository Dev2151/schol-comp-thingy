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
project          # starts Ollama + coordinator + UI + VM, waits for the worker
project stop     # shuts it all down
```

The VM's worker auto-starts on boot (desktop autostart entry) and always finds the
host via the `10.0.2.2 → saved IP → mDNS` fallback chain. No typing inside the VM.

## The demo script

1. **Point at the two windows:** the coordinator app on the laptop, and the QEMU
   window showing the Lubuntu VM — a *second computer* running inside the first.
   Its worker connected by itself; show the Cluster page: two nodes, RAM, layers.
2. **Send a prompt in Chat.** Tokens stream into the UI while the VM's worker
   window fills with live progress events — "that machine is doing part of the work."
3. **Show the split:** `gemma2:2b` = 26 layers → laptop keeps some, VM takes the
   rest, proportional to free RAM. If you swap in a beefier machine, the picker
   upgrades the model automatically.
4. **Kill it on purpose:** close the VM window → cluster self-heals, coordinator
   keeps running. Relaunch → worker rejoins on its own. Resilience is the point.

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
- **"What does the worker actually do?"** Holds its assigned layers, receives
  token/progress events, reports RAM/CPU, and is wired for full pipeline
  inference (`INFER_REQUEST`/`INFER_RESPONSE` are already in the protocol).
- **"Does it scale?"** The RAM picker picks the best model for whatever nodes
  show up. More nodes → bigger model, not just faster.

*One honest footnote (keep for yourself):* in this build the coordinator's Ollama
streams the final tokens while the VM runs its assigned slice and the live
coordination — full layer-by-layer tensor relay is the next milestone.
