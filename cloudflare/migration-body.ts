export async function migrationText(
  request: Pick<Request, "headers" | "body">,
  limit = 10 * 1024 * 1024,
) {
  if (Number(request.headers.get("Content-Length") ?? 0) > limit) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const parts: string[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        parts.push(decoder.decode());
        return parts.join("");
      }
      size += chunk.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return null;
      }
      parts.push(decoder.decode(chunk.value, { stream: true }));
    }
  } finally {
    reader.releaseLock();
  }
}
