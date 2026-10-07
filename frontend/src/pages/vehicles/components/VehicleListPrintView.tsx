import { LTR_COLUMNS, type VehicleTableSnapshot } from '../vehicleTable'

export function VehicleListPrintView(props: {
  table: VehicleTableSnapshot
  title: string
  scopeLabel: string
}): React.JSX.Element {
  const { table, title, scopeLabel } = props

  return (
    // Own landscape page (`@page vehicle-list`); auto table layout sizes each
    // column to its content and data cells never wrap. A table wider than the
    // sheet is shrunk to fit (see the `:has(.print-vehicle-list)` rule in
    // index.css), so the heading and table carry the reading direction.
    <div className="hidden print:block print-vehicle-list">
      <div dir={table.direction} className="print-vehicle-list-heading">
        <h1>{title}</h1>
        <div>
          <span>{table.rows.length}</span>
          <span>{scopeLabel}</span>
        </div>
      </div>

      <table dir={table.direction} style={{ width: '100%' }}>
        <thead>
          <tr>
            {table.headers.map((header) => (
              <th key={header} scope="col">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>
                  {LTR_COLUMNS.has(cellIndex) ? <bdi dir="ltr">{cell}</bdi> : <bdi>{cell}</bdi>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
