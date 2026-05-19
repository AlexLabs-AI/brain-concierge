// Promptfoo transformResponse for GBrain SSE endpoint
// GBrain returns text/event-stream: "event: message\ndata: {...}\n\n"
//
// Promptfoo v0.121 calling convention for file transforms with SSE responses:
//   output  = null (parsed JSON — null when content-type is text/event-stream)
//   context = raw response string
module.exports = (output, context) => {
  const raw = (typeof context === "string" && context.length > 0)
    ? context
    : (typeof output === "string" ? output : "");

  if (!raw) return "";

  const dataLine = raw.split("\n").find(l => l.startsWith("data:"));
  if (dataLine) {
    try {
      const parsed = JSON.parse(dataLine.replace(/^data:\s*/, "").trim());
      const text = parsed?.result?.content?.[0]?.text;
      if (text) return text;
    } catch { /* fall through */ }
  }

  return raw;
};
