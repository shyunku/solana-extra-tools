flowchart LR
%% ────────────── Token mints ──────────────
subgraph Token_Mints["Token Mints"]
MINT_A["Mint A<br/>decimals = 9"]
MINT_B["Mint B<br/>decimals = 9"]
LP_MINT["LP Mint (A-B)<br/>mintAuthority = PDA"]
end

%% ────────────── Program & PDA ──────────────
subgraph Program_PDA["Program & PDA"]
SWAP["swap Keypair<br/>(pool state)"]
PDA["authority PDA<br/>(findProgramAddress)"]
SWAP_PID["Token-Swap Program ID"]
end

%% ────────────── Vaults ──────────────
subgraph Vaults_PDA_owner["Vaults (owner = PDA)"]
VAULT_A["Vault A<br/>(Token Acc)"]
VAULT_B["Vault B<br/>(Token Acc)"]
POOL_VAULT["Pool Vault<br/>(LP Token Acc)"]
end

%% ────────────── Wallets ──────────────
subgraph Wallets["Wallets & ATAs"]
VALIDATOR["Validator Wallet"]
VALID_A_ATA["Validator ATA_A"]
VALID_B_ATA["Validator ATA_B"]
FEE_VAULT["Fee Vault <br/>(LP Acc / owner = Validator)"]

    VICTIM["Victim Wallet"]
    VICTIM_A["Victim ATA_A"]
    VICTIM_B["Victim ATA_B"]

end

%% ────────────── Relations ──────────────
%% mintTo
MINT_A -->|mintTo| VALID_A_ATA
MINT_B -->|mintTo| VALID_B_ATA
MINT_A -->|mintTo| VAULT_A
MINT_B -->|mintTo| VAULT_B
LP_MINT -->|mintTo| POOL_VAULT & FEE_VAULT

%% transfers
VALID_A_ATA -. "transfer 1 000 000 A" .-> VAULT_A
VALID_B_ATA -. "transfer 1 000 000 B" .-> VAULT_B
VICTIM_A -. "swap 10 A" .-> VAULT_A
VAULT_B -. "swap output B" .-> VICTIM_B

%% ownership / authority
SWAP --> PDA
PDA --> VAULT_A & VAULT_B & POOL_VAULT & LP_MINT
VALIDATOR --> VALID_A_ATA & VALID_B_ATA & FEE_VAULT
VICTIM --> VICTIM_A & VICTIM_B

%% program link
PDA --- SWAP_PID
SWAP --- SWAP_PID
