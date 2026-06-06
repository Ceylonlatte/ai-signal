#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate the AI Signal Triage scoring flowchart (dark theme) as SVG."""

OUT = "/Users/shinnpei/Desktop/ai-signal/diagrams/triage-flow.svg"

# ---- palette ----
BG = "#0d1117"
TEXT = "#e6edf3"
SUB = "#9fb0c8"
NEUTRAL_FILL, NEUTRAL_STROKE = "#1b2333", "#3a4761"
EMBED_FILL, EMBED_STROKE = "#1e3a8a", "#3b82f6"
LLM_FILL, LLM_STROKE = "#5b21b6", "#a855f7"
RAW_FILL, RAW_STROKE = "#374151", "#9ca3af"
DEC_FILL, DEC_STROKE, DEC_TEXT = "#3b2f0b", "#f59e0b", "#fde68a"
DIS_FILL, DIS_STROKE, DIS_TEXT = "#3f1722", "#ef4444", "#fecaca"
SRC_FILL, SRC_STROKE = "#0e2f33", "#22d3ee"
PANEL_FILL, PANEL_STROKE = "#0f1626", "#27324a"
ARROW = "#8b9bb4"
YES = "#34d399"
NO = "#fb7185"
ASYNC = "#7c8aa5"

FONT = "'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans CJK SC','Segoe UI',sans-serif"

L = []
def add(s): L.append(s)
def esc(t): return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def rrect(x, y, w, h, fill, stroke, rx=12, sw=2, dash=None, shadow=True):
    d = f' stroke-dasharray="{dash}"' if dash else ""
    f = ' filter="url(#sh)"' if shadow else ""
    add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" ry="{rx}" '
        f'fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{d}{f}/>')

def tline(x, y, t, size, color, anchor="middle", weight="normal"):
    add(f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}" '
        f'text-anchor="{anchor}" font-weight="{weight}" font-family="{FONT}">{esc(t)}</text>')

def node_box(cx, cy, w, h, title, subs, fill, stroke, tcolor=TEXT, scolor=SUB, badge=None):
    rrect(cx - w/2, cy - h/2, w, h, fill, stroke)
    n = 1 + len(subs)
    lh = 18
    top = cy - ((n - 1) * lh) / 2
    tline(cx, top + 5, title, 14.5, tcolor, weight="700")
    for i, s in enumerate(subs):
        tline(cx, top + 5 + (i + 1) * lh, s, 12, scolor)
    if badge is not None:
        bx, by = cx + w/2, cy
        add(f'<circle cx="{bx}" cy="{by}" r="12" fill="{badge[1]}" stroke="{BG}" stroke-width="2"/>')
        tline(bx, by + 4.5, str(badge[0]), 12.5, "#0d1117", weight="800")

def node_diamond(cx, cy, w, h, title, subs, fill, stroke, tcolor=DEC_TEXT, badge=None):
    pts = f"{cx},{cy-h/2} {cx+w/2},{cy} {cx},{cy+h/2} {cx-w/2},{cy}"
    add(f'<polygon points="{pts}" fill="{fill}" stroke="{stroke}" stroke-width="2" filter="url(#sh)"/>')
    n = 1 + len(subs)
    lh = 17
    top = cy - ((n - 1) * lh) / 2
    tline(cx, top + 5, title, 13.5, tcolor, weight="700")
    for i, s in enumerate(subs):
        tline(cx, top + 5 + (i + 1) * lh, s, 11.5, "#f4dca0")
    if badge is not None:
        bx, by = cx + w/2 + 10, cy
        add(f'<circle cx="{bx}" cy="{by}" r="12" fill="{badge[1]}" stroke="{BG}" stroke-width="2"/>')
        tline(bx, by + 4.5, str(badge[0]), 12.5, "#0d1117", weight="800")

