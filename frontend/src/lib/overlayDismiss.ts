import { useCallback, useRef, type MouseEventHandler, type PointerEventHandler } from 'react'

/**
 * 点击遮罩关闭弹层。
 * 按下和松开都必须落在遮罩上，避免输入框拖选或点击按钮时误关。
 */
export function useBackdropClose(onClose: () => void, enabled = true) {
  const pressedOnBackdrop = useRef(false)

  const onPointerDown = useCallback<PointerEventHandler<HTMLElement>>((e) => {
    pressedOnBackdrop.current = e.target === e.currentTarget
  }, [])

  const onPointerUp = useCallback<PointerEventHandler<HTMLElement>>((e) => {
    if (e.target !== e.currentTarget) pressedOnBackdrop.current = false
  }, [])

  const onClick = useCallback<MouseEventHandler<HTMLElement>>((e) => {
    const shouldClose = enabled && pressedOnBackdrop.current && e.target === e.currentTarget
    pressedOnBackdrop.current = false
    if (shouldClose) onClose()
  }, [enabled, onClose])

  return { onPointerDown, onPointerUp, onClick }
}
