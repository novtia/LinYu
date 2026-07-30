import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

interface ToastContextValue {
  showToast: (msg: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState('')
  const [visible, setVisible] = useState(false)
  const timer = useRef<number | null>(null)

  const showToast = useCallback((text: string) => {
    setMsg(text)
    setVisible(true)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setVisible(false), 2800)
  }, [])

  const value = useMemo(() => ({ showToast }), [showToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className={`fixed bottom-7 left-1/2 z-[100] -translate-x-1/2 rounded-[14px] bg-ink px-5 py-3 text-[0.9rem] font-medium text-white shadow-[0_18px_40px_-20px_rgba(20,32,28,.5)] transition-all duration-300 ${
          visible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0'
        }`}
        role="status"
      >
        {msg}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
