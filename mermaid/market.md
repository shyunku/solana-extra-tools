flowchart LR
%% ── AMM 부분 (기존) ──
subgraph AMM["CP-AMM Pool"]
MINTA((Apple))
MINTB((Banana))
VA[VAULT_A]
VB[VAULT_B]
LP[LP_Mint]
VA & VB -->|swap/liq| LP
end

%% ── CLOB 부분 ──
subgraph CLOB["OpenBook / Phoenix"]
ORDER_Q["Event & Order Queues"]
BIDS((Bids))
ASKS((Asks))
MARKET["Market (A/B)"]
BIDS --- ORDER_Q --- ASKS
MARKET --- ORDER_Q
end

%% ── 라우팅 계층 ──
subgraph Router
JUPITER[Jupiter Routing SDK]
MM_BOT["MM Bot<br/>(inventory + repricing)"]
end

%% 관계
MINTA & MINTB --> CLOB
MINTA & MINTB --> AMM
MM_BOT <-->|deposit/withdraw| AMM
MM_BOT <-->|place/cancel| ORDER_Q
JUPITER -->|best-price swap| AMM & CLOB
