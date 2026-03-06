import { plaidAdapter } from "./plaid.ts";
import { sandboxAdapter } from "./sandbox.ts";
import type { BankAdapter, SupportedProvider } from "./types.ts";

const adapters: Record<SupportedProvider, BankAdapter> = {
  plaid: plaidAdapter,
  sandbox: sandboxAdapter,
};

export function getBankAdapter(provider: SupportedProvider): BankAdapter {
  const adapter = adapters[provider];
  if (!adapter) {
    throw new Error(`Unsupported bank provider: ${provider}`);
  }
  return adapter;
}

export type { SupportedProvider } from "./types.ts";
