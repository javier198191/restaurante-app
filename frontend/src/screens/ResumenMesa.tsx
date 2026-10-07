import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'

export interface ResumenMesaProps {
  mesaId?: number | string
  onVolver?: () => void
  onCobroExitoso?: () => void
  onAgregarProductos?: (mesaId?: number) => void
  onNavigate?: (view: string, mesaId?: number) => void
}

interface ItemDetalleResumen {
  id: number
  producto_id: number
  cantidad: number
  nota?: string | null
  nombre: string
  precio: number
  ronda_numero?: number
}

interface PedidoActivoRaw {
  id: number
  mesa_id: number
  estado: string
  fecha_apertura?: string
  mesas?: {
    id: number
    numero: string | number
  } | null
  rondas?: Array<{
    id: number
    numero: number
    mesero_nombre?: string | null
    fecha?: string
    detalle_pedido?: Array<{
      id: number
      producto_id: number
      cantidad: number
      nota?: string | null
      productos?: {
        id: number
        nombre: string
        precio: number
      } | null
    }> | null
  }> | null
  detalle_pedido?: Array<{
    id: number
    producto_id: number
    cantidad: number
    nota?: string | null
    ronda_id?: number | null
    productos?: {
      id: number
      nombre: string
      precio: number
    } | null
  }> | null
}

