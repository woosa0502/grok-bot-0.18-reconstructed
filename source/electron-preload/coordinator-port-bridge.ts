export type {
  CoordinatorAgentThreadRequest,
  CoordinatorAgentThreadResponse,
  CoordinatorTranscriptEntry,
  CoordinatorTranscriptWindowRequest,
  CoordinatorTranscriptWindowResponse,
} from "../shared/rpc/coordinator.js";

/** Typed renderer-facing calls carried by the transferred coordinator port. */
export interface CoordinatorTranscriptPortContract {
  getAgentTranscriptWindow(args: import("../shared/rpc/coordinator.js").CoordinatorTranscriptWindowRequest): Promise<import("../shared/rpc/coordinator.js").CoordinatorTranscriptWindowResponse>;
  getAgentThread(args: import("../shared/rpc/coordinator.js").CoordinatorAgentThreadRequest): Promise<import("../shared/rpc/coordinator.js").CoordinatorAgentThreadResponse>;
}

export interface CoordinatorPortConsumer<TPort> {
  onPort(port: TPort): void;
  onRequestError?(message: string, requestId?: number): void;
}

export interface CoordinatorPortClaim {
  request(requestId?: number): void;
  release(): void;
}

export function createCoordinatorPortBroker<TPort>(options: { readonly invokeRequest: () => void | Promise<unknown> }): {
  readonly bridge: { claim(consumer: CoordinatorPortConsumer<TPort>): CoordinatorPortClaim | null };
  readonly deliver: (port: TPort) => void;
} {
  let owner: CoordinatorPortConsumer<TPort> | null = null;
  let ownerEpoch = 0;
  let requestEpoch = 0;
  return {
    bridge: {
      claim(consumer) {
        if (owner != null) return null;
        owner = consumer;
        const claimedEpoch = ++ownerEpoch;
        return {
          request: (requestId) => {
            if (owner !== consumer || ownerEpoch !== claimedEpoch) return;
            const requestedEpoch = ++requestEpoch;
            const reportError = (error: unknown): void => {
              if (owner !== consumer || ownerEpoch !== claimedEpoch || requestEpoch !== requestedEpoch) return;
              consumer.onRequestError?.(error instanceof Error ? error.message : String(error), requestId);
            };
            try {
              void Promise.resolve(options.invokeRequest()).then((result) => {
                if (result != null && typeof result === "object" && "status" in result && result.status === "disposed") {
                  reportError(new Error("Coordinator renderer-port IPC has been disposed."));
                }
              }).catch(reportError);
            } catch (error) {
              reportError(error);
            }
          },
          release: () => {
            if (owner !== consumer || ownerEpoch !== claimedEpoch) return;
            owner = null;
          },
        };
      },
    },
    deliver(port) {
      requestEpoch += 1;
      owner?.onPort(port);
    },
  };
}

export interface TransferredMessageEvent<T> { readonly data: T }
export interface TransferredCloseEvent {}
export type TransferredPortEventListener<T> = (event: TransferredMessageEvent<T> | TransferredCloseEvent) => void;

export function wrapTransferredCoordinatorPort<TMessage>(port: {
  postMessage(message: TMessage): void;
  close(): void;
  start(): void;
  addEventListener(type: "message", listener: (event: { readonly data: TMessage }) => void): void;
  addEventListener(type: "close", listener: () => void): void;
}): {
  postMessage(message: TMessage): void;
  close(): void;
  start(): void;
  addEventListener(type: "message" | "close", listener: TransferredPortEventListener<TMessage>): void;
} {
  return {
    postMessage: (message) => port.postMessage(message),
    close: () => port.close(),
    start: () => port.start(),
    addEventListener: (type, listener) => {
      if (type === "message") {
        port.addEventListener("message", (event) => listener({ data: event.data }));
        return;
      }
      port.addEventListener("close", () => listener({}));
    },
  };
}
