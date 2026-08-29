# ⬡ Title TBD

**Distributed storage and computing platform** — spread your data across many devices instead of relying on centralized data centers.

---

## What is Title TBD?

Title TBD is a peer-to-peer application that turns multiple computers and phones into a distributed storage network. Instead of one massive data center consuming megawatts of power, Title TBD distributes storage and compute across many small devices — each contributing just a tiny fraction of resources.

### Key Features

- **Distributed File Storage** — Files are split into encrypted chunks and spread across multiple nodes
- **AES-256-GCM Encryption** — Every chunk is individually encrypted; even the nodes storing your data can't read it
- **Local AI** — Run AI models locally with Ollama (desktop) or transformers.js (mobile) — no data sent to the cloud
- **Mobile PWA** — Judges scan a QR code to try it on their phone instantly
- **Automatic Discovery** — Nodes find each other on the local network via mDNS, no configuration needed
- **Internet P2P** — Relay server enables nodes across the internet to connect

---

## Architecture

```
┌─────────────────────────────────────────────┐
│              Relay Server (Node.js)          │
│   Registration · Discovery · Chunk Proxy     │
└──────────────────────┬──────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
   ┌─────────┐   ┌─────────┐   ┌─────────┐
   │ Desktop  │   │ Desktop  │   │ Mobile  │
   │  Node A  │   │  Node B  │   │  PWA    │
   │ Ollama   │   │ Ollama   │   │ Qwen2   │
   │ 1-2GB    │   │ 1-2GB    │   │ 0.5B    │
   └─────────┘   └─────────┘   └─────────┘
```

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Desktop App | Electron + React + TypeScript |
| Mobile App | React PWA (same framework) |
| Build Tool | Vite |
| Desktop AI | Ollama (Gemma 7B, Llama 8B, etc.) |
| Mobile AI | transformers.js (Qwen2-0.5B, runs in browser) |
| Networking | TCP sockets + mDNS (LAN) + Relay server (internet) |
| Encryption | AES-256-GCM (Node.js crypto / Web Crypto API) |
| File Splitting | Custom chunker (1MB chunks) |

---

## Setup

### Prerequisites

