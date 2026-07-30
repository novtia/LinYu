import type { Components } from 'react-markdown'
import ReactMarkdown from 'react-markdown'
import { ApiError, api } from '../lib/api'
import { useToast } from '../context/ToastContext'

function isSiteFileUrl(href: string | undefined): boolean {
  if (!href) return false
  try {
    const u = href.startsWith('http') ? new URL(href) : new URL(href, window.location.origin)
    if (u.origin !== window.location.origin) return false
    return u.pathname.startsWith('/uploads/') || u.pathname.startsWith('/api/downloads/')
  } catch {
    return href.startsWith('/uploads/') || href.startsWith('/api/downloads/')
  }
}

function filenameFromLink(href: string, children: React.ReactNode): string {
  const text = extractText(children).trim()
  if (text && /\.[a-zA-Z0-9]{1,12}$/.test(text)) return text
  try {
    const path = (href.startsWith('http') ? new URL(href).pathname : href.split('?')[0]).replace(/\\/g, '/')
    const base = decodeURIComponent(path.split('/').pop() || 'download')
    const m = /^[a-f0-9]{8,16}_(.+)$/i.exec(base)
    return m ? m[1] : base || 'download'
  } catch {
    return 'download'
  }
}

function extractText(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (typeof node === 'object' && 'props' in node) {
    return extractText((node as { props?: { children?: React.ReactNode } }).props?.children)
  }
  return ''
}

function MarkdownLink({
  href,
  children,
  ...rest
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown }) {
  const { showToast } = useToast()
  const fileLink = isSiteFileUrl(href)

  if (!fileLink) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
        {children}
      </a>
    )
  }

  const name = filenameFromLink(href || '', children)

  return (
    <a
      href={href}
      {...rest}
      download={name}
      onClick={async (e) => {
        e.preventDefault()
        if (!href) return
        try {
          await api.download(href, name)
        } catch (err) {
          showToast(err instanceof ApiError ? err.message : '下载失败')
        }
      }}
    >
      {children}
    </a>
  )
}

const components: Components = {
  a: MarkdownLink,
}

export function MarkdownContent({ content, className = '' }: { content: string; className?: string }) {
  const src = (content || '').trim() || '*暂无详细介绍*'
  return (
    <div className={`md-content ${className}`}>
      <ReactMarkdown components={components}>{src}</ReactMarkdown>
    </div>
  )
}
