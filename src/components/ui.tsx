import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-stone-200/90 bg-white dark:border-stone-800 dark:bg-stone-950 ${className}`}>{children}</div>
}

export function Button({ className = '', variant = 'primary', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }) {
  const styles = {
    primary: 'bg-stone-950 text-white hover:bg-stone-800 disabled:bg-stone-400 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white',
    secondary: 'border border-stone-200 bg-white text-stone-800 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800',
    danger: 'bg-rose-600 text-white hover:bg-rose-500',
    ghost: 'bg-transparent text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-900',
  }
  return <button className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`} {...props} />
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-500/10 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100 ${className}`} {...props} />
}

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-500/10 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100 ${className}`} {...props} />
}

export function Textarea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`w-full resize-y rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-500/10 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100 ${className}`} {...props} />
}

export function Label({ children }: { children: ReactNode }) {
  return <label className="mb-1.5 block text-xs font-medium text-stone-500 dark:text-stone-400">{children}</label>
}

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'green' | 'red' | 'indigo' | 'amber' }) {
  const tones = {
    slate: 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300',
    green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
    red: 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300',
    indigo: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
  }
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${tones[tone]}`}>{children}</span>
}

export function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return <div className="flex min-h-52 flex-col items-center justify-center rounded-2xl border border-dashed border-stone-300 px-6 py-10 text-center dark:border-stone-700"><div className="text-sm font-semibold text-stone-800 dark:text-stone-100">{title}</div><div className="mt-1 max-w-md text-sm text-stone-500">{text}</div>{action && <div className="mt-5">{action}</div>}</div>
}
