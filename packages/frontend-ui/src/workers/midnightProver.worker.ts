/// <reference lib="webworker" />

import init, {
  CostModel,
  MidnightWasmParamsProvider,
  Rng,
  WasmProver,
  WasmResolver,
  initThreadPool,
} from "@paima/midnight-wasm-prover";
import type {
  MidnightProverWorkerRequest,
  MidnightProverWorkerResponse,
} from "./midnightProverMessages";

const workerScope = self as DedicatedWorkerGlobalScope;

let prover: WasmProver | null = null;
let rng: Rng | null = null;
let assetBaseUrl: URL | null = null;
let initPromise: Promise<void> | null = null;

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

async function fetchParamsBytes(k: number): Promise<Uint8Array> {
  if (!assetBaseUrl) {
    throw new Error("Browser prover not initialized");
  }

  const localUrl = new URL(`midnight-prover/bls_midnight_2p${k}`, assetBaseUrl)
    .toString();

  try {
    return await fetchBytes(localUrl);
  } catch (localError) {
    const fallbackBase = import.meta.env.VITE_MIDNIGHT_PARAMS_BASE_URL as
      | string
      | undefined;

    if (!fallbackBase) {
      throw localError;
    }

    return fetchBytes(
      new URL(`bls_midnight_2p${k}`, fallbackBase).toString(),
    );
  }
}

async function initialize(baseUrl: string): Promise<void> {
  if (prover && rng) return;
  if (!initPromise) {
    assetBaseUrl = new URL(baseUrl);

    initPromise = (async () => {
      await init();

      const threadCount = Math.max(
        1,
        globalThis.navigator.hardwareConcurrency ?? 1,
      );
      await initThreadPool(threadCount);

      rng = Rng.new();

      const resolver = WasmResolver.newWithFetchers(
        async (circuitId: string) =>
          fetchBytes(
            new URL(`keys/${circuitId}.prover`, assetBaseUrl!).toString(),
          ),
        async (circuitId: string) =>
          fetchBytes(
            new URL(`keys/${circuitId}.verifier`, assetBaseUrl!).toString(),
          ),
        async (circuitId: string) =>
          fetchBytes(
            new URL(`zkir/${circuitId}.bzkir`, assetBaseUrl!).toString(),
          ),
      );

      const paramsProvider = MidnightWasmParamsProvider.newWithFetcher(
        async (k: number) => fetchParamsBytes(k),
      );

      prover = WasmProver.new(resolver, paramsProvider);
    })().catch((error) => {
      prover = null;
      rng = null;
      initPromise = null;
      throw error;
    });
  }

  return initPromise;
}

function postMessage(message: MidnightProverWorkerResponse): void {
  workerScope.postMessage(message);
}

workerScope.onmessage = async (
  event: MessageEvent<MidnightProverWorkerRequest>,
) => {
  try {
    if (event.data.type === "init") {
      await initialize(event.data.baseUrl);
      postMessage({ type: "ready" });
      return;
    }

    if (!prover || !rng) {
      throw new Error("Browser prover not initialized");
    }

    const provenTx = await prover.prove(
      rng,
      new Uint8Array(event.data.serializedTx),
      CostModel.initialCostModel(),
    );

    postMessage({
      type: "result",
      requestId: event.data.requestId,
      serializedTx: new Uint8Array(provenTx).slice().buffer,
    });
  } catch (error) {
    postMessage({
      type: "error",
      requestId: event.data.type === "prove" ? event.data.requestId : undefined,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

export {};
