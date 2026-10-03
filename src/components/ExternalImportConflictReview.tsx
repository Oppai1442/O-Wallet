import { useMemo, useState } from 'react'
import type { ExternalImportConflict, ExternalImportConflictDecision } from '../lib/externalImportConflicts'
import { Button } from './ui'

const PAGE_SIZE = 50

function txText(tx: ExternalImportConflict['incoming'], locale: string) {
  const amount = new Intl.NumberFormat(locale).format(tx.amount)
  const time = new Date(tx.occurredAt).toLocaleString(locale)
  const detail = tx.merchant || tx.description || tx.note || '—'
  return { amount: `${amount} ${tx.currency}`, time, detail }
}

export function ExternalImportConflictReview(props: {
  conflicts: ExternalImportConflict[]
  decisions: Record<string, ExternalImportConflictDecision>
  locale: string
  onDecision: (id: string, decision: ExternalImportConflictDecision) => void
  onAll: (decision: ExternalImportConflictDecision) => void
}) {
  const { conflicts, decisions, locale, onDecision, onAll } = props
  const [page, setPage] = useState(0)
  const vi = locale.startsWith('vi')
  const pages = Math.max(1, Math.ceil(conflicts.length / PAGE_SIZE))
  const safePage = Math.min(page, pages - 1)
  const visible = useMemo(() => conflicts.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE), [conflicts, safePage])
  const unresolved = conflicts.filter((conflict) => !decisions[conflict.id]).length
  const replaced = conflicts.filter((conflict) => decisions[conflict.id] === 'replace').length
  const ignored = conflicts.filter((conflict) => decisions[conflict.id] === 'ignore').length

  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50/70 p-3 dark:border-amber-800 dark:bg-amber-950/20 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-bold text-amber-950 dark:text-amber-100">
            {vi ? `Phát hiện ${conflicts.length} giao dịch có khả năng trùng` : `${conflicts.length} possible duplicate transactions found`}
          </div>
          <div className="mt-1 max-w-3xl text-xs leading-5 text-amber-800/80 dark:text-amber-200/80">
            {vi
              ? 'O-Wallet chặn import trước khi ghi dữ liệu. Cùng nguồn import hoặc cùng loại, số tiền, tiền tệ, tài khoản và cùng ngày/giờ/phút sẽ được đưa vào đây để bạn quyết định.'
              : 'O-Wallet pauses before writing data. Same import source, or the same type, amount, currency, account and date/hour/minute, is surfaced here for your decision.'}
          </div>
        </div>
        <div className="text-xs font-semibold text-amber-900 dark:text-amber-100">
          {vi ? `Chưa xử lý ${unresolved} · Thay ${replaced} · Bỏ qua ${ignored}` : `Unresolved ${unresolved} · Replace ${replaced} · Ignore ${ignored}`}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => onAll('ignore')}>{vi ? 'Bỏ qua tất cả phần trùng' : 'Ignore all duplicates'}</Button>
        <Button onClick={() => onAll('replace')}>{vi ? 'Thay thế tất cả bằng bản import' : 'Replace all with imported data'}</Button>
      </div>

      <div className="mt-3 space-y-2">
        {visible.map((conflict) => {
          const oldTx = txText(conflict.existing, locale)
          const newTx = txText(conflict.incoming, locale)
          const decision = decisions[conflict.id]
          return (
            <div key={conflict.id} className="rounded-xl border border-amber-200 bg-white p-3 dark:border-amber-900 dark:bg-stone-950">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <span className="font-semibold text-amber-800 dark:text-amber-200">
                  {conflict.reason === 'same-source'
                    ? (vi ? 'Trùng nguồn import' : 'Same import source')
                    : (vi ? 'Trùng số tiền + thời gian đến phút' : 'Same amount + minute')}
                </span>
                {decision && <span className="font-bold text-stone-600 dark:text-stone-300">{decision === 'replace' ? (vi ? 'Sẽ thay thế' : 'Will replace') : (vi ? 'Sẽ bỏ qua' : 'Will ignore')}</span>}
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <div className="rounded-lg bg-stone-50 p-2.5 text-xs dark:bg-stone-900">
                  <div className="font-bold text-stone-700 dark:text-stone-200">{vi ? 'Đang có trong O-Wallet' : 'Existing in O-Wallet'}</div>
                  <div className="mt-1">{oldTx.amount}</div><div>{oldTx.time}</div><div className="mt-1 break-words text-stone-500">{oldTx.detail}</div>
                </div>
                <div className="rounded-lg bg-blue-50 p-2.5 text-xs dark:bg-blue-950/30">
                  <div className="font-bold text-blue-800 dark:text-blue-200">{vi ? 'Từ file đang import' : 'Incoming from backup'}</div>
                  <div className="mt-1">{newTx.amount}</div><div>{newTx.time}</div><div className="mt-1 break-words text-stone-500">{newTx.detail}</div>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => onDecision(conflict.id, 'ignore')}>{vi ? 'Giữ bản hiện tại' : 'Keep existing'}</Button>
                <Button onClick={() => onDecision(conflict.id, 'replace')}>{vi ? 'Thay bằng bản import' : 'Replace with import'}</Button>
              </div>
            </div>
          )
        })}
      </div>

      {pages > 1 && (
        <div className="mt-3 flex items-center justify-between gap-2 text-xs text-stone-500">
          <Button variant="secondary" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={safePage === 0}>{vi ? 'Trang trước' : 'Previous'}</Button>
          <span>{vi ? `Trang ${safePage + 1}/${pages}` : `Page ${safePage + 1}/${pages}`}</span>
          <Button variant="secondary" onClick={() => setPage((value) => Math.min(pages - 1, value + 1))} disabled={safePage >= pages - 1}>{vi ? 'Trang sau' : 'Next'}</Button>
        </div>
      )}
    </div>
  )
}
