export default function MarketSelector({ markets, selected, onChange }) {
  return (
    <div className="control-group">
      <label className="control-label">Market</label>
      <select
        className="select"
        value={selected.id}
        onChange={(e) => onChange(markets.find(m => m.id === e.target.value))}
      >
        {markets.map(market => (
          <option key={market.id} value={market.id}>
            {market.symbol}
          </option>
        ))}
      </select>
    </div>
  )
}
