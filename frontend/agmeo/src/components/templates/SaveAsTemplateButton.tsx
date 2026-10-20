import type { CropCycle, CultivationTemplate } from '@agmeo/contracts'
import { BookmarkPlus } from 'lucide-react'
import { useState } from 'react'
import { DialogTrigger, Form } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { api } from '#/lib/api'
import { useOrgMutation } from '#/lib/queries'
import { Button } from '#/ui/Button'
import { TextField } from '#/ui/Field'
import { Dialog } from '#/ui/Overlay'

/** Saves the crop's operations as a new cultivation template (reference "Als Anbauvorlage speichern"). */
export function SaveAsTemplateButton({ cycle }: { cycle: CropCycle }) {
  const { t } = useTranslation()
  const [name, setName] = useState(`${cycle.cropName} · ${cycle.fieldName}`)
  const save = useOrgMutation((base, _: void) => api.post<CultivationTemplate>(`${base}/crop-cycles/${cycle.id}/save-as-template`, { name: name.trim() }), {
    success: (tpl: CultivationTemplate) => t('templates.saveCycle.done', { name: tpl.name, count: tpl.steps.length }),
  })
  return (
    <DialogTrigger>
      <Button>
        <BookmarkPlus /> {t('templates.saveCycle.button')}
      </Button>
      <Dialog title={t('templates.saveCycle.title')} size="sm">
        {(close) => (
          <Form onSubmit={(e) => { e.preventDefault(); save.mutate(undefined, { onSuccess: close }) }} className="space-y-4">
            <p className="text-sm text-fg-2">{t('templates.saveCycle.description')}</p>
            <TextField label={t('templates.copy.name')} value={name} onChange={setName} isRequired autoFocus />
            <div className="flex justify-end gap-2">
              <Button onPress={close}>{t('common.cancel')}</Button>
              <Button type="submit" variant="primary" isDisabled={!name.trim()} isPending={save.isPending}>
                {t('templates.saveCycle.submit')}
              </Button>
            </div>
          </Form>
        )}
      </Dialog>
    </DialogTrigger>
  )
}
