export interface TicketPedido {
  id: number | string
  fecha_apertura?: string
  created_at?: string
  mesero?: string
}

export interface TicketItem {
  cantidad: number
  nota?: string | null
  nombre?: string
  productos?: {
    nombre: string
  } | null
  producto?: {
    nombre: string
  } | null
}

export interface TicketMesa {
  numero?: string | number
}

export type MesaInfo = TicketMesa | string | number | null | undefined

function escapeXml(unsafe: string | number | null | undefined): string {
  if (unsafe === null || unsafe === undefined) return ''
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Genera el documento XML conforme al protocolo Epson ePOS-Print XML.
 * Función pura sin llamadas de red ni dependencias externas.
 */
export function buildTicketXML(
  pedido: TicketPedido,
  items: TicketItem[],
  mesaInfo?: MesaInfo,
  ronda_numero?: number | null,
  mesero_nombre?: string | null
): string {
  let mesaNumero = 'General'
  if (typeof mesaInfo === 'object' && mesaInfo !== null && 'numero' in mesaInfo) {
    mesaNumero = String(mesaInfo.numero ?? 'General')
  } else if (mesaInfo !== null && mesaInfo !== undefined) {
    mesaNumero = String(mesaInfo)
  }

  // Fecha y hora actuales al momento de generar la comanda
  const now = new Date()
  const formattedDate = now.toLocaleString('es-CO', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  // Encabezado del pedido según la ronda:
  // Si el pedido es 120 y la ronda es 1, debe imprimir "Pedido #120.1".
  // Si la ronda es 0 (pedido inicial), imprime "Pedido #120".
  const pedidoTexto =
    ronda_numero !== undefined && ronda_numero !== null && Number(ronda_numero) > 0
      ? `Pedido #${pedido.id}.${ronda_numero}`
      : `Pedido #${pedido.id}`

  const lines: string[] = [
    '<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">',
    // Encabezado en tamaño grande: width="2" height="2"
    `  <text align="center" width="2" height="2" em="true">COMANDA - Mesa ${escapeXml(mesaNumero)}&#10;</text>`,
    '  <feed line="1" />',
    `  <text align="center" width="1" height="1">Fecha: ${escapeXml(formattedDate)}&#10;</text>`,
    `  <text align="center" width="1" height="1" em="true">${escapeXml(pedidoTexto)}&#10;</text>`,
  ]

  const mesero = mesero_nombre || pedido.mesero
  if (mesero) {
    lines.push(`  <text align="center" width="1" height="1">Mesero: ${escapeXml(mesero)}&#10;</text>`)
  }

  lines.push('  <text align="center" width="1" height="1">------------------------------------------&#10;</text>')
  lines.push('  <feed line="1" />')

  // Lista de items: casilla de verificación "[ ] " antes de cantidad y nombre, y la nota en línea aparte si existe
  for (const item of items) {
    const nombre = item.nombre || item.productos?.nombre || item.producto?.nombre || 'Producto'
    lines.push(`  <text align="left" width="1" height="1" em="true">[ ] ${escapeXml(String(item.cantidad))}x ${escapeXml(nombre)}&#10;</text>`)

    if (item.nota && item.nota.trim() !== '') {
      lines.push(`  <text align="left" width="1" height="1">   * NOTA: ${escapeXml(item.nota.trim())}&#10;</text>`)
    }
  }

  // Cierre y corte de papel
  lines.push('  <feed line="1" />')
  lines.push('  <text align="center" width="1" height="1">------------------------------------------&#10;</text>')
  lines.push('  <feed line="3" />')
  lines.push('  <cut type="feed" />')
  lines.push('</epos-print>')

  return lines.join('\n')
}
