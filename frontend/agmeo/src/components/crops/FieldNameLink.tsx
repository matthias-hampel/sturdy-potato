import type { CropCycle, Field } from '@agmeo/contracts'
import { useOrg } from '#/lib/org'
import { Link } from '#/ui/Button'

/** A field name opening the crop's page (Feldinfo, Maßnahmen, Optimierung), or the field record without a crop. */
export function FieldNameLink({ field, cycle }: { field: Field; cycle: CropCycle | undefined | null }) {
  const { orgId } = useOrg()
  return cycle ? (
    <Link to="/o/$orgId/crops/$cropCycleId" params={{ orgId, cropCycleId: cycle.id }} className="font-medium">{field.name}</Link>
  ) : (
    <Link to="/o/$orgId/fields/$fieldId" params={{ orgId, fieldId: field.id }} className="font-medium">{field.name}</Link>
  )
}
