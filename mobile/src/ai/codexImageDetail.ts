/** Bound Codex image preprocessing: auto/native resolution misidentified large
 * meal photos that high recognized in repeated controls. This is independent
 * of reasoning effort and applies equally to attachments and tool-returned photos.
 * Preserve image bytes and caller-owned history; only the wire payload changes. */
export function withCodexImageDetail(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || !('input' in payload) || !Array.isArray(payload.input)) return payload;
  const imageDetail = (part: unknown) => {
    if (part && typeof part === 'object' && 'type' in part && part.type === 'input_image') {
      return {...part, detail: 'high'};
    }
    return part;
  };
  return {
    ...payload,
    input: payload.input.map((item: unknown) => {
      if (!item || typeof item !== 'object') return item;
      if ('type' in item && item.type === 'function_call_output' && 'output' in item && Array.isArray(item.output)) {
        return {...item, output: item.output.map(imageDetail)};
      }
      if ('content' in item && Array.isArray(item.content)) {
        return {...item, content: item.content.map(imageDetail)};
      }
      return item;
    }),
  };
}
