/* 我的书架 · 设计稿共用数据与小工具（PC / 手机两个页面共用）。示例数据均为原创，仅供设计演示。 */

/* state：ready 可在线阅读 · download 仅下载（如 PDF，无在线阅读入口）
          locked 约稿已交稿但未付尾款（不开放阅读） · making 约稿已付定金，创作中 */
const BOOKS = [
  { id: 1, title: "深夜维修工", author: "佚名", kind: "text", fmt: "TXT", chapters: 22, words: 6.8, state: "ready", hue: 232, bought: "2026-10-12", order: "LX20261012013", price: 12.8, ch: 2, pct: 9, last: 202610272241, lastLabel: "今天 22:41" },
  { id: 2, title: "潮汐图书馆", author: "林深雨", kind: "text", fmt: "EPUB", chapters: 36, words: 11.2, state: "ready", hue: 192, bought: "2026-10-03", order: "LX20261003007", price: 18, ch: 12, pct: 33, last: 202610262105, lastLabel: "昨天 21:05" },
  { id: 3, title: "雾港来信", author: "顾青岚", kind: "text", fmt: "TXT", chapters: 48, words: 15.6, state: "ready", hue: 12, bought: "2026-09-28", order: "LX20260928021", price: 9.9, ch: 48, pct: 100, last: 202610201930, lastLabel: "10-20" },
  { id: 4, title: "北纬三十度的夏天", author: "许知夏", kind: "text", fmt: "EPUB", chapters: 28, words: 8.9, state: "ready", hue: 36, bought: "2026-10-25", order: "LX20261025004", price: 15, ch: 0, pct: 0, last: 0, lastLabel: "" },
  { id: 5, title: "旧城电台", author: "周行", kind: "text", fmt: "TXT", chapters: 60, words: 19.4, state: "ready", hue: 282, bought: "2026-09-15", order: "LX20260915009", price: 22, ch: 41, pct: 68, last: 202610182250, lastLabel: "10-18" },
  { id: 6, title: "设计模式速查手册", author: "陈默", kind: "text", fmt: "PDF", chapters: 0, words: 0, state: "download", hue: 212, bought: "2026-10-08", order: "LX20261008016", price: 29, ch: 0, pct: 0, last: 0, lastLabel: "" },
  { id: 7, title: "灯塔守夜人", author: "专属约稿", kind: "commission", fmt: "TXT", chapters: 12, words: 3.2, state: "ready", hue: 205, bought: "2026-10-08", order: "LX20261008002", price: 480, ch: 3, pct: 22, last: 202610261612, lastLabel: "昨天 16:12" },
  { id: 8, title: "春分之后", author: "专属约稿", kind: "commission", fmt: "EPUB", chapters: 0, words: 2.0, state: "locked", hue: 336, bought: "2026-10-22", order: "LX20261022011", price: 600, due: 300, ch: 0, pct: 0, last: 0, lastLabel: "" },
  { id: 9, title: "白鸟与列车", author: "专属约稿", kind: "commission", fmt: "TXT", chapters: 0, words: 3.0, state: "making", hue: 218, bought: "2026-10-24", order: "LX20261024005", price: 720, eta: "11-05", ch: 0, pct: 0, last: 0, lastLabel: "" },
  { id: 10, title: "无名岛来信", author: "专属约稿", kind: "commission", fmt: "EPUB", chapters: 16, words: 2.4, state: "ready", hue: 160, bought: "2026-09-30", order: "LX20260930018", price: 520, ch: 0, pct: 0, last: 0, lastLabel: "" },
]

const ICON = {
  search: '<circle cx="11" cy="11" r="7.5"/><path d="m21 21-4.3-4.3"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  pen: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
  cart: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  receipt: '<path d="M4 2v20l3-2 3 2 2-2 2 2 3-2 3 2V2l-3 2-3-2-2 2-2-2-3 2z"/><path d="M8 9h8M8 13h6"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  eyeOff: '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  chevR: '<path d="m9 18 6-6-6-6"/>',
  chevL: '<path d="m15 18-6-6 6-6"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  compass: '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
  sort: '<path d="m3 16 4 4 4-4M7 20V4M21 8l-4-4-4 4M17 4v16"/>',
  dots: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
}
const ic = (n, s = 18, w = 1.7) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${ICON[n]}</svg>`

/* 封面：按色相生成渐变 + 竖排书名（真实页面用商品封面图，无封面时回退到这个样式） */
const cover = (b) => `<div class="cover" style="--h:${b.hue}"><span class="cv-t">${b.title}</span><small class="cv-a">${b.author}</small>${b.kind === "commission" ? '<em class="cv-tag">约稿</em>' : ""}${b.fmt !== "TXT" ? `<em class="cv-fmt">${b.fmt}</em>` : ""}</div>`

/* 进度文案 */
const readLabel = (b) => {
  if (b.state === "making") return `创作中 · 预计 ${b.eta} 交稿`
  if (b.state === "locked") return `已交稿 · 待付尾款 ¥${b.due}`
  if (b.state === "download") return "仅下载 · 无在线阅读"
  if (b.pct >= 100) return "已读完"
  if (!b.last) return "未读"
  return `读至第 ${b.ch} 章 · ${b.pct}%`
}
const kindLabel = (b) => (b.kind === "commission" ? "约稿" : "商城文本")
const wordsLabel = (b) => (b.words ? `${b.words} 万字` : "—")
