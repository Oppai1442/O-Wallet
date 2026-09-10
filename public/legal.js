(() => {
  const KEY = 'o-wallet-legal-language'
  const root = document.documentElement
  const params = new URLSearchParams(location.search)
  const requested = params.get('lang')
  const stored = localStorage.getItem(KEY)
  const browser = navigator.language?.toLowerCase().startsWith('vi') ? 'vi' : 'en'
  const initial = requested === 'vi' || requested === 'en' ? requested : (stored === 'vi' || stored === 'en' ? stored : browser)

  function apply(lang) {
    root.dataset.legalLang = lang
    root.lang = lang
    localStorage.setItem(KEY, lang)
    document.querySelectorAll('[data-lang-button]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.getAttribute('data-lang-button') === lang))
    })
    document.querySelectorAll('[data-title-vi][data-title-en]').forEach((node) => {
      node.textContent = lang === 'vi' ? node.getAttribute('data-title-vi') : node.getAttribute('data-title-en')
    })
  }

  document.querySelectorAll('[data-lang-button]').forEach((button) => {
    button.addEventListener('click', () => apply(button.getAttribute('data-lang-button')))
  })

  apply(initial)
})()
