const palette = `
  classDef you fill:#8b5cf624,stroke:#8b5cf6,stroke-width:1.5px
  classDef pds fill:#ec489924,stroke:#ec4899,stroke-width:1.5px
  classDef site fill:#3b82f624,stroke:#3b82f6,stroke-width:1.5px
  classDef sandbox fill:#f59e0b24,stroke:#f59e0b,stroke-width:1.5px
  classDef wasm fill:#10b98124,stroke:#10b981,stroke-width:1.5px
  classDef cloud fill:#f9731624,stroke:#f97316,stroke-width:1.5px
  classDef store fill:#64748b24,stroke:#64748b,stroke-width:1.5px
  classDef deny fill:#ef444424,stroke:#ef4444,stroke-width:1.5px`;

const flowchart = (direction: "LR" | "TD", body: string) => `flowchart ${direction}\n${body.trim()}\n${palette}`;

export const legend = [
	{ tone: "you", label: "You and your tools" },
	{ tone: "pds", label: "Your PDS" },
	{ tone: "site", label: "EmDash site" },
	{ tone: "sandbox", label: "Plugin sandbox" },
	{ tone: "wasm", label: "WebAssembly isolate" },
	{ tone: "store", label: "Storage" },
	{ tone: "cloud", label: "Cloudflare" },
] as const;

export const overview = flowchart(
	"TD",
	`
  subgraph you["You"]
    B["Browser"]:::you
    CLI["CLI or app with service auth"]:::you
  end
  subgraph site["Your EmDash site"]
    UI["/integrations"]:::site
    X["/xrpc/…wasm.run"]:::site
    subgraph sandbox["Plugin sandbox"]
      P["atproto-integrations plugin"]:::sandbox
      S[("Sealed OAuth sessions")]:::store
    end
    W["WebAssembly isolate<br/>no imports, no network"]:::wasm
  end
  subgraph pds["Your PDS"]
    R1["Integration records"]:::pds
    R2["Module records and blobs"]:::pds
    REPO["Records modules write"]:::pds
  end
  B --> UI --> P
  CLI --> X --> P
  P --- S
  P <-- "JSON in, planned calls out" --> W
  P -- "read" --> R1
  P -- "fetch, check CID" --> R2
  P -- "OAuth + DPoP" --> REPO
  style you fill:#8b5cf60f,stroke:#8b5cf6
  style site fill:#3b82f60f,stroke:#3b82f6
  style sandbox fill:#f59e0b14,stroke:#f59e0b
  style pds fill:#ec48990f,stroke:#ec4899`,
);

export const journey = flowchart(
	"LR",
	`
  A["1 Sign in<br/>atproto scope only"]:::you --> B["2 Publish records<br/>to your PDS"]:::pds --> C["3 Connect<br/>pick scope groups"]:::site --> D["4 Run a module<br/>in its isolate"]:::wasm --> E["5 Records land<br/>in your repo"]:::pds`,
);

export const connect = `sequenceDiagram
  box rgb(139,92,246,0.1) You
    participant B as Browser
  end
  box rgb(59,130,246,0.1) EmDash site
    participant S as Site
    participant P as Plugin sandbox
  end
  box rgb(236,72,153,0.1) Atmosphere
    participant PDS as Your PDS
    participant AS as Authorization server
  end
  B->>S: Sign in with your handle
  S->>AS: auth-atproto-subscriber, scope atproto
  AS-->>B: Signed in
  B->>S: GET /integrations
  S->>P: integrations route
  P->>PDS: listRecords oauth.clientMetadata
  PDS-->>P: Your integration records
  B->>S: Connect, with the scope groups you ticked
  S->>P: connect route
  rect rgb(245,158,11,0.12)
    P->>AS: PAR with PKCE and DPoP, for your own account
    P-->>B: Redirect to the authorization server
    B->>AS: Approve the scopes
    AS->>S: /oauth/callback with code
    S->>P: callback route
    P->>AS: Token exchange
    P->>P: Seal tokens with AES-GCM into storage.sessions
  end
  P-->>B: Connected`;

export const rounds = flowchart(
	"TD",
	`
  UI["Run button on /integrations"]:::you --> RUN
  JWT["Service-auth JWT<br/>direct or through atproto-proxy"]:::you --> V{"aud, lxm, exp,<br/>single-use jti"}:::site
  V -- ok --> RUN["Plugin run"]:::sandbox
  V -- bad --> NO["401"]:::deny
  RUN --> F["Fetch wasm.module record and blob"]:::pds
  F --> H{"sha256 matches<br/>blob CID?"}:::sandbox
  H -- no --> X["Reject"]:::deny
  H -- yes --> W["ctx.wasm.run<br/>input, state, results"]:::wasm
  W --> O["Module returns<br/>calls, next, state, result"]:::wasm
  O --> D{"Any calls?"}:::sandbox
  D -- no --> DONE["Return result"]:::site
  D -- yes --> A{"NSID allowed and<br/>under limits?"}:::sandbox
  A -- no --> X
  A -- yes --> CALL["Call the PDS with<br/>the sealed session"]:::pds
  CALL -- "results to next entry" --> W`,
);

