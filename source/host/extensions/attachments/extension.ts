import { defineHostExtension } from "../../../internal/host-extensions.js";
import { createContext } from "../../../packages/context/core.js";
import { HostExtensions } from "../extension-ids.generated.js";
import { createAttachmentsService, type AttachmentsServiceDependencies } from "./attachments-service.js";

export const attachmentsExtension = defineHostExtension({
  id: HostExtensions.Attachments,
  dependencies: [HostExtensions.Auth, HostExtensions.ForeverBox, HostExtensions.Telemetry],
  start: (context) => {
    const deps = context.deps as { auth: AttachmentsServiceDependencies<unknown>["auth"]; "forever-box": { box: AttachmentsServiceDependencies<unknown>["box"] }; telemetry: { logs: { reportHostExtensionDiagnostic(value: Record<string, unknown>): void } } };
    // The box-staging path (stageAttachmentsIntoBox → box.uploadFile → loopback ensureReady/ping)
    // runs against this ctx; a bare `{}` has no signal/withTimeout, so every readiness ping
    // crashed ("last ping: crash") and attachments were never uploaded into the box.
    return createAttachmentsService({ auth: deps.auth, box: deps["forever-box"].box, ctx: createContext(), report: (diagnostic) => deps.telemetry.logs.reportHostExtensionDiagnostic(diagnostic) });
  }
});
