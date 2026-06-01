import React, { useState, useRef, useEffect } from 'react'

const LANG = {
  zh: { title: '已选 {n} 个元素', placeholder: '输入改进描述...', apply: '应用改进', cancel: '取消' },
  en: { title: '{n} elements selected', placeholder: 'Enter modification instruction...', apply: 'Apply', cancel: 'Cancel' }
}

export default function BatchModifyInput({ count, onSubmit, onCancel, language = 'zh' }) {
  const [value, setValue] = useState('')
  const inputRef = useRef(null)
  const t = LANG[language]

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = () => {
    if (value.trim()) {
      onSubmit(value.trim())
      setValue('')
    }
  }

  return (
    <div className="batch-modify-card">
      <div className="batch-modify-header">
        ✨ {t.title.replace('{n}', count)}
      </div>
      <textarea
        ref={inputRef}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() } }}
        placeholder={t.placeholder}
        rows={3}
        className="batch-modify-textarea"
      />
      <div className="batch-modify-actions">
        <button
          onClick={handleSubmit}
          className="btn btn-warning"
          style={{ flex: 1 }}
        >{t.apply}</button>
        <button onClick={onCancel} className="btn btn-ghost">{t.cancel}</button>
      </div>
    </div>
  )
}
