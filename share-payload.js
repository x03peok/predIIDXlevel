"use strict";

// Share payloads are opaque and self-validating, but not cryptographic signatures.
// A static client cannot keep a signing secret, so the checksum is for corruption
// detection while the renderer still validates every field before displaying it.
(function initializeCpiSharePayload() {
  const version = 1;
  const typeCodes = Object.freeze({ overview: "o", history: "h", daily: "d" });
  const typeNames = Object.freeze({ o: "overview", h: "history", d: "daily" });
  const allowedTypes = new Set(Object.keys(typeCodes));
  const maxPayloadLength = 12000;

  function encodeUtf8(value) {
    const text = String(value ?? "");
    if (typeof TextEncoder === "function") return new TextEncoder().encode(text);
    const encoded = unescape(encodeURIComponent(text));
    return Uint8Array.from(encoded, (character) => character.charCodeAt(0));
  }

  function decodeUtf8(bytes) {
    if (typeof TextDecoder === "function") return new TextDecoder().decode(bytes);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return decodeURIComponent(escape(binary));
  }

  function toBase64Url(value) {
    const bytes = encodeUtf8(value);
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }

  function fromBase64Url(value) {
    const normalized = String(value ?? "")
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
      throw new Error("Invalid share payload encoding.");
    }
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return decodeUtf8(bytes);
  }

  function hash(value) {
    let result = 0x811c9dc5;
    for (const character of String(value ?? "")) {
      result ^= character.charCodeAt(0);
      result = Math.imul(result, 0x01000193);
    }
    return (result >>> 0).toString(16).padStart(8, "0");
  }

  function encodePayload(payload) {
    return toBase64Url(JSON.stringify(payload));
  }

  function buildUrl(type, payload) {
    if (!allowedTypes.has(type)) throw new Error("Unknown share payload type.");
    const typeCode = typeCodes[type];
    const data = encodePayload(payload);
    if (data.length > maxPayloadLength) throw new Error("Share payload is too large.");
    const checksum = hash(typeCode + "." + version + "." + data);
    return "https://cpi-next.com/share.html?t=" + typeCode
      + "&v=" + version
      + "&d=" + data
      + "&h=" + checksum;
  }

  function decodeUrl(value = window.location.href) {
    const url = value instanceof URL ? value : new URL(String(value), window.location.href);
    const params = url.searchParams;
    const typeCode = params.get("t") ?? "";
    const type = typeNames[typeCode] ?? "";
    const payloadVersion = Number(params.get("v"));
    const data = params.get("d") ?? "";
    const checksum = params.get("h") ?? "";
    if (!type || payloadVersion !== version || !data || !/^[0-9a-f]{8}$/i.test(checksum)) {
      throw new Error("Invalid share URL.");
    }
    if (data.length > maxPayloadLength || hash(typeCode + "." + payloadVersion + "." + data) !== checksum.toLowerCase()) {
      throw new Error("Share URL validation failed.");
    }
    let payload;
    try {
      payload = JSON.parse(fromBase64Url(data));
    } catch (_error) {
      throw new Error("Invalid share payload.");
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Invalid share payload.");
    }
    return { type, version: payloadVersion, payload };
  }

  window.cpiSharePayload = Object.freeze({
    version,
    buildUrl,
    decodeUrl,
  });
})();
