// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5215146 (EMn/CMn/Ipt)

export function isPlainThreadEscape(event: KeyboardEvent): boolean {
  return event.key === "Escape"
    && !event.repeat
    && !event.isComposing
    && !event.metaKey
    && !event.ctrlKey
    && !event.altKey
    && !event.shiftKey
    && !event.defaultPrevented;
}

export function documentHasModal(documentValue: Document): boolean {
  return documentValue.querySelector('[aria-modal="true"]') != null;
}
