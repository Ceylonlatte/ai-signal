import { describe, expect, it, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function llmReply(obj: unknown) {
  return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(obj) } }] }) };
}

describe("summarizeBilingual", () => {
  beforeEach(() => fetchMock.mockReset());

  it("returns title_zh / summary_en / summary_zh", async () => {
    fetchMock.mockResolvedValue(llmReply({
      title_zh: "中文标题", summary_en: "English summary.", summary_zh: "中文翻译。",
    }));
    const { summarizeBilingual } = await import("../../src/lib/scoring/summarize.js");
    const out = await summarizeBilingual({ title: "Title", text: "Body text" });
    expect(out.titleZh).toBe("中文标题");
    expect(out.summaryEn).toBe("English summary.");
    expect(out.summaryZh).toBe("中文翻译。");
  });

  it("tolerates missing fields (defaults to empty strings)", async () => {
    fetchMock.mockResolvedValue(llmReply({ summary_en: "Only english" }));
    const { summarizeBilingual } = await import("../../src/lib/scoring/summarize.js");
    const out = await summarizeBilingual({ title: "T", text: "B" });
    expect(out.summaryEn).toBe("Only english");
    expect(out.titleZh).toBe("");
    expect(out.summaryZh).toBe("");
  });
});
