import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { NewsFeed } from '#/components/news/NewsFeed'
import { PageHeader } from '#/ui/Layout'

export const Route = createFileRoute('/o/$orgId/news')({ component: NewsPage })

function NewsPage() {
  const { t } = useTranslation()
  return (
    <>
      <PageHeader title={t('news.title')} subtitle={t('news.subtitle')} />
      <div className="max-w-3xl">
        <NewsFeed />
      </div>
    </>
  )
}
