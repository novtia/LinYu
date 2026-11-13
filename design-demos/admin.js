/* 领匣后台设计稿 · 共用小交互 */
function lxIcons() {
  if (window.lucide) {
    lucide.createIcons({ attrs: { width: 16, height: 16, "stroke-width": 1.75 } })
  }
}
let lxToastTimer = 0
function lxToast(text) {
  const el = document.getElementById("toast")
  if (!el) return
  el.textContent = text
  el.classList.add("show")
  clearTimeout(lxToastTimer)
  lxToastTimer = setTimeout(() => el.classList.remove("show"), 2200)
}
function lxDate() {
  const el = document.getElementById("today")
  if (!el) return
  const d = new Date()
  el.textContent = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} 周${"日一二三四五六"[d.getDay()]}`
}
function lxGreet() {
  const h = new Date().getHours()
  if (h < 5) return "夜深了"
  if (h < 11) return "早上好"
  if (h < 14) return "中午好"
  if (h < 18) return "下午好"
  return "晚上好"
}
function lxYuan(n) {
  const v = Math.round(Number(n))
  return "¥" + v.toLocaleString("zh-CN")
}
function lxSpark(values) {
  const w = 72, h = 28
  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = max - min || 1
  const pts = values.map((v, i) => {
    const x = values.length === 1 ? w / 2 : (i / (values.length - 1)) * w
    const y = h - 3 - ((v - min) / span) * (h - 8)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(" ")
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`
}