import type { VehicleTableSnapshot } from '../vehicleTable'

const COLUMN_WIDTHS = ['20%', '29%', '17%', '17%', '17%'] as const

export function VehicleListPrintView(props: {
  table: VehicleTableSnapshot
  title: string
  scopeLabel: string
}): React.JSX.Element {
  const { table, title, scopeLabel } = props

  return (
    <div className="print-register hidden print:block print-vehicle-list">
      <div className="print-vehicle-list-heading">
        <h1>{title}</h1>
        <div>
          <span>{table.rows.length}</span>
          <span>{scopeLabel}</span>
        </div>
      </div>

      <table dir={table.direction} style={{ tableLayout: 'fixed', width: '100%' }}>
        <colgroup>
          {COLUMN_WIDTHS.map((width) => (
            <col key={width} style={{ width }} />
          ))}
        </colgroup>
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
                  {cellIndex === 0 || cellIndex >= 2 ? <bdi dir="ltr">{cell}</bdi> : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
