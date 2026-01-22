export default function PeriodSelector({ periods, selected, onChange }) {
  return (
    <div className="control-group">
      <label className="control-label">Period</label>
      <select
        className="select"
        value={selected.id}
        onChange={(e) => onChange(periods.find(p => p.id === e.target.value))}
      >
        {periods.map(period => (
          <option key={period.id} value={period.id}>
            {period.name}
          </option>
        ))}
      </select>
    </div>
  )
}
