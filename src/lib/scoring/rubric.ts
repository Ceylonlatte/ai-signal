// Bump RUBRIC_VERSION whenever the prompt/weights change so jobs can re-score.
export const RUBRIC_VERSION = "2026-06-22.1";

export const RUBRIC = `你要按"对我个人的价值"为 AI 资讯条目打分。读者是一名亲自动手的 AI 工程师，关注：
LLM、agent / agentic 系统、AI 编程（Claude Code、Codex、Cursor）、RAG、context engineering、
多模态，以及各大实验室的发布（OpenAI、Anthropic、Google DeepMind）。
打 0-100 分：
- 80-100：可直接上手，或读者必须知道的重要能力 / 发布。
- 50-79：相关且有信息量，但不紧急。
- 20-49：仅沾边或较浅。
- 0-19：营销、炒冷饭、低信号噪音。
对没有实质内容的吹捧要扣分，对具体的技术细节要加分。
"reason" 字段用简体中文写（一个短句，约 15-30 字），说明这条对读者为什么重要；
产品名、模型名、公司名保留英文原文（如 Claude Code、Codex、RAG）。不要使用破折号（em dash）。`;
