import { ColorSettings } from 'lilak-ui'
import { useLang } from '../../context/LangContext'

/**
 * Appearance settings — rebuilt on the kit `ColorSettings` editor.
 *
 * Replaces the old static slate-styled color inventory with the interactive kit
 * component: pick a preset (Bright / Dark / Low contrast / Teal / Teal Dark +
 * saved customs), edit any token live via the ColorPicker popover (hex /
 * copy / paste), and save the current edits as a named preset.
 */
export default function ColorPaletteSection() {
  const { t } = useLang()
  return (
    <div className="max-w-5xl">
      <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
        {t('settings_palette') || 'Color palette'}
      </h2>
      <p className="text-xs mb-5" style={{ color: 'var(--text-muted)' }}>
        {t('palette_hint') || 'Pick a preset or edit any color; changes apply live and can be saved as a preset.'}
      </p>
      <ColorSettings
        labels={{
          presets: t('cs_presets') || 'Presets',
          edit: t('cs_edit') || 'Edit colors',
          save: t('cs_save') || 'Save as preset',
          reset: t('cs_reset') || 'Reset',
          namePH: t('cs_nameph') || 'My palette',
        }}
      />
    </div>
  )
}
