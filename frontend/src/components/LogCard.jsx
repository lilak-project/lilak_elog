// Rebuilt with the lilak-ui kit: delegates to the kit's LogEntryCard so the
// whole log feed renders through the shared component. (Research/lilak/elog)
import { LogEntryCard } from 'lilak-ui'
import { useTagColors } from '../utils/tagColors'

export default function LogCard({ entry, viewMode = 'normal', focused = false, onToggle }) {
  const tagColorMap = useTagColors()
  return (
    <LogEntryCard
      entry={entry}
      viewMode={viewMode}
      focused={focused}
      onClick={onToggle}
      tagColorMap={tagColorMap}
    />
  )
}
