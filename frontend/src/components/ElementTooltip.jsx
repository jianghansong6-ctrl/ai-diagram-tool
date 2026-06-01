import React, { useState } from 'react'

const LANG = {
  zh: { selected: '选中:', placeholder: '修改提示，如：改成红色', apply: '应用修改', cancel: '取消', delete: '删除' },
  en: { selected: 'Selected:', placeholder: 'e.g.: change to red', apply: 'Apply', cancel: 'Cancel', delete: 'Delete' }
}

export default function ElementTooltip({ element, position, onModify, onDelete, onClose, language = 'zh' }) {
  const [instruction, setInstruction] = useState('')
  const t = LANG[language]

  const handleSubmit = () => {
    if (!instruction.trim()) return
    onModify(element.id, instruction.trim())
    setInstruction('')
  }

  if (!element) return null

  const label = element.params?.label || element.description || element.action

  return (
    <div
      className="element-tooltip"
      style={{
        left: `${Math.min(position.x + 12, window.innerWidth - 320)}px`,
        top: `${Math.max(position.y - 90, 10)}px`,
      }}
    >
      <div className="tooltip-element-name">{t.selected} {label}</div>
      {element.description && element.description !== element.action && (
        <div className="tooltip-description">{element.description}</div>
      )}
      <input
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder={t.placeholder}
        className="tooltip-input"
        onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit() }}
      />
      <div className="tooltip-actions">
        <button
          onClick={handleSubmit}
          className="tooltip-btn tooltip-btn-primary"
          disabled={!instruction.trim()}
        >{t.apply}</button>
        <button onClick={() => onDelete(element.id)} className="tooltip-btn tooltip-btn-danger">{t.delete}</button>
        <button onClick={onClose} className="tooltip-btn tooltip-btn-ghost">{t.cancel}</button>
      </div>
    </div>
  )
}
