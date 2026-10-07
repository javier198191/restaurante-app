import React, { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export interface Mesa {
  id: number
  numero: string | number
  capacidad: number
  estado: 'libre' | 'ocupada' | string
}

export interface MapaMesasProps {
  onSelectMesa?: (mesaId: number, estado: string) => void
}

export const MapaMesas: React.FC<MapaMesasProps> = ({ onSelectMesa }) => {
  const [mesas, setMesas] = useState<Mesa[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())

  // 1. Carga de mesas y suscripción Realtime
  const cargarMesas = useCallback(async () => {
    try {
      setError(null)
      const { data, error: err } = await supabase
        .from('mesas')
        .select('id, numero, capacidad, estado')
        .order('numero')

      if (err) {
        throw err
      }

      setMesas((data as Mesa[]) || [])
      setLastUpdated(new Date())
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al cargar las mesas'
      console.error('Error al cargar mesas:', msg)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargarMesas()

    const channel = supabase
      .channel('mesas_realtime')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'mesas' },
        (payload) => {
          const mesaActualizada = payload.new as Mesa
          setMesas((prev) =>
            prev.map((m) => (m.id === mesaActualizada.id ? { ...m, ...mesaActualizada } : m))
          )
          setLastUpdated(new Date())
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [cargarMesas])

  // 3. Manejo de interacción táctil con cada mesa
  const handleMesaClick = (mesa: Mesa) => {
    if (mesa.estado === 'libre') {
      // Mesa libre: ir a tomar pedido con el ID de la mesa
      if (onSelectMesa) {
        onSelectMesa(mesa.id, 'libre')
      } else {
        console.log('Navegar a tomar pedido', mesa.id)
      }
    } else {
      // Mesa ocupada: ruta de resumen (temporalmente log como requiere la especificación)
      console.log('Navegar a resumen de mesa', mesa.id)
      if (onSelectMesa) {
        onSelectMesa(mesa.id, 'ocupada')
      }
    }
  }

  // Métricas rápidas para el encabezado
  const totalMesas = mesas.length
  const mesasLibres = mesas.filter((m) => m.estado === 'libre').length
  const mesasOcupadas = totalMesas - mesasLibres

  return (
    <div className="w-full max-w-6xl mx-auto px-4 py-6 text-left flex flex-col gap-6">
      {/* Encabezado con información en vivo y métricas */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
              Mapa de Mesas
            </h1>
            <span className="flex h-3 w-3 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
            </span>
          </div>
          <p className="text-slate-400 text-xs sm:text-sm mt-1">
            Vista en tiempo real del salón. Toca una mesa libre para tomar pedido o una ocupada para ver su resumen.
          </p>
        </div>

        {/* Resumen de ocupación y botón de recarga */}
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
          <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 px-3 py-1.5 rounded-xl text-xs">
            <span className="flex items-center gap-1.5 font-bold text-emerald-400">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              {mesasLibres} Libres
            </span>
            <span className="text-slate-600">|</span>
            <span className="flex items-center gap-1.5 font-bold text-rose-400">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
              {mesasOcupadas} Ocupadas
            </span>
          </div>

          <button
            type="button"
            onClick={() => void cargarMesas()}
            title={`Última actualización: ${lastUpdated.toLocaleTimeString()}`}
            className="p-2 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 hover:text-white rounded-xl border border-slate-700 transition-all text-xs font-semibold flex items-center gap-1"
          >
            🔄 Actualizar
          </button>
        </div>
      </div>

      {/* Manejo de estados de carga y error */}
      {loading && mesas.length === 0 ? (
        <div className="flex flex-col items-center justify-center min-h-[40vh] p-8 text-center text-slate-300">
          <div className="w-12 h-12 border-4 border-slate-700 border-t-emerald-500 rounded-full animate-spin mb-4" />
          <h2 className="text-lg font-bold text-white">Cargando estado de las mesas...</h2>
          <p className="text-xs text-slate-400 mt-1">Conectando con Supabase Realtime</p>
        </div>
      ) : error && mesas.length === 0 ? (
        <div className="flex flex-col items-center justify-center min-h-[40vh] p-8 text-center bg-rose-950/20 border border-rose-800/40 rounded-2xl">
          <span className="text-4xl mb-3">⚠️</span>
          <h2 className="text-lg font-bold text-rose-200">No se pudieron cargar las mesas</h2>
          <p className="text-xs text-rose-400 mt-1 max-w-md">{error}</p>
          <button
            type="button"
            onClick={() => void cargarMesas()}
            className="mt-4 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-xl transition-all shadow"
          >
            Reintentar
          </button>
        </div>
      ) : mesas.length === 0 ? (
        <div className="text-center py-16 px-4 rounded-2xl bg-slate-800/40 border border-slate-800">
          <span className="text-4xl">🍽️</span>
          <h2 className="text-slate-200 font-bold text-lg mt-3">No hay mesas registradas</h2>
          <p className="text-xs text-slate-400 mt-1">
            Agrega mesas en la base de datos para verlas en el mapa del restaurante.
          </p>
        </div>
      ) : (
        /* Cuadrícula responsiva de mesas (CSS Grid) */
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-5">
          {mesas.map((mesa) => {
            const esLibre = mesa.estado === 'libre'

            return (
              <button
                key={mesa.id}
                type="button"
                onClick={() => handleMesaClick(mesa)}
                className={`relative group flex flex-col justify-between min-h-[150px] sm:min-h-[175px] p-4 rounded-2xl cursor-pointer text-left transition-all duration-200 select-none transform hover:-translate-y-1 hover:shadow-2xl active:scale-95 focus:outline-none focus:ring-4 ${
                  esLibre
                    ? 'bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800 text-white border-2 border-emerald-400/50 shadow-lg shadow-emerald-950/40 hover:border-emerald-300 focus:ring-emerald-400/40'
                    : 'bg-gradient-to-br from-rose-700 via-rose-800 to-amber-900 text-white border-2 border-rose-400/50 shadow-lg shadow-rose-950/40 hover:border-rose-300 focus:ring-rose-400/40'
                }`}
              >
                {/* Fila superior: Badge de estado y capacidad pax */}
                <div className="flex items-center justify-between w-full gap-2">
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-black uppercase tracking-wider shadow-sm backdrop-blur-md ${
                      esLibre
                        ? 'bg-black/30 text-emerald-200 border border-emerald-300/40'
                        : 'bg-black/40 text-rose-200 border border-rose-300/40'
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${
                        esLibre ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'
                      }`}
                    />
                    {esLibre ? 'Libre' : 'Ocupada'}
                  </span>

                  <span className="text-[11px] font-extrabold text-white/90 bg-black/25 px-2 py-0.5 rounded-lg border border-white/10 flex items-center gap-1">
                    👥 {mesa.capacidad} pax
                  </span>
                </div>

                {/* Centro: Identificador de la mesa en tamaño grande */}
                <div className="my-auto py-2 text-center w-full">
                  <span className="text-3xl sm:text-4xl font-black text-white tracking-tight drop-shadow-md block">
                    {typeof mesa.numero === 'number'
                      ? `Mesa ${mesa.numero}`
                      : String(mesa.numero).toLowerCase().startsWith('mesa')
                        ? mesa.numero
                        : `Mesa ${mesa.numero}`}
                  </span>
                </div>

                {/* Fila inferior: Acción contextual clara para el mesero */}
                <div
                  className={`w-full py-1.5 px-2 rounded-xl text-center text-xs font-bold transition-all flex items-center justify-center gap-1 ${
                    esLibre
                      ? 'bg-white/15 group-hover:bg-white/25 text-white'
                      : 'bg-black/30 group-hover:bg-black/40 text-amber-200'
                  }`}
                >
                  {esLibre ? (
                    <span>Tomar Pedido ➜</span>
                  ) : (
                    <span>Ver Resumen ➜</span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default MapaMesas
