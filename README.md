# ⬡ FreeGrid

**Distributed storage and computing platform** — spread your data across many devices instead of relying on centralized data centers.

---

## What is FreeGrid?

FreeGrid is a peer-to-peer application that turns multiple computers and phones into a distributed storage network. Instead of one massive data center consuming megawatts of power, FreeGrid distributes storage and compute across many small devices — each contributing just a tiny fraction of resources.

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
  ⬡ FreeGrid Relay Server
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
freegrid/
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
│       └── ollama-client.ts  # Ollama API wrapper
│
├── renderer/                 # Electron renderer (React)
│   ├── index.html
│   ├── vite.config.ts
│   └── src/
│       ├── App.tsx
│       ├── main.tsx
│       ├── pages/
│       │   ├── Dashboard.tsx  # Node overview + QR code
│       │   ├── Files.tsx      # Upload/download files
│       │   └── AIChat.tsx     # Local AI chat
│       └── styles/
│           └── app.css
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

## Demo Script (For Competition)

### Setup
1. Start relay server
2. Open FreeGrid on 2-3 laptops → nodes auto-discover
3. Each offers 1-2GB of storage
4. Desktop displays QR code on Dashboard

### Live Demo

**Part 1: Distributed Storage**
1. "I'll upload a file from my phone" → scan QR → PWA opens
2. Upload a photo → watch it split and distribute
3. Show encrypted chunks on laptops (unreadable gibberish)
4. Download the file on a different laptop → reassembled perfectly

**Part 2: Local AI on Phone**
1. Open AI Chat on the phone
2. First time: model downloads (~300MB)
3. Ask a question → response generated on the phone
4. "No data sent to OpenAI, Google, or anyone"

**Part 3: The Point**
1. "Each laptop uses ~50 watts. A data center uses megawatts."
2. "By distributing storage, we reduce集中能耗"
3. "Your data is encrypted — even the computers storing it can't read it"

---

## Energy Comparison

| | Traditional Data Center | FreeGrid (3 nodes) |
|---|---|---|
| Power | ~1 MW+ | ~150W (3 × 50W) |
| Cooling | Massive water usage | Standard room temperature |
| Single point of failure | Yes | No — distributed |
| Data privacy | Centralized control | User-controlled encryption |

---

## Limitations

1. **Relay server needed** for internet connectivity (lightweight, ~200 lines)
2. **No erasure coding** — if a node goes offline, its chunks are unavailable
3. **Mobile AI is basic** — Qwen2-0.5B for demos, not production-grade
4. **Not audited** — crypto is solid but key management is simplified
5. **Local network only** for mDNS mode — internet requires relay

---

## Credits

- Inspired by the concerns raised about centralized AI infrastructure
- Uses [Ollama](https://ollama.com) for local AI inference
- Uses [transformers.js](https://huggingface.co/docs/transformers.js) for mobile AI
- Built with Electron, React, and Vite

---

## License

MIT