export const serviceAuth = `sequenceDiagram
  box rgb(139,92,246,0.1) You
    participant C as Your CLI or app
  end
  box rgb(236,72,153,0.1) Atmosphere
    participant PDS as Your PDS
  end
  box rgb(59,130,246,0.1) EmDash site
    participant S as did:web site
    participant P as Plugin
  end
  rect rgb(16,185,129,0.1)
    Note over C,P: Path A: your PDS proxies the call
    C->>PDS: POST wasm.run with atproto-proxy header
    PDS->>S: Same call with a fresh service-auth JWT
  end
  rect rgb(59,130,246,0.1)
    Note over C,P: Path B: you fetch the token yourself
    C->>PDS: getServiceAuth aud=did:web:site lxm=wasm.run
    PDS-->>C: Signed JWT
    C->>S: POST wasm.run with Bearer JWT
  end
  S->>P: service/run with the token
  P->>P: Resolve your DID, verify signature
  P->>P: Check aud, lxm, exp, then burn the jti
  P-->>C: Rounds and result`;

export const refresh = `sequenceDiagram
  participant A as Run A
  participant B as Run B
  participant L as storage.locks
  participant AS as Authorization server
  A->>L: compareAndSet key
  L-->>A: Acquired
  B->>L: compareAndSet key
  L-->>B: Held, poll every 100 ms
  rect rgb(245,158,11,0.12)
    A->>AS: Refresh token, once
    A->>A: Save sealed session
    A->>L: compareAndDelete key
  end
  B->>L: compareAndSet key
  L-->>B: Acquired
  B->>B: Reads fresh tokens, no refresh
  B->>L: compareAndDelete key`;

export const trust = flowchart(
	"LR",
	`
  subgraph worker["Site process"]
    K["EMDASH_ENCRYPTION_KEY<br/>site secrets"]:::site
    subgraph sandbox["Plugin sandbox: ctx.http, ctx.storage, ctx.wasm"]
      T["OAuth tokens, sealed"]:::sandbox
      subgraph iso["WebAssembly isolate"]
        M["Module: JSON in, JSON out"]:::wasm
      end
    end
  end
  M -. "no network" .-x NET["Internet"]:::deny
  M -. "no tokens" .-x T
  M -- "asks for calls" --> T
  T -- "only allowed NSIDs" --> PDS["Your PDS"]:::pds
  style worker fill:#3b82f60f,stroke:#3b82f6
  style sandbox fill:#f59e0b14,stroke:#f59e0b
  style iso fill:#10b98114,stroke:#10b981`,
);

export const records = flowchart(
	"TD",
	`
  MOD["wasm.module record<br/>actions, calls, abi"]:::pds
  CM["oauth.clientMetadata record<br/>scope, scopeGroups"]:::pds
  BLOB[("WebAssembly blob")]:::store
  OUT["Records it writes<br/>xyz.statusphere.status, com.vibescrobble.scrobble"]:::pds
  MOD -- "session: uri + cid" --> CM
  MOD -- "module: blob CID" --> BLOB
  CM -- "scopes allow" --> OUT
  MOD -- "calls allow" --> OUT`,
);

export const abi = `sequenceDiagram
  box rgb(245,158,11,0.1) Plugin
    participant P as ctx.wasm.run
  end
  box rgb(16,185,129,0.1) WebAssembly isolate
    participant M as Your module
  end
  P->>M: alloc(len)
  M-->>P: ptr
  P->>M: Write input JSON at ptr
  P->>M: entry(ptr, len)
  M->>M: Parse Step, build calls
  M-->>P: i64 = out_ptr << 32 | out_len
  P->>P: Read output JSON
  Note over P,M: Output is calls, next, state, result, or error`;

export const statusphere = `sequenceDiagram
  participant P as Plugin
  participant M as statusphere.wasm
  participant PDS as Your PDS
  P->>M: set_status with did, now, status
  M-->>P: calls listRecords, next set_status_write
  P->>PDS: listRecords xyz.statusphere.status
  PDS-->>P: Latest status
  P->>M: set_status_write with results
  alt Same emoji as now
    M-->>P: result unchanged=true
  else New emoji
    M-->>P: calls createRecord, next set_status_done
    P->>PDS: createRecord
    PDS-->>P: uri, cid
    P->>M: set_status_done with results
    M-->>P: result uri, cid
  end`;

