import React, { useState } from 'react'
import { useCajaRealtime } from '../hooks/useCajaRealtime'

export const Caja: React.FC = () => {
  const { pendientesImprimir, pedidosRecientes, reintentar, reimprimir, loading } =
    useCajaRealtime()

  const [processingId, setProcessingId] = useState<number | null>(null)
  const [notification, setNotification] = useState<{
    tipo: 'success' | 'error'
    texto: string
  } | null>(null)

  const printerIp = import.meta.env.VITE_PRINTER_IP || ''

  const formatNumeroPedido = (pedido: {
    id: number
    pedido_id?: number
    ronda_numero?: number
    numero_ronda?: number
  }) => {
    const pId = pedido.pedido_id ?? pedido.id
    const rNum = pedido.ronda_numero ?? pedido.numero_ronda
    if (rNum !== undefined && rNum !== null && Number(rNum) > 0) {
      return `${pId}.${rNum}`
    }
    return `${pId}`
  }

  const handleAction = async (
    pedido: { id: number; pedido_id?: number; ronda_id?: number; ronda_numero?: number; numero_ronda?: number },
    isReprint: boolean
  ) => {
    const targetId = pedido.ronda_id ?? pedido.id
    const labelPedido = formatNumeroPedido(pedido)
    setProcessingId(targetId)
    setNotification(null)

    try {
      const exito = isReprint ? await reimprimir(targetId) : await reintentar(targetId)
      if (exito) {
        setNotification({
          tipo: 'success',
          texto: `✅ Pedido #${labelPedido} enviado con éxito a la impresora.`,
        })
      } else {
        setNotification({
          tipo: 'error',
          texto: `❌ Falló el envío del Pedido #${labelPedido}. Verifica la conexión e IP de la impresora.`,
        })
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al comunicarse con la impresora'
      setNotification({
        tipo: 'error',
        texto: `❌ ${msg}`,
      })
    } finally {
      setProcessingId(null)
    }
  }

  const formatHora = (fechaStr?: string) => {
    if (!fechaStr) return ''
    try {
      const d = new Date(fechaStr)
      return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    } catch {
      return fechaStr
    }
  }

  return (
    <div className="w-full max-w-5xl mx-auto px-4 py-6 text-left">
      {/* Encabezado de la pantalla de caja */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
            Tablet de Caja — Impresión
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Escucha pedidos nuevos en tiempo real y gestiona la impresora térmica Epson
          </p>
        </div>

        {/* Indicador de configuración de impresora */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-800 border border-slate-700 text-xs text-slate-300 shrink-0">
          <span className={`w-2.5 h-2.5 rounded-full ${printerIp ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          <span>
            IP Impresora:{' '}
            <strong className="text-white font-mono">{printerIp || 'No configurada (.env)'}</strong>
          </span>
        </div>
      </div>

      {/* Alerta de notificación temporal */}
      {notification && (
        <div
          role="alert"
          className={`mt-4 p-4 rounded-xl text-sm font-semibold flex items-center justify-between shadow-lg transition-all animate-in fade-in duration-200 ${
            notification.tipo === 'success'
              ? 'bg-emerald-950/80 border border-emerald-500 text-emerald-200'
              : 'bg-red-950/80 border border-red-500 text-red-200'
          }`}
        >
          <span>{notification.texto}</span>
          <button
            type="button"
            onClick={() => setNotification(null)}
            className="text-xs px-2.5 py-1 rounded-lg bg-black/30 hover:bg-black/50 text-white"
          >
            ✕
          </button>
        </div>
      )}

      {/* SECCIÓN DESTACADA: Pendientes de Impresión */}
      {pendientesImprimir.length > 0 && (
        <div className="mt-6 p-4 sm:p-5 rounded-2xl bg-amber-950/40 border-2 border-amber-500/80 shadow-xl shadow-amber-950/30">
          <div className="flex items-center gap-3 mb-4">
            <span className="w-8 h-8 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold text-lg border border-amber-500/40">
              ⚠️
            </span>
            <div>
              <h2 className="text-lg font-bold text-amber-200">
                Pedidos Pendientes de Impresión ({pendientesImprimir.length})
              </h2>
              <p className="text-xs text-amber-400/80">
                No pudieron imprimirse automáticamente. Comprueba que la impresora tenga papel y esté encendida.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {pendientesImprimir.map((pedido) => (
              <div
                key={pedido.id}
                className="p-4 rounded-xl bg-slate-900/90 border border-amber-500/40 flex flex-col justify-between gap-3 shadow-md"
              >
                <div>
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2">
                    <span className="font-extrabold text-white text-base">
                      Mesa {pedido.mesa_numero ?? pedido.mesa_id}
                    </span>
                    <span className="text-xs font-mono text-amber-400 font-bold bg-amber-950/80 px-2 py-0.5 rounded border border-amber-800">
                      Pedido #{formatNumeroPedido(pedido)}
                    </span>
                  </div>

                  <ul className="text-xs text-slate-300 space-y-1 my-2">
                    {pedido.items.map((item, idx) => (
                      <li key={idx} className="flex flex-col">
                        <span className="font-semibold">
                          {item.cantidad}x {item.productos?.nombre || `Producto #${item.producto_id}`}
                        </span>
                        {item.nota && (
                          <span className="text-amber-300 italic pl-3">* {item.nota}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>

                <button
                  type="button"
                  onClick={() => handleAction(pedido, false)}
                  disabled={processingId === (pedido.ronda_id ?? pedido.id)}
                  className="w-full min-h-[44px] px-4 py-2.5 rounded-xl font-bold text-sm bg-amber-500 hover:bg-amber-400 active:scale-95 text-slate-950 disabled:bg-slate-700 disabled:text-slate-500 transition-all shadow-md shadow-amber-500/20 flex items-center justify-center gap-2"
                >
                  {processingId === (pedido.ronda_id ?? pedido.id) ? (
                    <span>Imprimiendo...</span>
                  ) : (
                    <span>🔄 Reintentar impresión</span>
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SECCIÓN PRINCIPAL: Últimos pedidos recibidos */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-white">Últimos Pedidos Recibidos</h2>
          <span className="text-xs text-slate-400">
            Escuchando en tiempo real vía Supabase Channel
          </span>
        </div>

        {loading ? (
          <div className="text-center py-12 text-slate-400">
            <div className="w-8 h-8 border-3 border-slate-700 border-t-blue-500 rounded-full animate-spin mx-auto mb-3" />
            <p>Cargando registro de pedidos...</p>
          </div>
        ) : pedidosRecientes.length === 0 ? (
          <div className="text-center py-16 px-4 rounded-2xl bg-slate-800/40 border border-slate-800">
            <span className="text-3xl">📭</span>
            <p className="text-slate-300 font-medium mt-2">No hay pedidos recibidos todavía</p>
            <p className="text-xs text-slate-500 mt-1">
              Los nuevos pedidos enviados por los meseros aparecerán e imprimirán automáticamente aquí.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {pedidosRecientes.map((pedido) => (
              <div
                key={pedido.id}
                className="p-4 rounded-2xl bg-slate-800/80 border border-slate-700/70 hover:border-slate-600 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                {/* Información del pedido */}
                <div className="flex-1">
                  <div className="flex items-center gap-3 flex-wrap mb-1.5">
                    <span className="font-extrabold text-white text-lg">
                      Mesa {pedido.mesa_numero ?? pedido.mesa_id}
                    </span>
                    <span className="font-mono text-xs text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-700">
                      Pedido #{formatNumeroPedido(pedido)}
                    </span>
                    {pedido.fecha_apertura && (
                      <span className="text-xs text-slate-400">
                        🕒 {formatHora(pedido.fecha_apertura)}
                      </span>
                    )}

                    {/* Estado del ticket */}
                    <span
                      className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${
                        pedido.impreso
                          ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800'
                          : 'bg-amber-950/80 text-amber-300 border-amber-800'
                      }`}
                    >
                      {pedido.impreso ? '✅ Impreso' : '⏳ Pendiente'}
                    </span>
                  </div>

                  {/* Resumen de items del pedido */}
                  <div className="text-sm text-slate-300 space-y-0.5 mt-2">
                    {pedido.items.map((it, idx) => (
                      <div key={idx} className="flex items-baseline gap-2">
                        <span className="font-bold text-slate-200">
                          {it.cantidad}x {it.productos?.nombre || `Item #${it.producto_id}`}
                        </span>
                        {it.nota && (
                          <span className="text-xs text-amber-300 italic">
                            ({it.nota})
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Acciones de impresión */}
                <div className="flex items-center gap-2 shrink-0">
                  {pedido.impreso ? (
                    <button
                      type="button"
                      onClick={() => handleAction(pedido, true)}
                      disabled={processingId === (pedido.ronda_id ?? pedido.id)}
                      className="min-h-[44px] px-4 py-2 rounded-xl font-bold text-xs sm:text-sm bg-slate-700 hover:bg-slate-600 active:scale-95 text-slate-100 disabled:bg-slate-800 disabled:text-slate-600 transition-all border border-slate-600 flex items-center justify-center gap-1.5"
                    >
                      {processingId === (pedido.ronda_id ?? pedido.id) ? 'Reimprimiendo...' : '🖨️ Reimprimir'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleAction(pedido, false)}
                      disabled={processingId === (pedido.ronda_id ?? pedido.id)}
                      className="min-h-[44px] px-4 py-2 rounded-xl font-bold text-xs sm:text-sm bg-amber-500 hover:bg-amber-400 active:scale-95 text-slate-950 disabled:bg-slate-800 disabled:text-slate-600 transition-all shadow-md shadow-amber-500/20 flex items-center justify-center gap-1.5"
                    >
                      {processingId === (pedido.ronda_id ?? pedido.id) ? 'Imprimiendo...' : '🔄 Reintentar impresión'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default Caja
