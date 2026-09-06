export class MediaCapabilityError extends Error {
  constructor(readonly code: "not-configured" | "invalid-input" | "provider-error" | "unsupported" | "processing-error", message: string) {
    super(message);
    this.name = "MediaCapabilityError";
  }
}
