import { useEffect, useState } from 'react'
import { Wallet } from 'lucide-react'
import { WalletProvider, useWallet } from './WalletContext'
import { LanguageProvider, useI18n } from './i18n'
import { Onboarding } from './components/Onboarding'
import { Shell } from './components/Shell'
import { Unlock } from './components/Unlock'

function DelayedLoader() {
  const { t } = useI18n()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const id = window.setTimeout(() => setVisible(true), 140)
    return () => window.clearTimeout(id)
  }, [])

  if (!visible) return <div className="min-h-[100dvh]" aria-hidden="true" />

  return (
    <div className="ow-fade-in flex min-h-[100dvh] items-center justify-center px-4">
      <div className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 shadow-sm backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/80">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white"><Wallet size={20} /></div>
        <div><div className="font-black tracking-tight">O-Wallet</div><div className="text-xs text-slate-500">{t('app.loading')}</div></div>
      </div>
    </div>
  )
}

function TransactionKeyboardAssist() {
  useEffect(() => {
    let lastAmount: HTMLInputElement | null = null

    function parts() {
      const amount = document.querySelector<HTMLInputElement>('input[placeholder="150000"]')
      if (!amount) return undefined
      const modal = amount.closest<HTMLElement>('.fixed')
      if (!modal || !modal.className.includes('z-[70]')) return undefined

      let entryPane: HTMLElement | null = amount.parentElement
      while (entryPane?.parentElement && !String(entryPane.parentElement.className).includes('lg:grid-cols-[')) {
        entryPane = entryPane.parentElement
      }
      if (!entryPane) return undefined

      const amountRow = amount.parentElement?.parentElement
      const currency = amountRow?.querySelector<HTMLSelectElement>('select') ?? undefined
      const temporal = entryPane.querySelector<HTMLInputElement>(
        'input[type="datetime-local"]:not([disabled]), input[type="time"]:not([disabled]), input[type="date"]:not([disabled])',
      ) ?? undefined
      const footers = [...modal.querySelectorAll<HTMLElement>('div.flex.shrink-0.justify-end')]
      const footer = footers.at(-1)
      const footerButtons = footer ? [...footer.querySelectorAll<HTMLButtonElement>('button')] : []
      const saveButton = footerButtons.at(-1)
      return { amount, modal, entryPane, currency, temporal, saveButton }
    }

    function focusNewAmount() {
      const current = parts()?.amount ?? null
      if (!current) {
        lastAmount = null
        return
      }
      if (current === lastAmount) return
      lastAmount = current
      requestAnimationFrame(() => {
        if (document.contains(current) && !current.disabled) current.focus()
      })
    }

    const observer = new MutationObserver(focusNewAmount)
    observer.observe(document.body, { childList: true, subtree: true })
    focusNewAmount()

    const onKeyDown = (event: KeyboardEvent) => {
      const resolved = parts()
      if (!resolved) return
      const target = event.target
      if (!(target instanceof HTMLElement) || !resolved.modal.contains(target)) return

      if (event.key === 'Tab' && !event.shiftKey) {
        if (target === resolved.amount) {
          const next = resolved.currency && !resolved.currency.disabled ? resolved.currency : resolved.temporal
          if (next) {
            event.preventDefault()
            next.focus()
          }
          return
        }
        if (target === resolved.currency && resolved.temporal) {
          event.preventDefault()
          resolved.temporal.focus()
          return
        }
      }

      if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.defaultPrevented) return
      if (!(target instanceof HTMLInputElement) || !resolved.entryPane.contains(target)) return
      if (target.closest('[data-enter-consumes="true"]')) return
      if (['file', 'checkbox', 'radio', 'button', 'submit'].includes(target.type)) return
      if (!resolved.saveButton || resolved.saveButton.disabled) return
      event.preventDefault()
      resolved.saveButton.click()
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [])

  return null
}

function AppBody() {
  const { status, googleAutoConnecting, refresh } = useWallet()
  const [localReady, setLocalReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (status !== 'unlocked') {
      setLocalReady(false)
      return () => { cancelled = true }
    }

    // Local IndexedDB rows are encrypted. Hydrate/decrypt them immediately after
    // unlocking so Drive availability never gates the first useful render.
    setLocalReady(false)
    void refresh()
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLocalReady(true)
      })

    return () => { cancelled = true }
  }, [refresh, status])

  if (status === 'loading') return <DelayedLoader />
  if (status === 'new') return <div className="ow-fade-in"><Onboarding autoConnecting={googleAutoConnecting} /></div>
  if (status === 'locked') return <div className="ow-fade-in"><Unlock /></div>
  if (!localReady) return <DelayedLoader />
  return <div className="ow-fade-in"><TransactionKeyboardAssist /><Shell /></div>
}

export default function App() {
  return (
    <LanguageProvider>
      <WalletProvider><AppBody /></WalletProvider>
    </LanguageProvider>
  )
}
