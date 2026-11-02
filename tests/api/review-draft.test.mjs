import test from "node:test";
import assert from "node:assert/strict";
import handler from "../../api/review-draft.mjs";

function response() {
  return {
    statusCode: 200,
    setHeader() {},
    end(body) { this.body = body; }
  };
}

test("rejects oversized pre-parsed JSON before contacting OpenAI", async () => {
  const res = response();
  await handler({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: { input: { draftText: "x".repeat(90_000) }, localReview: {} }
  }, res);

  assert.equal(res.statusCode, 413);
  assert.deepEqual(JSON.parse(res.body), { error: "Request body too large" });
});

test("does not expose upstream error details to the browser", async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "test-placeholder";
  globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => JSON.stringify({ error: { message: "private upstream detail" } }) });
  try {
    const res = response();
    await handler({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: { input: { draftText: "This is a sample draft with enough words to exercise the local handler and make the server attempt an AI request." }, localReview: {} }
    }, res);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(JSON.parse(res.body), { error: "AI review could not be completed. Please try again." });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  }
});
