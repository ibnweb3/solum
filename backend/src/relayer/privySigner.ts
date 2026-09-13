/**
 * A real embedded-wallet integration: Privy's Server Wallets create and hold the private key
 * material for us — we never generate or see it — and we ask Privy to sign each transaction over
 * a plain REST call (no npm SDK; see the note in wallet.ts about why Web3Auth's Node SDK, which
 * does ship an SDK, doesn't run on Workers at all).
 *
 * PrivyRelayerSigner slots into ethers exactly where a hardware-wallet signer would: it extends
 * AbstractSigner and implements only `signTransaction`, so `ethers.Contract` writes, `.sendTransaction`,
 * gas estimation, nonce management, and broadcasting all keep working unchanged — populate/broadcast
 * stays on our own provider, only the signature itself is delegated to Privy.
 */
import { AbstractSigner, Transaction, type Provider, type TransactionRequest } from "ethers";
import type { Env } from "../shared/env.ts";

const PRIVY_API_BASE = "https://api.privy.io/v1";

function authHeaders(env: Env): HeadersInit {
  if (!env.PRIVY_APP_ID || !env.PRIVY_APP_SECRET) throw new Error("privy_not_configured");
  return {
    Authorization: `Basic ${btoa(`${env.PRIVY_APP_ID}:${env.PRIVY_APP_SECRET}`)}`,
    "privy-app-id": env.PRIVY_APP_ID,
    "content-type": "application/json",
  };
}

function toHex(value: bigint): string {
  return value < 0n ? `-0x${(-value).toString(16)}` : `0x${value.toString(16)}`;
}

/** Creates a fresh Privy-custodied server wallet. Returns null if Privy isn't configured. */
export async function createPrivyWallet(env: Env): Promise<{ walletId: string; address: string } | null> {
  if (!env.PRIVY_APP_ID || !env.PRIVY_APP_SECRET) return null;
  const res = await fetch(`${PRIVY_API_BASE}/wallets`, {
    method: "POST",
    headers: authHeaders(env),
    body: JSON.stringify({ chain_type: "ethereum" }),
  });
  if (!res.ok) throw new Error(`privy_create_wallet_failed:${res.status}:${await res.text()}`);
  const data = await res.json<{ id: string; address: string }>();
  return { walletId: data.id, address: data.address };
}

export class PrivyRelayerSigner extends AbstractSigner {
  readonly address: string;
  #env: Env;
  #walletId: string;

  constructor(env: Env, walletId: string, address: string, provider: Provider) {
    super(provider);
    this.#env = env;
    this.#walletId = walletId;
    this.address = address;
  }

  async getAddress(): Promise<string> {
    return this.address;
  }

  connect(provider: Provider | null): PrivyRelayerSigner {
    return new PrivyRelayerSigner(this.#env, this.#walletId, this.address, provider as Provider);
  }

  async signTransaction(tx: TransactionRequest): Promise<string> {
    const populated = tx as Transaction;
    const body: Record<string, unknown> = {
      to: populated.to,
      chain_id: Number(populated.chainId),
      nonce: populated.nonce,
      gas_limit: toHex(populated.gasLimit),
      value: toHex(populated.value ?? 0n),
    };
    if (populated.data && populated.data !== "0x") body.data = populated.data;

    if (populated.type === 0 || populated.type === 1) {
      body.type = populated.type;
      body.gas_price = toHex(populated.gasPrice ?? 0n);
    } else {
      body.type = 2;
      body.max_fee_per_gas = toHex(populated.maxFeePerGas ?? 0n);
      body.max_priority_fee_per_gas = toHex(populated.maxPriorityFeePerGas ?? 0n);
    }

    const res = await fetch(`${PRIVY_API_BASE}/wallets/${this.#walletId}/rpc`, {
      method: "POST",
      headers: authHeaders(this.#env),
      body: JSON.stringify({ method: "eth_signTransaction", params: { transaction: body } }),
    });
    if (!res.ok) throw new Error(`privy_sign_failed:${res.status}:${await res.text()}`);
    const result = await res.json<{ data?: { signed_transaction?: string } }>();
    const signed = result.data?.signed_transaction;
    if (!signed) throw new Error("privy_sign_returned_no_signature");
    return signed.startsWith("0x") ? signed : `0x${signed}`;
  }

  async signMessage(): Promise<string> {
    throw new Error("privy_signer_message_signing_not_supported");
  }

  async signTypedData(): Promise<string> {
    throw new Error("privy_signer_typed_data_not_supported");
  }
}
