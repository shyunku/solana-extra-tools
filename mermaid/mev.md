flowchart LR
%% ─────────────────────────────────────────
%% 컴포넌트(노드) 정의
subgraph Off-Chain Infrastructure
direction LR
Searcher["Searcher<br/>(MEV Bot)"]
BlockEngine["Block Engine<br/>(MEV Auction)"]
Relayer["Relayer<br/>(TPU Proxy)"]
Validator["Jito-Solana<br/>Validator"]
end

    subgraph On-Chain Programs & Accounts
        direction LR
        TipPaymentWallet[("<b>임시 팁 지갑</b><br/>--tip-payment-pubkey")]
        TipRouter["<b>Tip Router</b><br/>Program"]
        TipDistribution["<b>Tip-Distribution</b><br/>Program"]
    end

    subgraph External Actors
        direction TB
        Oracle["Off-chain<br/>Oracle"]
        Staker["Staker<br/>(사용자)"]
    end

    %% ─────────────────────────────────────────
    %% 데이터 흐름 연결

    %% MEV 번들 제출 흐름 (왼쪽)
    Searcher      -- "gRPC: Bundles" -->     BlockEngine
    BlockEngine   -- "QUIC / UDP" -->      Relayer
    Relayer       -- "Shreds" -->          Validator

    %% MEV 보상 처리 흐름 (오른쪽)
    Validator     -- "<b>1. 팁 지불</b><br/>(SOL/JTO)" --> TipPaymentWallet
    TipRouter     -- "<b>2. 자금 이체 실행</b><br/>(Crank)" --> TipPaymentWallet
    TipRouter     -- "<b>3. 자금 라우팅</b>" --> TipDistribution
    Oracle        -- "<b>4. Merkle Root 업로드</b>" --> TipDistribution
    Staker        -- "<b>5. 보상 청구</b><br/>(Claim)" --> TipDistribution

    %% 스타일링
    style Validator fill:#e9d5ff,stroke:#8b5cf6
    style TipPaymentWallet fill:#fefce8,stroke:#ca8a04
    style TipRouter fill:#dbeafe,stroke:#3b82f6
    style TipDistribution fill:#dbeafe,stroke:#3b82f6

end