- **Node.js** 18+ (https://nodejs.org)
- **Ollama** (optional, for desktop AI): https://ollama.com

### 1. Install Dependencies

```bash
# Root project (Electron + renderer)
npm install

# Relay server
cd relay-server && npm install && cd ..
```

### 2. Start the Relay Server

```bash
npm run relay
```

The relay server starts on port 9500. You'll see:
```
  ⬡ Title TBD Relay Server
  ──────────────────────
  Port:     9500
  Status:   http://localhost:9500/status
  Nodes:    http://localhost:9500/nodes
```

### 3. Start the Desktop App (Development)

```bash
npm run dev
```

In a separate terminal:
```bash
npx electron .
```

Or use the combined command:
```bash
npm run electron:dev
```

### 4. Start the Mobile PWA (Development)

```bash
cd mobile && npx vite --port 5174
```

Open `http://localhost:5174` on your phone (same network).

### 5. Connect Nodes

- **LAN mode**: Nodes automatically discover each other via mDNS — no configuration needed
- **Internet mode**: Connect to the relay server for nodes across different networks

---

## Project Structure

```
title-tbd/
├── package.json              # Root project config
├── tsconfig.json             # TypeScript config (renderer)
├── tsconfig.electron.json    # TypeScript config (Electron main)
├── vite.config.ts            # Vite config (Electron renderer)
│
├── shared/
│   └── types.ts              # Shared TypeScript types
│
├── electron/                 # Electron main process
│   ├── main.ts               # Entry point
│   ├── preload.ts            # IPC bridge
│   ├── ipc-handlers.ts       # IPC handler registration
│   ├── storage/
│   │   ├── chunker.ts        # File splitting/reassembly
│   │   ├── encryptor.ts      # AES-256-GCM encryption
│   │   └── manifest.ts       # FileManifest CRUD
│   ├── network/
│   │   ├── manager.ts        # Network manager
│   │   ├── discovery.ts      # mDNS node discovery
│   │   ├── tcp-server.ts     # TCP server for chunks
│   │   ├── tcp-client.ts     # TCP client for chunks
│   │   └── relay-client.ts   # Relay server client
│   └── ai/
│       ├── ollama-client.ts  # Ollama API wrapper
│       ├── pipeline.ts       # Inference pipeline
│       └── distributed.ts    # Distributed inference across nodes
│
├── renderer/                 # Electron renderer (React)
│   ├── index.html
│   ├── vite.config.ts
│   └── src/
│       ├── App.tsx
│       ├── main.tsx
│       ├── pages/
│       │   ├── Dashboard.tsx  # Node overview + QR code
│       │   ├── Chat.tsx       # AI chat interface
│       │   ├── Cluster.tsx    # Node inventory
│       │   ├── Pipeline.tsx   # Inference pipeline view
│       │   ├── Models.tsx     # Model catalog
│       │   └── Settings.tsx   # App settings
│       └── styles/
│           └── app.css
│
├── worker/                   # Worker node Electron app
│   ├── main.ts               # Worker entry point
│   ├── preload.ts            # Worker IPC bridge
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── renderer/
│       └── src/
│           └── App.tsx       # Worker UI
│
├── mobile/                   # Mobile PWA
│   ├── index.html
│   ├── manifest.json         # PWA manifest
│   ├── sw.js                 # Service worker
│   ├── vite.config.ts
│   └── src/
│       ├── App.tsx
│       ├── main.tsx
│       ├── pages/
│       │   ├── Home.tsx       # Network overview
│       │   ├── Files.tsx      # Upload/download
│       │   └── AIChat.tsx     # On-device AI
│       └── styles.css
│
├── relay-server/             # Standalone relay server
│   ├── package.json
│   └── index.ts
│
└── README.md
```

---

## How It Works

### File Upload Flow

1. User selects a file → enters an encryption password
2. File is split into **1MB chunks**
3. Each chunk is encrypted with **AES-256-GCM** (unique IV per chunk)
4. Chunks are distributed to available nodes via TCP
5. A **FileManifest** is created with all chunk locations and metadata
6. Manifest is stored locally

### File Download Flow

1. User clicks download → enters decryption password
2. App reads the **FileManifest**
3. Fetches each chunk from its node
4. Verifies **SHA-256** hash for integrity
5. **Decrypts** each chunk
6. **Reassembles** chunks in order
7. Writes the complete file to disk

### AI Integration

**Desktop (Ollama):**
- Ollama runs locally on your machine
- Supports any model: Gemma 2B, Llama 8B, Mistral, etc.
- No data leaves your computer

**Mobile (transformers.js):**
- Runs Qwen2-0.5B (~300MB) entirely in the browser
- First load downloads the model; subsequent loads use cache
- Zero API calls — everything is on-device

---

# Part 2: Distributed AI Inference

## What is this?

Title TBD now supports **distributed AI inference** — running large language models across multiple PCs on the same network by splitting model layers by available RAM. A coordinator PC orchestrates the inference while worker PCs process their assigned layers, combining RAM to run models that wouldn't fit on a single machine.

---

## How Distributed Inference Works

```
┌──────────────────────────────────────────────────┐
│                  Coordinator PC                    │
│  ┌─────────────┐  ┌──────────────────────────┐   │
│  │  Chat UI    │  │  TCP Server (port 9501)   │   │
│  │  Pipeline   │◄─┤  Model Layer Splitter     │   │
│  │  Cluster    │  │  Token Stream Broadcaster │   │
│  └─────────────┘  └──────────┬───────────────┘   │
│                               │                    │
└───────────────────────────────┼────────────────────┘
                                │ TCP / Tailscale
                    ┌───────────┴───────────┐
                    ▼                       ▼
           ┌──────────────┐       ┌──────────────┐
           │  Worker PC 1  │       │  Worker PC 2  │
           │  Layers 0-11  │       │  Layers 12-23 │
           │  Live tokens  │       │  Live tokens  │
           └──────────────┘       └──────────────┘
```

### Layer Splitting

The coordinator automatically splits model layers based on each PC's available RAM:

| Model | Total Layers | Est. Size | Coordinator (10GB free) | Worker 1 (8GB free) | Worker 2 (6GB free) |
|-------|-------------|-----------|------------------------|--------------------|--------------------|
| gemma2:2b | 18 | 1.6 GB | 18 layers | — | — |
| gemma2:9b | 26 | 5.4 GB | 7 layers | 10 layers | 9 layers |
| llama3.1:8b | 32 | 4.9 GB | 12 layers | 11 layers | 9 layers |
| qwen2.5:7b | 28 | 4.7 GB | 11 layers | 10 layers | 7 layers |
| mistral:7b | 32 | 4.4 GB | 12 layers | 12 layers | 8 layers |
| gemma2:27b | 46 | 16 GB | 14 layers | 16 layers | 16 layers |

### Protocol

1. **Worker connects** via TCP to coordinator (auto-discovered via mDNS or Tailscale)
2. **RAM query** — coordinator requests each worker's free memory
3. **Layer proposal** — coordinator calculates proportional split
4. **Assignment** — coordinator sends `ASSIGN_LAYERS` with model name and range
5. **Inference** — user sends prompt → coordinator streams tokens → broadcasts progress to workers
6. **Stop** — stopping on coordinator broadcasts `INFER_STOP` to all workers

---

## Setup (Multi-PC)

### Prerequisites

- **Node.js 18+** on all PCs
- **Ollama** installed on all PCs with the same models pulled
- **Tailscale** (recommended) or same WiFi network

### Coordinator PC

```bash
npm install
npx tsc -p tsconfig.electron.json
npx vite build
npx electron .
```

### Worker PC

```bash
cd worker
npm install
npx tsc
npx vite build
npx electron .
```

The worker auto-discovers the coordinator via mDNS (same LAN) or connects to the hardcoded Tailscale IP.

### Adding a New PC

1. Install Node.js, Ollama, and pull the same models
2. Clone this repo
3. Run the worker setup
4. The coordinator will detect it and propose a new layer split

---

## Supported Models

| Model | Parameters | Layers | RAM Needed | Distributed? |
|-------|-----------|--------|------------|-------------|
| gemma2:2b | 2B | 18 | ~1.6 GB | No (fits on one PC) |
| phi3:mini | 3.8B | 24 | ~2.2 GB | No |
| llama3.2:3b | 3.2B | 28 | ~2.0 GB | No |
| qwen2.5:7b | 7B | 28 | ~4.7 GB | Maybe |
| mistral:7b | 7B | 32 | ~4.4 GB | Maybe |
| llama3.1:8b | 8B | 32 | ~4.9 GB | Maybe |
| gemma2:9b | 9B | 26 | ~5.4 GB | Yes |
| gemma2:27b | 27B | 46 | ~16 GB | Yes (needs 2+ PCs) |
| llama3.1:70b | 70B | 80 | ~42 GB | Yes (needs 3+ PCs) |

---

## Features

- **Auto-detection** — workers appear in the cluster automatically
- **Auto-split** — layers are distributed proportionally based on free RAM
- **Live activity** — worker windows show real-time token streaming during inference
- **Stop propagation** — stopping generation on coordinator stops all workers
- **Model catalog** — browse available models with layer counts and RAM estimates
- **Dark mode** — full dark mode support across coordinator and worker
- **Tailscale support** — works across different networks via Tailscale VPN

---

## Platform Requirements

Both coordinator and worker apps are gated to:
- **OS:** Linux only
- **Distro:** Arch-based (EndeavourOS, Arch Linux, Manjaro, etc.)
- **Hardware:** Authorized ThinkPad only (hostname verified)

---

## Tech Stack (Distributed)

| Component | Technology |
|-----------|-----------|
| Coordinator | Electron + React + TypeScript |
| Worker | Electron + React + TypeScript |
| Networking | TCP sockets with length-prefixed JSON |
| Discovery | mDNS (bonjour-service) + Tailscale fallback |
| AI Backend | Ollama API (local inference) |
| Layer Splitting | Custom proportional allocator based on RAM |
| Token Streaming | Real-time broadcast to all connected workers |