export const cloudflare = flowchart(
	"LR",
	`
  U["Browser, CLI, PDS proxy"]:::you --> DOM["Custom domain<br/>exec.fedfork.com"]:::cloud
  DOM --> WK["Worker: Astro + EmDash<br/>src/worker.ts"]:::site
  CRON["Cron every minute"]:::cloud --> WK
  WK -- LOADER --> PI["Plugin isolate<br/>sandboxLimits cpuMs 1000, subrequests 200"]:::sandbox
  PI -- LOADER --> WI["Module isolate<br/>globalOutbound null"]:::wasm
  PI -- "ctx.http" --> PDS["PDSes and<br/>authorization servers"]:::pds
  WK --> bindings
  subgraph bindings["Bindings"]
    direction TB
    D1[("D1 DB<br/>content, plugin storage")]:::store
    R2[("R2 MEDIA<br/>uploads")]:::store
    KV[("KV SESSION<br/>login sessions")]:::store
    D1 ~~~ R2 ~~~ KV
  end
  style bindings fill:#64748b0f,stroke:#64748b`,
);

export const deploySteps = flowchart(
	"TD",
	`
  START{"How do you want to run it?"}:::you
  START -- "one click" --> BTN["Deploy to Cloudflare button"]:::cloud
  BTN --> FORK["Cloudflare copies the repo<br/>into your GitHub"]:::you
  FORK --> PROV["Creates D1, R2 and KV<br/>asks for EMDASH_ENCRYPTION_KEY"]:::cloud
  PROV --> WB["Workers Builds runs<br/>pnpm run build, pnpm run deploy"]:::cloud
  START -- "from a terminal" --> CLONE["git clone, pnpm install"]:::site
  CLONE --> CLI["pnpm run deploy<br/>wrangler creates D1, R2, KV"]:::cloud
  CLI --> SEC["wrangler secret put<br/>EMDASH_ENCRYPTION_KEY"]:::cloud
  START -- "on your machine" --> DEV["pnpm install, pnpm build, pnpm dev<br/>SQLite and a workerd sandbox"]:::site
  WB --> LIVE["Site on workers.dev<br/>or your domain"]:::site
  SEC --> LIVE
  DEV --> LOCAL["http://127.0.0.1:4321"]:::site
  LIVE --> REC["Publish your records and modules"]:::pds
  LOCAL --> REC
  REC --> USE["Sign in and connect"]:::you`,
);

export const sourceRecords = flowchart(
	"TD",
	`
  MOD["wasm.module<br/>name, actions, calls"]:::pds
  BLOB[("WebAssembly blob<br/>application/wasm")]:::store
  MAN["source.manifest<br/>immutable snapshot<br/>build: tool, version, command<br/>output: sha256, size"]:::pds
  F1["source.file<br/>rkey = sha256 of contents"]:::store
  F2["source.file<br/>rkey = sha256 of contents"]:::store
  F3["source.file<br/>shared by many manifests"]:::store
  CM["oauth.clientMetadata"]:::pds
  MOD -- "module: blob CID" --> BLOB
  MOD -- "source: uri + cid" --> MAN
  MOD -- "session: uri + cid" --> CM
  MAN -- "path + uri + cid" --> F1
  MAN -- "path + uri + cid" --> F2
  MAN -- "path + uri + cid" --> F3`,
);

export const verifySource = flowchart(
	"TD",
	`
  A["wasm.module record"]:::pds --> B["source.manifest<br/>CID must match module.source"]:::pds
  B --> C["Each source.file<br/>CID must match the manifest,<br/>sha256 must match the text"]:::store
  C --> D["Write files to an empty directory"]:::you
  D --> E["Run build.command in a container<br/>rust:1.97.0 or node:24"]:::wasm
  E --> F{"Built sha256 equals<br/>manifest output and<br/>published blob?"}:::sandbox
  F -- yes --> G["Reproducible"]:::site
  F -- no --> H["Not reproducible"]:::deny`,
);

export const sessions = flowchart(
	"TD",
	`
  LOGIN["Sign in<br/>scope atproto only"]:::you
  subgraph own["Your integration records"]
    S1["statusphere<br/>repo:xyz.statusphere.status"]:::pds
    S2["vibescrobble<br/>repo:com.vibescrobble.scrobble"]:::pds
  end
  subgraph offered["Site integrations<br/>siteIntegrations setting"]
    ST["studio<br/>integrations, modules"]:::site
  end
  LOGIN -- "new session per record,<br/>groups you tick" --> S1
  LOGIN --> S2
  LOGIN -- "new session,<br/>for your own account" --> ST
  S1 --> SEALED[("Sealed sessions<br/>one per user per record")]:::store
  S2 --> SEALED
  ST --> SEALED
  SEALED -- "own-record sessions only" --> RUN["Module runs"]:::wasm
  SEALED -- "studio session" --> PUB["Publish records,<br/>modules, source"]:::pds
  X["Another account's record"]:::deny -. "only that account can connect it" .-x SEALED
  style own fill:#ec48990f,stroke:#ec4899
  style offered fill:#3b82f60f,stroke:#3b82f6`,
);
