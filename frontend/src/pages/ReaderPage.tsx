import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AuthModal } from '../components/AuthModal'
import { useAuth } from '../context/AuthContext'
import { ReaderMobile } from './reader/ReaderMobile'
import { ReaderPC } from './reader/ReaderPC'
import { useReaderBook } from './reader/useReaderBook'
import '../styles/reader.css'

const MOBILE_QUERY = '(max-width: 760px)'

function useIsMobile() {
  const [m, setM] = useState(() => window.matchMedia(MOBILE_QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY)
    const on = () => setM(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return m
}

function State({ title, text, children }: { title: string; text?: string; children?: React.ReactNode }) {
  return (
    <div className="rd-state">
      <div>
        <h2>{title}</h2>
        {text ? <p>{text}</p> : null}
        <div className="btns">{children}</div>
      </div>
    </div>
  )
}

function Reader({ id }: { id: string }) {
  const isMobile = useIsMobile()
  const { core, error } = useReaderBook(id)

  if (error) {
    if (error.status === 404) {
      return (
        <State title="找不到这本书" text="链接可能已失效，或它不在你的书架里。">
          <Link className="main" to="/shelf">
            回到书架
          </Link>
        </State>
      )
    }
    return (
      <State title="暂时无法阅读" text={error.message}>
        <Link className="main" to="/shelf">
          回到书架
        </Link>
        <button type="button" onClick={() => location.reload()}>
          重试
        </button>
      </State>
    )
  }
  if (!core) return <State title="正在打开…" />
  if (!core.book.chapters.length) {
    return (
      <State title="这本书没有可读内容" text="文件里没有解析到正文，可以尝试下载原文件阅读。">
        <Link className="main" to="/shelf">
          回到书架
        </Link>
      </State>
    )
  }
  return isMobile ? <ReaderMobile key={id} core={core} /> : <ReaderPC key={id} core={core} />
}

export function ReaderPage() {
  const { id = '' } = useParams()
  const { user, loading, openAuth } = useAuth()

  useEffect(() => {
    if (!loading && !user) openAuth('login')
  }, [loading, user, openAuth])

  useEffect(() => {
    const prev = document.title
    return () => {
      document.title = prev
    }
  }, [])

  return (
    <>
      {loading ? (
        <State title="正在打开…" />
      ) : !user ? (
        <State title="登录后继续阅读" text="阅读进度、书签会保存在你的账号里，换设备也能续读。">
          <button type="button" className="main" onClick={() => openAuth('login')}>
            登录 / 注册
          </button>
          <Link to="/">回到首页</Link>
        </State>
      ) : (
        <Reader id={id} key={id} />
      )}
      <AuthModal />
    </>
  )
}
