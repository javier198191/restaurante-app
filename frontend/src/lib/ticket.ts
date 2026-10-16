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

export interface CuentaItem {
  id?: number
  producto_id?: number | string
  cantidad: number
  precio_unitario?: number | null
  precio?: number | null
  nombre?: string
  productos?: {
    nombre?: string
    precio?: number
  } | null
  producto?: {
    nombre?: string
    precio?: number
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

function formatPesos(valor: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(Math.round(valor))
}

/**
 * Genera el documento XML conforme al protocolo Epson ePOS-Print XML para comandas de cocina/mesa.
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
  const pedidoTexto =
    ronda_numero !== undefined && ronda_numero !== null && Number(ronda_numero) > 0
      ? `Pedido #${pedido.id}.${ronda_numero}`
      : `Pedido #${pedido.id}`

  const lines: string[] = [
    '<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">',
    // Encabezado en tamaño grande: width="2" height="2"
    `  <text align="center" width="2" height="2" em="true">COMANDA - Mesa ${escapeXml(String(mesaNumero))}&#10;</text>`,
    '  <feed line="1" />',
    `  <text align="center" width="1" height="1">Fecha: ${escapeXml(String(formattedDate))}&#10;</text>`,
    `  <text align="center" width="1" height="1" em="true">${escapeXml(String(pedidoTexto))}&#10;</text>`,
  ]

  const mesero = mesero_nombre || pedido.mesero
  if (mesero) {
    lines.push(`  <text align="center" width="1" height="1">Mesero: ${escapeXml(String(mesero))}&#10;</text>`)
  }

  lines.push('  <text align="center" width="1" height="1">------------------------------------------&#10;</text>')
  lines.push('  <feed line="1" />')

  // Lista de items: casilla de verificación "[ ] " antes de cantidad y nombre, y la nota en línea aparte si existe
  for (const item of items) {
    const nombre = item.nombre || item.productos?.nombre || item.producto?.nombre || 'Producto'
    lines.push(`  <text align="left" width="1" height="1" em="true">[ ] ${escapeXml(String(item.cantidad))}x ${escapeXml(String(nombre))}&#10;</text>`)

    if (item.nota && item.nota.trim() !== '') {
      lines.push(`  <text align="left" width="1" height="1">   * NOTA: ${escapeXml(String(item.nota.trim()))}&#10;</text>`)
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

/**
 * Genera el documento XML de precuenta / cuenta conforme al protocolo Epson ePOS-Print XML.
 * Agrupa productos por nombre y precio_unitario (sumando cantidades de todas las rondas).
 * Función pura sin llamadas de red ni dependencias externas.
 */
export function buildCuentaXML(
  pedido: TicketPedido,
  items: CuentaItem[],
  mesaInfo?: MesaInfo,
  mesero?: string | null
): string {
  let mesaNumero = 'General'
  if (typeof mesaInfo === 'object' && mesaInfo !== null && 'numero' in mesaInfo) {
    mesaNumero = String(mesaInfo.numero ?? 'General')
  } else if (mesaInfo !== null && mesaInfo !== undefined) {
    mesaNumero = String(mesaInfo)
  }

  const now = new Date()
  const formattedDate = now.toLocaleString('es-CO', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  // Agrupar items por nombre y precio_unitario sumando cantidades
  interface GrupoItem {
    nombre: string
    precioUnitario: number
    cantidadTotal: number
    totalLinea: number
  }

  const grupos = new Map<string, GrupoItem>()

  for (const it of items) {
    const nombre = it.nombre || it.productos?.nombre || it.producto?.nombre || 'Producto'
    const precioUnitario = Number(
      it.precio_unitario !== null && it.precio_unitario !== undefined
        ? it.precio_unitario
        : it.precio !== null && it.precio !== undefined
        ? it.precio
        : it.productos?.precio !== null && it.productos?.precio !== undefined
        ? it.productos.precio
        : it.producto?.precio ?? 0
    )
    const key = `${nombre}___${precioUnitario}`
    const cantidad = Number(it.cantidad || 0)

    const existente = grupos.get(key)
    if (existente) {
      existente.cantidadTotal += cantidad
      existente.totalLinea = existente.cantidadTotal * existente.precioUnitario
    } else {
      grupos.set(key, {
        nombre,
        precioUnitario,
        cantidadTotal: cantidad,
        totalLinea: cantidad * precioUnitario,
      })
    }
  }

  const subtotal = Array.from(grupos.values()).reduce((acc, g) => acc + g.totalLinea, 0)
  const propinaSugerida = Math.round(subtotal * 0.1)
  const totalConPropina = subtotal + propinaSugerida

  const meseroNombre = mesero || pedido.mesero

  const lines: string[] = [
    '<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">',
    // "CUENTA - Mesa [numero]" en tamaño grande
    `  <text align="center" width="2" height="2" em="true">CUENTA - Mesa ${escapeXml(String(mesaNumero))}&#10;</text>`,
    '  <feed line="1" />',
    `  <text align="center" width="1" height="1">Pedido #${escapeXml(String(pedido.id))}&#10;</text>`,
    `  <text align="center" width="1" height="1">Fecha: ${escapeXml(String(formattedDate))}&#10;</text>`,
  ]

  if (meseroNombre) {
    lines.push(`  <text align="center" width="1" height="1">Mesero: ${escapeXml(String(meseroNombre))}&#10;</text>`)
  }

  lines.push('  <text align="center" width="1" height="1">------------------------------------------&#10;</text>')
  lines.push('  <feed line="1" />')

  // Una línea por producto con cantidad, nombre y valor de la línea
  for (const g of grupos.values()) {
    const textoLinea = `${String(g.cantidadTotal)}x ${g.nombre}`
    const textoValor = formatPesos(g.totalLinea)
    lines.push(
      `  <text align="left" width="1" height="1">${escapeXml(String(textoLinea))} - ${escapeXml(String(textoValor))}&#10;</text>`
    )
  }

  lines.push('  <feed line="1" />')
  lines.push('  <text align="center" width="1" height="1">------------------------------------------&#10;</text>')
  lines.push(`  <text align="right" width="1" height="1">Subtotal: ${escapeXml(String(formatPesos(subtotal)))}&#10;</text>`)
  lines.push(`  <text align="right" width="1" height="1">Propina sugerida 10% (voluntaria): ${escapeXml(String(formatPesos(propinaSugerida)))}&#10;</text>`)
  lines.push('  <feed line="1" />')
  lines.push(`  <text align="right" width="1" height="1" em="true">Total con propina sugerida: ${escapeXml(String(formatPesos(totalConPropina)))}&#10;</text>`)
  lines.push('  <feed line="1" />')
  lines.push('  <text align="center" width="1" height="1">------------------------------------------&#10;</text>')
  lines.push('  <text align="center" width="1" height="1">La propina es voluntaria:&#10;puede aceptarla, modificarla o rechazarla&#10;</text>')
  lines.push('  <feed line="1" />')
  lines.push('  <text align="center" width="1" height="1">Este documento no es una factura&#10;</text>')
  lines.push('  <feed line="3" />')
  lines.push('  <cut type="feed" />')
  lines.push('</epos-print>')

  return lines.join('\n')
}
