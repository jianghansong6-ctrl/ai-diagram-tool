import React from 'react'

export default function ProgressBar({ percent, label, sublabel, indeterminate = false, visible = true }) {
  if (!visible) return null

  return (
    <div className="progress-bar-container">
      {indeterminate ? (
        <div className="progress-bar indeterminate">
          <div className="progress-bar-fill-indet" />
        </div>
      ) : (
        <div className="progress-bar">
          <div
            className="progress-bar-fill"
            style={{ width: `${Math.min(percent, 100)}%` }}
          />
        </div>
      )}
      {(label || sublabel) && (
        <div className="progress-bar-info">
          {label && <span className="progress-bar-label">{label}</span>}
          {sublabel && <span className="progress-bar-sublabel" title={sublabel}>{sublabel}</span>}
        </div>
      )}
    </div>
  )
}
