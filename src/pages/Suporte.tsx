import { useI18n } from '../i18n/I18nProvider'

export default function Suporte() {
  const { t } = useI18n()
  const faqs = [
    { q: t('support.faq1q'), a: t('support.faq1a') },
    { q: t('support.faq2q'), a: t('support.faq2a') },
    { q: t('support.faq3q'), a: t('support.faq3a') },
    { q: t('support.faq4q'), a: t('support.faq4a') },
    { q: t('support.faq5q'), a: t('support.faq5a') },
    { q: t('support.faq6q'), a: t('support.faq6a') },
  ]

  return (
    <div className="page-content">
      <div className="page-header">
        <h1 className="page-title">{t('support.title')}</h1>
        <p className="page-subtitle">{t('support.subtitle')}</p>
      </div>

      <div className="suporte-page-grid">
        <div className="faq-list">
          {faqs.map((f, i) => (
            <div key={i} className="faq-item">
              <div className="faq-q">❓ {f.q}</div>
              <div className="faq-a">{f.a}</div>
            </div>
          ))}
        </div>

        <div className="suporte-contato">
          <div className="contato-titulo">{t('support.contactTitle')}</div>
          <p className="contato-desc">{t('support.contactDesc')}</p>
        </div>
      </div>
    </div>
  )
}