export const ResumenMesa: React.FC<ResumenMesaProps> = ({
  mesaId: propMesaId,
  onVolver,
  onCobroExitoso,
  onAgregarProductos,
  onNavigate,
}) => {

  // 1. Obtener mesaId de props o de la URL
  const mesaId = useMemo(() => {
    if (propMesaId !== undefined && propMesaId !== null) {
      return Number(propMesaId)
    }
    // Intentar leer de URL (/mesa/:id o query param ?mesa_id=)
    if (typeof window !== 'undefined') {
      const pathMatch = window.location.pathname.match(/\/mesa\/(\w+)/)
      if (pathMatch) return Number(pathMatch[1])

      const hashMatch = window.location.hash.match(/mesa\/(\w+)/)
      if (hashMatch) return Number(hashMatch[1])

      const urlParams = new URLSearchParams(window.location.search)
      const queryId = urlParams.get('mesa_id') || urlParams.get('id')
      if (queryId) return Number(queryId)
    }
    return 1
  }, [propMesaId])

  const [loading, setLoading] = useState<boolean>(true)
  const [cobrando, setCobrando] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [pedidoActivo, setPedidoActivo] = useState<PedidoActivoRaw | null>(null)
  const [incluirPropina, setIncluirPropina] = useState<boolean>(true)
  const [exitoCobro, setExitoCobro] = useState<boolean>(false)

  // 2. Cargar el pedido activo de la mesa
  const cargarResumen = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const { data, error: err } = await supabase
        .from('pedidos')
        .select(`
          id,
          mesa_id,
          estado,
          fecha_apertura,
          mesas (id, numero),
          rondas (
            id,
            numero,
            mesero_nombre,
            fecha,
            detalle_pedido (
              id,
              producto_id,
              cantidad,
              nota,
              productos (id, nombre, precio)
            )
          ),
          detalle_pedido (
            id,
            producto_id,
            cantidad,
            nota,
            ronda_id,
            productos (id, nombre, precio)
          )
        `)
        .eq('mesa_id', mesaId)
        .neq('estado', 'cerrado')
        .neq('estado', 'pagado')
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (err) {
        throw err
      }

      setPedidoActivo((data as unknown as PedidoActivoRaw) || null)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al cargar resumen de la mesa'
      console.error('Error al cargar pedido activo:', msg)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [mesaId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargarResumen()
  }, [cargarResumen])

  // 3. Consolidar items de todas las rondas y del detalle directo
  const itemsConsolidados = useMemo<ItemDetalleResumen[]>(() => {
    if (!pedidoActivo) return []

    const items: ItemDetalleResumen[] = []
    const procesadosIds = new Set<number>()

    // Extraer desde rondas si existen
    if (pedidoActivo.rondas && pedidoActivo.rondas.length > 0) {
      for (const ronda of pedidoActivo.rondas) {
        if (ronda.detalle_pedido) {
          for (const it of ronda.detalle_pedido) {
            procesadosIds.add(it.id)
            items.push({
              id: it.id,
              producto_id: it.producto_id,
              cantidad: it.cantidad,
              nota: it.nota,
              nombre: it.productos?.nombre || `Producto #${it.producto_id}`,
              precio: Number(it.productos?.precio ?? 0),
              ronda_numero: ronda.numero,
            })
          }
        }
      }
    }

    // Extraer items directos de detalle_pedido que no hayan estado en rondas
    if (pedidoActivo.detalle_pedido && pedidoActivo.detalle_pedido.length > 0) {
      for (const it of pedidoActivo.detalle_pedido) {
        if (!procesadosIds.has(it.id)) {
          items.push({
            id: it.id,
            producto_id: it.producto_id,
            cantidad: it.cantidad,
            nota: it.nota,
            nombre: it.productos?.nombre || `Producto #${it.producto_id}`,
            precio: Number(it.productos?.precio ?? 0),
            ronda_numero: 0,
          })
        }
      }
    }

    return items
  }, [pedidoActivo])

  // 4. Cálculos Matemáticos: Subtotal, Propina (10%), Total
  const subtotal = useMemo(() => {
    return itemsConsolidados.reduce((acc, it) => acc + it.cantidad * it.precio, 0)
  }, [itemsConsolidados])

  const propina = useMemo(() => {
    return incluirPropina ? Math.round(subtotal * 0.1) : 0
  }, [subtotal, incluirPropina])

  const total = useMemo(() => {
    return subtotal + propina
  }, [subtotal, propina])

  // Formato de moneda
  const formatCOP = (valor: number) => {
    return `$ ${valor.toLocaleString('es-CO')}`
  }

  // 5. Navegar a tomar pedidos para esta mesa usando la navegación de App.tsx
  const handleAgregarProductos = () => {
    if (onAgregarProductos) {
      onAgregarProductos(mesaId)
    } else if (onNavigate) {
      onNavigate('tomar-pedido', mesaId)
    }
  }

  // 6. Acción de Cobrar y Liberar Mesa (RPC cerrar_mesa_y_cobrar)
  // Operación directa de base de datos sin dependencias de red local ni impresión física
  const handleCobrarYLiberar = async () => {
    if (cobrando) return

    const confirmar = window.confirm(
      `¿Confirmas el cobro de ${formatCOP(total)} y la liberación de la Mesa ${
        pedidoActivo?.mesas?.numero ?? mesaId
      }?`
    )
    if (!confirmar) return

    setCobrando(true)
    setError(null)

    try {
      const { error: rpcErr } = await (supabase.rpc as unknown as (
        fn: string,
        params: Record<string, unknown>
      ) => Promise<{ error: { message: string; details?: string; hint?: string } | null }>)(
        'cerrar_mesa_y_cobrar',
        { p_mesa_id: Number(mesaId) }
      )

      if (rpcErr) {
        console.error('Error RPC:', rpcErr.message, rpcErr.details, rpcErr.hint)
        alert('Error SQL: ' + rpcErr.message)
        setError(`No se pudo cerrar la mesa: ${rpcErr.message}`)
        setCobrando(false)
        return
      }

      setExitoCobro(true)

      // Invocar inmediatamente onCobroExitoso o navegación de vuelta al mapa
      if (onCobroExitoso) {
        onCobroExitoso()
      } else if (onVolver) {
        onVolver()
      } else if (typeof window !== 'undefined') {
        window.location.href = '/mesas'
      }
    } catch (err: unknown) {
      const rpcError = err as { message?: string; details?: string; hint?: string }
      const msg = rpcError?.message || (err instanceof Error ? err.message : 'Error al liquidar mesa')
      console.error('Error RPC:', rpcError?.message, rpcError?.details, rpcError?.hint)
      alert('Error SQL: ' + msg)
      setError(`No se pudo cerrar la mesa: ${msg}`)
      setCobrando(false)
    }
  }

  const numeroMesa = pedidoActivo?.mesas?.numero ?? mesaId

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-6 text-left flex flex-col gap-6">
      {/* Botón de volver y encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <button
            type="button"
            onClick={onVolver || (() => window.history.back())}
            className="text-xs font-bold text-sky-400 hover:text-sky-300 flex items-center gap-1.5 mb-2 transition-all active:scale-95"
          >
            ← Volver al Mapa de Mesas
          </button>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
              Mesa {numeroMesa} — Resumen de Cuenta
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
              Ocupada
            </span>
          </div>
          {pedidoActivo && (
            <p className="text-slate-400 text-xs sm:text-sm mt-1">
              Pedido activo #{pedidoActivo.id} •{' '}
              {itemsConsolidados.length} ítem{itemsConsolidados.length !== 1 ? 's' : ''} ordenado
              {itemsConsolidados.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={() => void cargarResumen()}
          disabled={loading || cobrando}
          className="p-2.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 rounded-xl border border-slate-700 text-xs font-semibold self-start sm:self-center transition-all"
        >
          🔄 Recargar
        </button>
      </div>

      {/* Alerta de notificación de éxito */}
      {exitoCobro && (
        <div className="p-4 rounded-2xl bg-emerald-950/90 border-2 border-emerald-500 text-emerald-200 text-sm font-bold flex items-center gap-3 shadow-xl shadow-emerald-950/40 animate-in fade-in">
          <span className="text-2xl">✅</span>
          <div>
            <p className="text-base font-extrabold text-white">¡Mesa cobrada y liberada con éxito!</p>
            <p className="text-xs text-emerald-300">Regresando al mapa de mesas...</p>
          </div>
        </div>
      )}

      {/* Alerta de error */}
      {error && (
        <div className="p-4 rounded-2xl bg-rose-950/80 border border-rose-500 text-rose-200 text-sm font-semibold flex items-center justify-between shadow-lg">
          <span>❌ {error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-xs px-2 py-1 bg-black/30 rounded text-white"
          >
            ✕
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center min-h-[30vh] text-center text-slate-300">
          <div className="w-12 h-12 border-4 border-slate-700 border-t-blue-500 rounded-full animate-spin mb-4" />
          <p className="font-bold">Cargando consumos de la mesa...</p>
        </div>
      ) : !pedidoActivo || itemsConsolidados.length === 0 ? (
        <div className="text-center py-16 px-4 rounded-2xl bg-slate-800/40 border border-slate-800">
          <span className="text-4xl">🧾</span>
          <h2 className="text-slate-200 font-bold text-lg mt-3">No hay consumos activos</h2>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            Esta mesa no tiene un pedido abierto con productos registrados. Si la mesa está vacía, puedes
            marcarla como libre directamente.
          </p>
          <div className="mt-5 flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              type="button"
              onClick={handleAgregarProductos}
              className="w-full sm:w-auto min-h-[44px] px-6 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs transition-all shadow-md active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
            >
              ➕ Añadir más productos
            </button>
            <button
              type="button"
              onClick={handleCobrarYLiberar}
              disabled={cobrando}
              className="w-full sm:w-auto min-h-[44px] px-6 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-bold text-xs transition-all cursor-pointer"
            >
              Liberar Mesa Vacía
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Lista de productos consumidos detallados */}
          <div className="bg-slate-800/80 rounded-2xl border border-slate-700 overflow-hidden shadow-lg">
            <div className="px-5 py-3.5 bg-slate-800 border-b border-slate-700 flex justify-between items-center">
              <span className="text-xs font-extrabold uppercase tracking-wider text-slate-400">
                Detalle del Consumo
              </span>
              <span className="text-xs font-mono text-slate-400">
                {itemsConsolidados.length} producto{itemsConsolidados.length !== 1 ? 's' : ''}
              </span>
            </div>

            <div className="divide-y divide-slate-700/60 max-h-[380px] overflow-y-auto">
              {itemsConsolidados.map((item) => (
                <div
                  key={item.id}
                  className="px-5 py-3.5 flex items-center justify-between gap-4 hover:bg-slate-700/30 transition-all"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-black text-white text-base">{item.cantidad}x</span>
                      <span className="font-semibold text-slate-200 text-sm">{item.nombre}</span>
                      {item.ronda_numero !== undefined && item.ronda_numero > 0 && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-950 text-sky-300 border border-sky-800">
                          Ronda #{item.ronda_numero}
                        </span>
                      )}
                    </div>
                    {item.nota && (
                      <p className="text-xs text-amber-300 italic pl-6 mt-0.5">* {item.nota}</p>
                    )}
                  </div>

                  <div className="text-right">
                    <span className="font-bold font-mono text-white text-base">
                      {formatCOP(item.cantidad * item.precio)}
                    </span>
                    <p className="text-[11px] text-slate-400 font-mono">
                      ({formatCOP(item.precio)} c/u)
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Desglose Matemático Claro */}
          <div className="bg-slate-800/90 rounded-2xl border border-slate-700 p-5 sm:p-6 flex flex-col gap-3 shadow-xl">
            {/* Subtotal */}
            <div className="flex justify-between items-center text-slate-300 text-sm sm:text-base">
              <span>Subtotal de productos:</span>
              <strong className="font-mono text-white text-lg">{formatCOP(subtotal)}</strong>
            </div>

            {/* Propina voluntaria */}
            <div className="flex justify-between items-center py-2 border-y border-slate-700/80">
              <label className="flex items-center gap-2 cursor-pointer select-none text-slate-300 text-sm sm:text-base">
                <input
                  type="checkbox"
                  checked={incluirPropina}
                  onChange={(e) => setIncluirPropina(e.target.checked)}
                  className="w-4 h-4 rounded text-emerald-500 bg-slate-900 border-slate-600 focus:ring-emerald-500"
                />
                <span>Propina Voluntaria sugerida (10%):</span>
              </label>
              <strong
                className={`font-mono text-lg ${
                  incluirPropina ? 'text-emerald-400' : 'text-slate-500 line-through'
                }`}
              >
                {formatCOP(propina)}
              </strong>
            </div>

            {/* Total a Pagar en Tamaño Grande */}
            <div className="flex justify-between items-baseline pt-2">
              <div>
                <span className="text-xs sm:text-sm font-extrabold uppercase tracking-wider text-slate-400 block">
                  Total a Pagar
                </span>
                <span className="text-xs text-slate-500">
                  {incluirPropina ? 'Con propina voluntaria incluida' : 'Sin propina'}
                </span>
              </div>
              <span className="text-3xl sm:text-4xl font-black text-emerald-400 font-mono drop-shadow-md">
                {formatCOP(total)}
              </span>
            </div>
          </div>

          {/* Botón Secundario Grande: Añadir más productos */}
          <button
            type="button"
            onClick={handleAgregarProductos}
            disabled={cobrando || exitoCobro}
            className="w-full min-h-[56px] sm:min-h-[60px] px-6 py-3.5 rounded-2xl font-black text-lg sm:text-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-sky-400 hover:text-sky-300 transition-all border-2 border-sky-500/40 hover:border-sky-400 flex items-center justify-center gap-3 cursor-pointer shadow-xl shadow-slate-950/40 disabled:opacity-50"
          >
            <span>➕ Añadir más productos</span>
          </button>

          {/* Botón Gigante: Cobrar y Liberar Mesa */}
          <button
            type="button"
            onClick={handleCobrarYLiberar}
            disabled={cobrando || exitoCobro}
            className="w-full min-h-[58px] sm:min-h-[64px] px-6 py-4 rounded-2xl font-black text-lg sm:text-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:scale-95 text-white transition-all shadow-xl shadow-emerald-950/60 border-2 border-emerald-400/40 disabled:bg-slate-700 disabled:text-slate-500 flex items-center justify-center gap-3 cursor-pointer"
          >
            {cobrando ? (
              <>
                <div className="w-6 h-6 border-3 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Cobrando y liberando mesa...</span>
              </>
            ) : exitoCobro ? (
              <span>✅ ¡Cobro registrado con éxito!</span>
            ) : (
              <>
                <span>💳 Cobrar y Liberar Mesa ({formatCOP(total)})</span>
              </>
            )}
          </button>
        </>
      )}
    </div>
  )
}

export default ResumenMesa
