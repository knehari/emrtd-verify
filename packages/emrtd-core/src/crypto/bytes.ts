/** Convertit un Uint8Array (potentiellement une vue sur un buffer plus grand) en ArrayBuffer autonome, tel qu'attendu par asn1js/pkijs. */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  // bytes.buffer is typed ArrayBufferLike (ArrayBuffer | SharedArrayBuffer) by lib.dom,
  // but a Uint8Array we construct ourselves is always backed by a plain ArrayBuffer.
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function bufferToHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
