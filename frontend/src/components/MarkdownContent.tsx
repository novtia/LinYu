import ReactMarkdown from 'react-markdown'

export function MarkdownContent({ content, className = '' }: { content: string; className?: string }) {
  const src = (content || '').trim() || '*暂无详细介绍*'
  return (
    <div className={`md-content ${className}`}>
      <ReactMarkdown>{src}</ReactMarkdown>
    </div>
  )
}