def arrow(d, color=ARROW, dash=None, width=2.0, marker="arr"):
    dd = f' stroke-dasharray="{dash}"' if dash else ""
    add(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}"{dd} marker-end="url(#{marker})"/>')

def elabel(x, y, t, color=ARROW, size=12):
    w = len(t) * size * 0.62 + 8
    add(f'<rect x="{x - w/2}" y="{y - size/2 - 4}" width="{w}" height="{size + 8}" rx="4" fill="{BG}" opacity="0.92"/>')
    tline(x, y + size*0.36, t, size, color, weight="600")

def card(x, y, w, h, num, accent, title, lines):
    rrect(x, y, w, h, PANEL_FILL, PANEL_STROKE, rx=12, sw=1.4, shadow=False)
    add(f'<rect x="{x}" y="{y}" width="5" height="{h}" rx="2" fill="{accent}"/>')
    add(f'<circle cx="{x+30}" cy="{y+26}" r="12" fill="{accent}"/>')
    tline(x+30, y+30.5, str(num), 12.5, "#0d1117", anchor="middle", weight="800")
    tline(x+50, y+31, title, 14.5, accent, anchor="start", weight="700")
    yy = y + 56
    for ln in lines:
        tline(x+20, yy, ln, 13, "#c7d2e4", anchor="start")
        yy += 21

# ---------------- document ----------------
add('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1440 1700" font-family="' + FONT + '">')
add('<defs>')
add('<filter id="sh" x="-20%" y="-20%" width="140%" height="140%">')
add('<feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000000" flood-opacity="0.55"/>')
add('</filter>')
for mid, col in [("arr", ARROW), ("arrY", YES), ("arrN", NO), ("arrA", ASYNC)]:
    add(f'<marker id="{mid}" markerWidth="11" markerHeight="9" refX="9" refY="4.5" orient="auto">'
        f'<path d="M0,0 L11,4.5 L0,9 Z" fill="{col}"/></marker>')
add('</defs>')
add(f'<rect x="0" y="0" width="1440" height="1700" fill="{BG}"/>')

# titles
tline(60, 38, "AI Signal · Triage 打分流水线", 17, TEXT, anchor="start", weight="800")
tline(1095, 40, "打分规则详解（编号对应中间各阶段）", 16.5, "#cbd5e1", weight="700")
# faint divider
add(f'<line x1="712" y1="60" x2="712" y2="1045" stroke="#1e2a40" stroke-width="1.4" stroke-dasharray="3,6"/>')

CX = 430

# ---- arrows first (under nodes) ----
arrow(f"M{CX},105 L{CX},129")
arrow(f"M{CX},187 L{CX},235")
arrow(f"M{CX},305 L{CX},349")
arrow(f"M{CX},407 L{CX},453")
arrow(f"M{CX},511 L{CX},550")
arrow(f"M{CX},654 L{CX},698", color=YES, marker="arrY")          # F->G 是
arrow(f"M{CX},766 L{CX},813")
arrow(f"M{CX},871 L{CX},908")
arrow(f"M{CX},1008 L{CX},1036", color=NO, marker="arrN")          # I->J 否
arrow(f"M{CX},1136 L{CX},1173", color=YES, marker="arrY")         # J->K 是
arrow(f"M{CX},1227 L{CX},1275")
arrow(f"M{CX},1349 L{CX},1400")
# D -> D2 (fail fallback, left)
arrow("M280,378 L267,378", color=NO, marker="arrN")
# D2 -> E
arrow("M160,410 L160,482 L278,482")
# F -> X (否)
arrow("M280,602 L150,602 L150,873", color=NO, marker="arrN")
# J -> X (否)
arrow("M280,1086 L150,1086 L150,931", color=NO, marker="arrN")
# X -> M
arrow("M105,929 L105,1432 L278,1432")
# I -> K (是, bypass right)
arrow(f"M580,958 L660,958 L660,1200 L582,1200", color=YES, marker="arrY")
# L -> N (async dashed)
arrow("M580,1312 L865,1312 L865,1540", color=ASYNC, dash="6,5", marker="arrA")
# subgraph internal
arrow("M962,1590 L978,1590", color=ASYNC, marker="arrA")
arrow("M1172,1590 L1188,1590", color=ASYNC, marker="arrA")

# arrow labels
elabel(452, 678, "是 · 选中", YES)
elabel(330, 602, "否", NO)
elabel(560, 1022, "否 · rescue 带", NO)
elabel(452, 1156, "是", YES)
elabel(636, 936, "是", YES)
elabel(225, 1086, "否", NO)
elabel(690, 1296, "异步补充", ASYNC)

# ---- nodes ----
node_box(CX, 76, 320, 58, "采集器 collectors", ["HN · RSS · Twitter · Reddit"], SRC_FILL, SRC_STROKE, scolor="#a5f3fc")
node_box(CX, 158, 320, 58, "ingest() 原样写入 raw_items", ["sourceId + externalId 去重"], RAW_FILL, RAW_STROKE, scolor="#e5e7eb")
node_box(CX, 270, 320, 70, "Triage 阶段", ["取 processedAt=null，每批 500 条", "归一化 normalizeRawItem"], NEUTRAL_FILL, NEUTRAL_STROKE)
node_box(CX, 378, 320, 58, "embedCandidates 整批 embed", ["qwen3-embedding-8b（免费）"], EMBED_FILL, EMBED_STROKE, scolor="#bfdbfe")
node_box(CX, 482, 320, 58, "hybridRelevance 相关度", ["向量 vs 关键词余弦 + 关键词精确匹配"], NEUTRAL_FILL, NEUTRAL_STROKE, badge=(1, "#38bdf8"))
node_diamond(CX, 602, 300, 100, "预筛 selectCandidates", ["相关? 或 够热? 或 Twitter following?"], DEC_FILL, DEC_STROKE, badge=(2, "#f59e0b"))
node_box(CX, 732, 320, 68, "scoreBatch LLM 打分", ["deepseek-v4-flash", "value / topics / reason"], LLM_FILL, LLM_STROKE, scolor="#e9d5ff", badge=(3, "#c084fc"))
node_box(CX, 842, 320, 58, "computeQuality 质量分 Q", ["Q = llmValue ± relevance ± trust"], NEUTRAL_FILL, NEUTRAL_STROKE, badge=(4, "#34d399"))
node_diamond(CX, 958, 300, 100, "passesGate?", ["Q ≥ 0.55"], DEC_FILL, DEC_STROKE, badge=(5, "#f59e0b"))
node_diamond(CX, 1086, 300, 100, "和点赞内容够像?", ["likeRescues"], DEC_FILL, DEC_STROKE)
node_box(CX, 1200, 300, 54, "keep = true", [], NEUTRAL_FILL, "#34d399")
node_box(CX, 1312, 320, 74, "写入正式层（事务）", ["items + scores + item_embeddings", "复用 triage 阶段的向量"], NEUTRAL_FILL, NEUTRAL_STROKE)
node_box(CX, 1432, 320, 64, "标记 raw_items.processedAt", ["留在原始层，不再处理"], RAW_FILL, RAW_STROKE, scolor="#e5e7eb")

# side nodes
node_box(160, 378, 210, 64, "失败回退", ["无向量 → 纯关键词匹配", "（后续 embed 阶段补）"], EMBED_FILL, "#60a5fa", scolor="#bfdbfe")
node_box(150, 900, 170, 58, "丢弃 unscored", ["不打分 / 不入库"], DIS_FILL, DIS_STROKE, tcolor=DIS_TEXT, scolor="#fca5a5")

# worker subgraph
rrect(758, 1500, 634, 168, "#0c1322", "#475569", rx=14, sw=1.5, dash="6,6", shadow=False)
tline(775, 1524, "后续 worker 流水线", 13.5, "#94a3b8", anchor="start", weight="700")
node_box(865, 1592, 190, 96, "runEmbedStage", ["给漏网 items 补向量", "qwen3-embedding-8b"], EMBED_FILL, EMBED_STROKE, scolor="#bfdbfe")
node_box(1075, 1592, 190, 96, "runSummarizeStage", ["抓全文 + 双语摘要", "deepseek-v4-flash"], LLM_FILL, LLM_STROKE, scolor="#e9d5ff")
node_box(1285, 1592, 190, 96, "runClusterStage", ["向量质心余弦聚类(qwen3)", "+ labelTopic 标签(deepseek)"], EMBED_FILL, EMBED_STROKE, scolor="#bfdbfe")

# legend
rrect(60, 1500, 560, 168, "#0c1322", "#27324a", rx=14, sw=1.4, shadow=False)
tline(80, 1524, "图例", 14, "#cbd5e1", anchor="start", weight="700")
leg = [
    (75, 1552, EMBED_FILL, EMBED_STROKE, "embed 向量阶段"),
    (265, 1552, LLM_FILL, LLM_STROKE, "LLM 打分 / 摘要"),
    (455, 1552, RAW_FILL, RAW_STROKE, "原始层 raw"),
    (75, 1600, DEC_FILL, DEC_STROKE, "判定分支"),
    (265, 1600, DIS_FILL, DIS_STROKE, "丢弃 unscored"),
    (455, 1600, NEUTRAL_FILL, NEUTRAL_STROKE, "处理 / 入库"),
]
for lx, ly, f, s, t in leg:
    add(f'<rect x="{lx}" y="{ly-13}" width="24" height="17" rx="4" fill="{f}" stroke="{s}" stroke-width="1.6"/>')
    tline(lx + 30, ly, t, 12.5, "#c7d2e4", anchor="start")

# ---- rule cards ----
CX2, CW = 800, 590
card(CX2, 64, CW, 150, 1, "#38bdf8", "相关度 hybridRelevance ∈ [0,1]", [
    "• 精确匹配 exactRelevance：标题/正文命中关注关键词",
    "• 语义 semanticRelevance：item 向量与关键词向量最大余弦 s",
    "      s ≤ 0.35 记 0；否则 (s − 0.35) / 0.65 映射到 [0,1]",
    "• relevance = max(精确, 语义)",
])
card(CX2, 230, CW, 206, 2, "#f59e0b", "预筛 selectCandidates（调用 LLM 之前）", [
    "满足任一条件即保留并送 LLM 打分：",
    "• relevance > 0（关键词 / 语义相关）",
    "• 够热 prefilterHeat ≥ 0.5",
    "      通用：log10(1 + points + 2·comments) / 3",
    "      Twitter：log10(1 + likes + 2·RT + replies) / 3",
    "• Twitter following（人工策展时间线，全量送）",
    "否则直接丢弃，不调用付费 LLM",
])
card(CX2, 452, CW, 186, 3, "#c084fc", "LLM 打分 scoreBatch · deepseek-v4-flash", [
    "整批送评（每批 25 条 · 并发 4），输出 value/topics/reason",
    "value 0–100 评分档：",
    "• 80–100 直接可执行 / 必知的重大能力或发布",
    "• 50–79 相关、有信息但不紧急",
    "• 20–49 沾边或浅薄      • 0–19 营销 / 炒冷饭 / 低信噪",
    "惩罚空洞炒作，奖励具体技术细节 →  llmValue = value / 100",
])
card(CX2, 654, CW, 186, 4, "#34d399", "质量分 Q computeQuality（以 LLM 为主）", [
    "Q = llmValue + 0.30·(rel − 0.5) + 0.15·(trust − 0.5)，裁剪 [0,1]",
    "信任分 trust（按来源）：",
    "• 官方站 openai / anthropic / deepmind = 0.95",
    "      research.google = 0.9 · cursor = 0.85",
    "• Twitter following 0.6 / for-you 0.45",
    "• 默认 rss 0.6 · hn / reddit / twitter 0.5",
])
card(CX2, 856, CW, 168, 5, "#f59e0b", "门槛 passesGate & 点赞救援 likeRescues", [
    "• 通过门槛：Q ≥ 0.55（Twitter following 降到 ≥ 0.45）",
    "• rescue 带：0.45 ≤ Q < 0.55（门槛下方 0.10）",
    "• likeRescues：与近 90 天点赞内容余弦 ≥ 0.85 → 救回 keep",
    "• 否则丢弃，不写入正式层",
    "novelty 仅对 keep 项算 7 天向量新颖度，不参与门槛",
])

add('</svg>')

with open(OUT, "w", encoding="utf-8") as f:
    f.write("\n".join(L))
print("wrote", OUT)
