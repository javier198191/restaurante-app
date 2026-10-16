import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

// Cliente Supabase tipado flexible para acceder a tablas y RPCs de caja
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

export interface TurnoCaja {
  id: number
  estado: string
  fecha_apertura?: string
  created_at?: string
  fecha?: string
  base_inicial?: number
  base?: number
  cerrado_at?: string
  [key: string]: unknown
}

export interface MovimientoCaja {
  id: number
  turno_id: number
  tipo: 'ingreso' | 'egreso'
  categoria: string
  concepto: string
  monto: number
  metodo_pago: 'efectivo' | 'nequi' | 'datafono'
  created_at?: string
  fecha?: string
  [key: string]: unknown
}

export interface PropinaPorMesero {
  mesero_id?: string | number | null
  mesero: string
  total: number
  en_efectivo: number
  digital: number
}

export interface ResumenTurnoData {
  ingresos_total?: number
  ingresos_efectivo?: number
  ingresos_nequi?: number
  ingresos_datafono?: number
  cuentas_mixtas?: number
  monto_mixtas?: number
  mesas_cobradas?: number
  egresos_total?: number
  egresos_efectivo?: number
  base_inicial?: number
  total_propinas?: number
  propinas_por_mesero?: PropinaPorMesero[]
  [key: string]: unknown
}

export interface CierreResultado {
  esperado: number
  contado: number
  diferencia: number
  detalles?: unknown
}

export interface TurnoCajaCerrado {
  id: number
  estado: string
  fecha_apertura?: string
  fecha_cierre?: string
  cerrado_at?: string
  created_at?: string
  fecha?: string
  base_inicial?: number
  base?: number
  efectivo_esperado?: number
  esperado?: number
  efectivo_contado?: number
  contado?: number
  diferencia?: number
  total_vendido?: number
  ingresos_total?: number
  [key: string]: unknown
}

export interface LiberacionMesa {
  id?: number
  mesa_id: number
  motivo: string
  monto_no_cobrado: number
  liberada_por_nombre: string
  fecha: string
  mesas?: {
    numero: string | number
  } | null
}

// Formateador de moneda colombiana
const formatCOP = (valor: number | string | undefined | null): string => {
  const num = Number(valor) || 0
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(num)
}

// Formateador amigable de fecha y hora
const formatFecha = (fechaStr?: string): string => {
  if (!fechaStr) return '—'
  try {
    const d = new Date(fechaStr)
    return d.toLocaleString('es-CO', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    })
  } catch {
    return fechaStr
  }
}

// Categorías según requerimientos
const CATEGORIAS_INGRESO = [
  { value: 'venta_rapida', label: 'Venta rápida' },
  { value: 'otro_ingreso', label: 'Otro ingreso' },
]

const CATEGORIAS_EGRESO = [
  { value: 'insumos', label: 'Insumos' },
  { value: 'proveedor', label: 'Proveedor' },
  { value: 'nomina', label: 'Nómina' },
  { value: 'servicios', label: 'Servicios' },
  { value: 'pago_propinas', label: 'Pago de propinas' },
  { value: 'otro_egreso', label: 'Otro egreso' },
]

const METODOS_PAGO = [
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'nequi', label: 'Nequi' },
  { value: 'datafono', label: 'Datáfono' },
]

const ControlCaja: React.FC = () => {
  const { role } = useAuth()

  // Estado principal del turno
  const [turnoActivo, setTurnoActivo] = useState<TurnoCaja | null>(null)
  const [movimientos, setMovimientos] = useState<MovimientoCaja[]>([])
  const [resumenTurno, setResumenTurno] = useState<ResumenTurnoData | null>(null)
  const [liberaciones, setLiberaciones] = useState<LiberacionMesa[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine)

  // Mensajes de error y éxito
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Estado para apertura de turno
  const [baseInicialInput, setBaseInicialInput] = useState<string>('')
  const [abriendoTurno, setAbriendoTurno] = useState<boolean>(false)

  // Estado para modal de movimiento rápido
  const [modalMovimientoOpen, setModalMovimientoOpen] = useState<boolean>(false)
  const [movTipo, setMovTipo] = useState<'ingreso' | 'egreso'>('ingreso')
  const [movConcepto, setMovConcepto] = useState<string>('')
  const [movMonto, setMovMonto] = useState<string>('')
  const [movCategoria, setMovCategoria] = useState<string>('venta_rapida')
  const [movMetodoPago, setMovMetodoPago] = useState<'efectivo' | 'nequi' | 'datafono'>('efectivo')
  const [confirmandoMovimiento, setConfirmandoMovimiento] = useState<boolean>(false)
  const [guardandoMovimiento, setGuardandoMovimiento] = useState<boolean>(false)

  // Estado para modal de cierre de turno (conteo ciego)
  const [modalCerrarOpen, setModalCerrarOpen] = useState<boolean>(false)
  const [efectivoContadoInput, setEfectivoContadoInput] = useState<string>('')
  const [cerrandoTurno, setCerrandoTurno] = useState<boolean>(false)
  const [resultadoCierre, setResultadoCierre] = useState<CierreResultado | null>(null)

  // Estados para pestañas (Turno Activo / Histórico de Cajas)
  const [activeTab, setActiveTab] = useState<'activo' | 'historico'>('activo')
  const [historicoTurnos, setHistoricoTurnos] = useState<TurnoCajaCerrado[]>([])
  const [loadingHistorico, setLoadingHistorico] = useState<boolean>(false)
  const [errorHistorico, setErrorHistorico] = useState<string | null>(null)

  // Monitorear conectividad de red
  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  // Traductor y manejador de errores centralizado
  const procesarError = useCallback((err: unknown): string => {
    if (!navigator.onLine) {
      return 'Esta pantalla necesita internet para operar. Por favor verifica tu conexión a la red.'
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pgError = err as any
    if (pgError?.code === '42501') {
      return 'Tu usuario no tiene permiso para esta acción'
    }
    if (pgError?.code === '23505') {
      return 'Ya hay un turno abierto'
    }

    const mensaje = pgError?.message || (typeof err === 'string' ? err : 'Error desconocido al procesar la solicitud')
    if (
      mensaje.includes('Failed to fetch') ||
      mensaje.includes('NetworkError') ||
      mensaje.includes('Failed to send a request')
    ) {
      return 'Esta pantalla necesita internet para operar. Por favor verifica tu conexión a la red.'
    }

    return mensaje
  }, [])

  // Cargar contadores de resumen del turno (supabase.rpc('resumen_turno'))
  const cargarResumenTurno = useCallback(async () => {
    try {
      const { data, error } = await db.rpc('resumen_turno')
      if (error) {
        console.warn('Error al consultar resumen_turno:', error.message)
        return
      }
      if (data) {
        const res = Array.isArray(data) ? data[0] : data
        setResumenTurno(res as ResumenTurnoData)
      } else {
        setResumenTurno(null)
      }
    } catch (err: unknown) {
      console.warn('Fallo en llamada resumen_turno:', err)
    }
  }, [])

  // Cargar movimientos del turno (incluyendo cobros de mesa venta_mesa)
  const cargarMovimientos = useCallback(async (turnoId: number) => {
    try {
      const { data, error } = await db
        .from('movimientos_caja')
        .select('*')
        .eq('turno_id', turnoId)
        .order('id', { ascending: false })

      if (error) {
        throw error
      }
      setMovimientos((data as MovimientoCaja[]) || [])
    } catch (err: unknown) {
      setErrorMsg(procesarError(err))
    }
  }, [procesarError])

  // Cargar liberaciones de mesa sin cobro del turno activo (fecha >= fecha_apertura)
  const cargarLiberaciones = useCallback(async (fechaApertura?: string) => {
    if (!fechaApertura) return
    try {
      const { data, error } = await db
        .from('liberaciones_mesa')
        .select('mesa_id, motivo, monto_no_cobrado, liberada_por_nombre, fecha, mesas(numero)')
        .gte('fecha', fechaApertura)
        .order('fecha', { ascending: false })

      if (error) {
        console.warn('Error al consultar liberaciones_mesa:', error.message)
        return
      }
      setLiberaciones((data as LiberacionMesa[]) || [])
    } catch (err: unknown) {
      console.warn('Fallo al cargar liberaciones_mesa:', err)
    }
  }, [])

  // 1. Al montar, consulta el turno abierto con maybeSingle()
  const consultarTurnoActivo = useCallback(async () => {
    setLoading(true)
    setErrorMsg(null)

    if (!navigator.onLine) {
      setErrorMsg('Esta pantalla necesita internet para operar. Conéctate a internet para continuar.')
      setLoading(false)
      return
    }

    try {
      const { data, error } = await db
        .from('turnos_caja')
        .select('*')
        .eq('estado', 'abierto')
        .maybeSingle()

      if (error) {
        throw error
      }

      if (data) {
        setTurnoActivo(data as TurnoCaja)
        const fApertura = data.fecha_apertura || data.created_at || data.fecha
        await Promise.all([
          cargarMovimientos(data.id),
          cargarResumenTurno(),
          cargarLiberaciones(fApertura),
        ])
      } else {
        setTurnoActivo(null)
        setMovimientos([])
        setResumenTurno(null)
        setLiberaciones([])
      }
    } catch (err: unknown) {
      setErrorMsg(procesarError(err))
    } finally {
      setLoading(false)
    }
  }, [cargarMovimientos, cargarResumenTurno, cargarLiberaciones, procesarError])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void consultarTurnoActivo()
  }, [consultarTurnoActivo])

  // Cargar histórico de turnos cerrados
  const cargarHistorico = useCallback(async () => {
    setLoadingHistorico(true)
    setErrorHistorico(null)
    try {
      const { data, error } = await supabase
        .from('turnos_caja')
        .select('*')
        .eq('estado', 'cerrado')
        .order('fecha_cierre', { ascending: false })

      if (error) {
        console.warn('Aviso al ordenar turnos cerrados por fecha_cierre, reintentando por id:', error.message)
        const { data: fallbackData, error: fallbackError } = await supabase
          .from('turnos_caja')
          .select('*')
          .eq('estado', 'cerrado')
          .order('id', { ascending: false })

        if (fallbackError) {
          throw fallbackError
        }
        setHistoricoTurnos((fallbackData as TurnoCajaCerrado[]) || [])
      } else {
        setHistoricoTurnos((data as TurnoCajaCerrado[]) || [])
      }
    } catch (err: unknown) {
      console.error('Error al cargar histórico de cajas:', err)
      setErrorHistorico('No se pudo cargar el histórico de turnos cerrados.')
    } finally {
      setLoadingHistorico(false)
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'historico') {
      void cargarHistorico()
    }
  }, [activeTab, cargarHistorico])

  // 2. Actualizar contadores, liberaciones y movimientos con Realtime y respaldo cada 15 segundos
  useEffect(() => {
    if (!turnoActivo) return

    const fApertura = turnoActivo.fecha_apertura || turnoActivo.created_at || turnoActivo.fecha

    // Cargar contadores y liberaciones inicialmente
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargarResumenTurno()
    void cargarLiberaciones(fApertura)

    // Suscripción Realtime ante INSERT en movimientos_caja y liberaciones_mesa
    const channel = supabase
      .channel('control_caja_movimientos_rt')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'movimientos_caja' },
        () => {
          void cargarResumenTurno()
          if (turnoActivo.id) {
            void cargarMovimientos(turnoActivo.id)
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'liberaciones_mesa' },
        () => {
          void cargarLiberaciones(fApertura)
        }
      )
      .subscribe()

    // Intervalo de respaldo cada 15 segundos
    const intervalId = setInterval(() => {
      void cargarResumenTurno()
      if (turnoActivo.id) {
        void cargarMovimientos(turnoActivo.id)
      }
      void cargarLiberaciones(fApertura)
    }, 15000)

    // Limpieza con clearInterval y supabase.removeChannel
    return () => {
      clearInterval(intervalId)
      void supabase.removeChannel(channel)
    }
  }, [turnoActivo, cargarResumenTurno, cargarMovimientos, cargarLiberaciones])

  // Abrir turno con supabase.rpc('abrir_turno', { p_base })
  const handleAbrirTurno = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    setSuccessMsg(null)

    if (!navigator.onLine) {
      setErrorMsg('Esta pantalla necesita internet para operar.')
      return
    }

    const baseNum = Number(baseInicialInput)
    if (isNaN(baseNum) || baseNum < 0) {
      setErrorMsg('Por favor ingresa una base inicial válida (número mayor o igual a 0).')
      return
    }

    setAbriendoTurno(true)
    try {
      const { error } = await db.rpc('abrir_turno', { p_base: Math.round(baseNum) })

      if (error) {
        if (error.code === '23505') {
          setErrorMsg('Ya hay un turno abierto')
        } else if (error.code === '42501') {
          setErrorMsg('Tu usuario no tiene permiso para esta acción')
        } else {
          setErrorMsg(procesarError(error))
        }
        return
      }

      setSuccessMsg('Turno de caja abierto correctamente.')
      setBaseInicialInput('')
      await consultarTurnoActivo()
    } catch (err: unknown) {
      setErrorMsg(procesarError(err))
    } finally {
      setAbriendoTurno(false)
    }
  }

  // Abrir modal de movimiento rápido
  const handleOpenModalMovimiento = (tipo: 'ingreso' | 'egreso') => {
    setMovTipo(tipo)
    setMovConcepto('')
    setMovMonto('')
    setMovCategoria(tipo === 'ingreso' ? 'venta_rapida' : 'insumos')
    setMovMetodoPago('efectivo')
    setConfirmandoMovimiento(false)
    setErrorMsg(null)
    setModalMovimientoOpen(true)
  }

  // Validar y pasar a confirmación del movimiento
  const handlePrepararConfirmacion = (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)

    if (!movConcepto.trim()) {
      setErrorMsg('El concepto es obligatorio.')
      return
    }

    const montoNum = Number(movMonto)
    if (!montoNum || isNaN(montoNum) || montoNum <= 0 || !Number.isInteger(montoNum)) {
      setErrorMsg('El monto debe ser un número entero mayor a 0 en pesos colombianos.')
      return
    }

    setConfirmandoMovimiento(true)
  }

  // Guardar movimiento con ANTI-DUPLICADOS
  const handleGuardarMovimiento = async () => {
    if (!turnoActivo) return
    setErrorMsg(null)
    setSuccessMsg(null)

    if (!navigator.onLine) {
      setErrorMsg('Esta pantalla necesita internet para operar.')
      return
    }

    setGuardandoMovimiento(true)
    try {
      const { error } = await db.from('movimientos_caja').insert({
        turno_id: turnoActivo.id,
        tipo: movTipo,
        categoria: movCategoria,
        concepto: movConcepto.trim(),
        monto: Math.round(Number(movMonto)),
        metodo_pago: movMetodoPago,
      })

      if (error) {
        throw error
      }

      const tipoEtiqueta = movTipo === 'ingreso' ? 'Ingreso' : 'Egreso'
      setSuccessMsg(`✅ ${tipoEtiqueta} de ${formatCOP(movMonto)} registrado con éxito.`)
      setModalMovimientoOpen(false)
      setConfirmandoMovimiento(false)

      // Actualizar movimientos y contadores tras inserción
      await Promise.all([cargarMovimientos(turnoActivo.id), cargarResumenTurno()])
    } catch (err: unknown) {
      setErrorMsg(procesarError(err))
    } finally {
      setGuardandoMovimiento(false)
    }
  }

  // Cerrar turno con supabase.rpc('cerrar_turno', { p_efectivo_contado })
  const handleConfirmarCierreTurno = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    setSuccessMsg(null)

    if (!navigator.onLine) {
      setErrorMsg('Esta pantalla necesita internet para operar.')
      return
    }

    const contadoNum = Number(efectivoContadoInput)
    if (isNaN(contadoNum) || contadoNum < 0) {
      setErrorMsg('Ingresa un valor válido para el efectivo contado (número mayor o igual a 0).')
      return
    }

    setCerrandoTurno(true)
    try {
      const { data, error } = await db.rpc('cerrar_turno', {
        p_efectivo_contado: Math.round(contadoNum),
      })

      if (error) {
        throw error
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = data as any
      const esperado = Number(res?.esperado ?? res?.efectivo_esperado ?? res?.[0]?.esperado ?? 0)
      const contado = Number(
        res?.contado ?? res?.efectivo_contado ?? res?.[0]?.contado ?? contadoNum
      )
      const diferencia = Number(
        res?.diferencia ?? res?.[0]?.diferencia ?? (contado - esperado)
      )

      setResultadoCierre({
        esperado,
        contado,
        diferencia,
        detalles: res,
      })
      setModalCerrarOpen(false)
    } catch (err: unknown) {
      setErrorMsg(procesarError(err))
    } finally {
      setCerrandoTurno(false)
    }
  }

  // Finalizar el cierre y volver a la vista de abrir turno
  const handleFinalizarCierre = () => {
    setResultadoCierre(null)
    setTurnoActivo(null)
    setMovimientos([])
    setResumenTurno(null)
    setLiberaciones([])
    setEfectivoContadoInput('')
    void consultarTurnoActivo()
  }

  // Cálculos de efectivo esperado en caja para administradores
  const baseInicial = Number(
    turnoActivo?.base_inicial ?? turnoActivo?.base ?? resumenTurno?.base_inicial ?? 0
  )
  const ingresosEfectivo = Number(resumenTurno?.ingresos_efectivo ?? 0)
  const egresosEfectivo =
    resumenTurno?.egresos_efectivo !== undefined
      ? Number(resumenTurno.egresos_efectivo)
      : movimientos
          .filter((m) => m.tipo === 'egreso' && m.metodo_pago === 'efectivo')
          .reduce((acc, m) => acc + Number(m.monto || 0), 0)

  const efectivoEsperadoEnCaja = baseInicial + ingresosEfectivo - egresosEfectivo

  // Propinas del turno (recibidas de supabase.rpc('resumen_turno'))
  const totalPropinas = Number(resumenTurno?.total_propinas ?? 0)
  const propinasPorMesero = useMemo<PropinaPorMesero[]>(() => {
    const raw = resumenTurno?.propinas_por_mesero
    if (!raw) return []
    if (Array.isArray(raw)) return raw
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed : []
      } catch {
        return []
      }
    }
    return []
  }, [resumenTurno?.propinas_por_mesero])

  // Total vendido: ingresos_total - total_propinas (directo de resumen_turno)
  const ingresosTotal = Number(resumenTurno?.ingresos_total ?? 0)
  const totalVendido = Math.max(0, ingresosTotal - totalPropinas)

  // Métricas de mesas liberadas sin cobro (Tarea 4)
  const totalMesasLiberadas = liberaciones.length
  const totalMontoNoCobrado = liberaciones.reduce(
    (acc, l) => acc + Number(l.monto_no_cobrado || 0),
    0
  )

  // Control de acceso: solo visible para cajero y admin (Tarea 4)
  if (role && role !== 'cajero' && role !== 'admin') {
    return (
      <div className="w-full max-w-xl mx-auto px-4 py-16 text-center">
        <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-6 sm:p-8 shadow-xl">
          <span className="text-4xl block mb-3">🚫</span>
          <h2 className="text-xl font-black text-white">Acceso Restringido</h2>
          <p className="text-sm text-slate-400 mt-2">
            El módulo de Control de Caja solo está disponible para usuarios con rol de cajero o administrador.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-5xl mx-auto px-4 py-6 text-left">
      {/* Alerta de conexión a internet obligatoria */}
      {!isOnline && (
        <div
          role="alert"
          className="mb-6 p-4 rounded-xl bg-amber-950/80 border border-amber-600/50 text-amber-200 text-sm font-semibold flex items-center justify-between shadow-lg"
        >
          <div className="flex items-center gap-3">
            <span className="text-xl">⚠️</span>
            <span>
              <strong>Sin conexión a internet:</strong> Esta pantalla necesita internet para operar.
              Las operaciones de caja no se encolan offline.
            </span>
          </div>
        </div>
      )}

      {/* Alerta de error general */}
      {errorMsg && (
        <div
          role="alert"
          className="mb-6 p-4 rounded-xl bg-red-950/90 border border-red-600/60 text-red-100 text-sm font-semibold flex items-start justify-between shadow-lg animate-in fade-in"
        >
          <div className="flex items-start gap-3">
            <span className="text-xl">🚨</span>
            <div>
              <p className="font-bold text-red-200">Error en Control de Caja</p>
              <p className="mt-0.5 text-red-300 font-normal">{errorMsg}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="text-red-300 hover:text-white text-lg font-bold ml-4 leading-none"
            aria-label="Cerrar error"
          >
            ✕
          </button>
        </div>
      )}

      {/* Alerta de éxito */}
      {successMsg && (
        <div
          role="status"
          className="mb-6 p-4 rounded-xl bg-emerald-950/90 border border-emerald-600/60 text-emerald-100 text-sm font-semibold flex items-center justify-between shadow-lg animate-in fade-in"
        >
          <div className="flex items-center gap-3">
            <span className="text-xl">✅</span>
            <p>{successMsg}</p>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMsg(null)}
            className="text-emerald-300 hover:text-white text-lg font-bold ml-4 leading-none"
            aria-label="Cerrar mensaje"
          >
            ✕
          </button>
        </div>
      )}

      {/* Encabezado Principal */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight flex items-center gap-2">
            <span>💰</span> Control de Caja
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Apertura y cierre de turno, contadores en tiempo real y registro rápido
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              if (activeTab === 'activo') {
                void consultarTurnoActivo()
              } else {
                void cargarHistorico()
              }
            }}
            disabled={activeTab === 'activo' ? loading : loadingHistorico}
            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 text-xs font-bold border border-slate-700 transition-all flex items-center gap-2 disabled:opacity-50"
          >
            <span className={activeTab === 'activo' ? (loading ? 'animate-spin' : '') : (loadingHistorico ? 'animate-spin' : '')}>
              🔄
            </span>
            <span>Actualizar</span>
          </button>
        </div>
      </div>

      {/* Selector de pestañas: Turno Activo vs Histórico de Cajas */}
      <div className="flex items-center gap-2 mt-6 mb-6 bg-slate-900/90 p-1.5 rounded-2xl border border-slate-700/80 w-full sm:w-fit shadow-md">
        <button
          type="button"
          onClick={() => setActiveTab('activo')}
          className={`flex-1 sm:flex-initial px-5 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
            activeTab === 'activo'
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
          }`}
        >
          <span>▶</span>
          <span>Turno Activo</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('historico')}
          className={`flex-1 sm:flex-initial px-5 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
            activeTab === 'historico'
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
          }`}
        >
          <span>📅</span>
          <span>Histórico de Cajas</span>
        </button>
      </div>

      {activeTab === 'activo' ? (
        <>
          {/* Indicador de carga inicial */}
          {loading ? (
            <div className="py-20 text-center">
          <div className="w-10 h-10 border-4 border-slate-700 border-t-blue-500 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-400 text-sm">Consultando estado del turno de caja...</p>
        </div>
      ) : !turnoActivo ? (
        /* VISTA SIN TURNO ABIERTO */
        <div className="mt-8 max-w-xl mx-auto">
          <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-6 sm:p-8 shadow-xl">
            <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center text-3xl mx-auto mb-4">
              🔓
            </div>
            <h2 className="text-xl font-black text-white text-center">
              No hay turno abierto
            </h2>
            <p className="text-slate-400 text-sm text-center mt-1">
              Para iniciar las operaciones del día o jornada, define la base inicial de efectivo en caja.
            </p>

            <form onSubmit={handleAbrirTurno} className="mt-6 space-y-5">
              <div>
                <label
                  htmlFor="base-inicial-input"
                  className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-2"
                >
                  Base inicial (efectivo)
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-lg">
                    $
                  </span>
                  <input
                    id="base-inicial-input"
                    type="number"
                    step="1"
                    min="0"
                    placeholder="Ej. 100000"
                    value={baseInicialInput}
                    onChange={(e) => setBaseInicialInput(e.target.value)}
                    required
                    className="w-full pl-9 pr-4 py-3.5 bg-slate-900 border border-slate-700 rounded-xl text-white placeholder-slate-500 font-semibold text-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  />
                </div>
                {baseInicialInput && !isNaN(Number(baseInicialInput)) && (
                  <p className="text-xs text-sky-400 font-bold mt-2">
                    Valor formateado: {formatCOP(baseInicialInput)}
                  </p>
                )}
              </div>

              {/* Botones de sugerencias rápidas */}
              <div className="flex flex-wrap gap-2">
                {[50000, 100000, 150000, 200000, 300000].map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setBaseInicialInput(String(val))}
                    className="px-3 py-1.5 rounded-lg bg-slate-900/90 border border-slate-700 hover:border-slate-500 text-xs font-semibold text-slate-300 hover:text-white transition-all"
                  >
                    {formatCOP(val)}
                  </button>
                ))}
              </div>

              <button
                type="submit"
                disabled={abriendoTurno || !isOnline}
                className="w-full min-h-[50px] py-3.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-[0.99] text-white font-bold text-base shadow-lg shadow-blue-600/30 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {abriendoTurno ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Abriendo turno...</span>
                  </>
                ) : (
                  <>
                    <span>🚀</span>
                    <span>Abrir turno</span>
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      ) : (
        /* VISTA CON TURNO ABIERTO */
        <div className="mt-6 space-y-6">
          {/* Tarjeta Informativa del Turno Activo */}
          <div className="bg-slate-800/90 border border-slate-700 rounded-2xl p-5 sm:p-6 shadow-xl">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="px-3 py-1 rounded-lg bg-emerald-950 border border-emerald-600/50 text-emerald-400 text-xs font-black uppercase tracking-wider flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    Turno Abierto
                  </span>
                  <span className="text-lg font-black text-white">
                    Turno #{turnoActivo.id}
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-slate-400">
                  <span className="font-semibold text-slate-300">Apertura: </span>
                  {formatFecha(turnoActivo.fecha_apertura || turnoActivo.created_at || turnoActivo.fecha)}
                </p>
                {turnoActivo.base_inicial !== undefined && (
                  <p className="text-xs text-slate-400">
                    <span className="font-semibold text-slate-300">Base inicial: </span>
                    {formatCOP(turnoActivo.base_inicial || turnoActivo.base)}
                  </p>
                )}
              </div>

              {/* Botones de Acción Rápida */}
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => handleOpenModalMovimiento('ingreso')}
                  className="min-h-[44px] px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-bold text-sm shadow-lg shadow-emerald-600/20 transition-all flex items-center gap-2"
                >
                  <span>➕</span>
                  <span>Ingreso rápido</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleOpenModalMovimiento('egreso')}
                  className="min-h-[44px] px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 active:scale-95 text-white font-bold text-sm shadow-lg shadow-rose-600/20 transition-all flex items-center gap-2"
                >
                  <span>➖</span>
                  <span>Egreso rápido</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg(null)
                    setEfectivoContadoInput('')
                    setModalCerrarOpen(true)
                  }}
                  className="min-h-[44px] px-4 py-2.5 rounded-xl bg-slate-700 hover:bg-amber-600 active:scale-95 text-white font-bold text-sm border border-slate-600 hover:border-amber-500 transition-all flex items-center gap-2"
                >
                  <span>🔒</span>
                  <span>Cerrar turno</span>
                </button>
              </div>
            </div>
          </div>

          {/* PANEL DE CONTADORES EN TARJETAS (supabase.rpc('resumen_turno')) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Flujo y Métricas del Turno
              </h2>
              <span className="text-[11px] text-slate-500 font-mono">
                Actualizado en tiempo real (15s)
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {/* Total vendido (ingresos_total - total_propinas) */}
              <div className="p-4 rounded-2xl bg-slate-800/90 border border-slate-700/80 shadow-md">
                <span className="text-xs font-bold text-slate-400 block">Total Vendido</span>
                <span className="text-lg sm:text-xl font-black text-emerald-400 font-mono mt-1 block">
                  {formatCOP(totalVendido)}
                </span>
                <span className="text-[10px] text-slate-500">No incluye propinas</span>
              </div>

              {/* Propinas del personal */}
              <div className="p-4 rounded-2xl bg-slate-800/90 border border-amber-600/40 shadow-md">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-amber-300">Propinas</span>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                    Personal
                  </span>
                </div>
                <span className="text-lg sm:text-xl font-black text-amber-400 font-mono mt-1 block">
                  {formatCOP(totalPropinas)}
                </span>
                <span className="text-[10px] text-amber-200/80 block mt-0.5">
                  Del personal (no es venta)
                </span>
              </div>

              {/* Efectivo */}
              <div className="p-4 rounded-2xl bg-slate-800/90 border border-slate-700/80 shadow-md">
                <span className="text-xs font-bold text-slate-400 block">Efectivo</span>
                <span className="text-lg sm:text-xl font-black text-white font-mono mt-1 block">
                  {formatCOP(resumenTurno?.ingresos_efectivo)}
                </span>
                <span className="text-[10px] text-slate-500">Cobrado en caja</span>
              </div>

              {/* Nequi */}
              <div className="p-4 rounded-2xl bg-slate-800/90 border border-slate-700/80 shadow-md">
                <span className="text-xs font-bold text-slate-400 block">Nequi</span>
                <span className="text-lg sm:text-xl font-black text-purple-400 font-mono mt-1 block">
                  {formatCOP(resumenTurno?.ingresos_nequi)}
                </span>
                <span className="text-[10px] text-slate-500">Transferencias</span>
              </div>

              {/* Datáfono */}
              <div className="p-4 rounded-2xl bg-slate-800/90 border border-slate-700/80 shadow-md">
                <span className="text-xs font-bold text-slate-400 block">Datáfono</span>
                <span className="text-lg sm:text-xl font-black text-blue-400 font-mono mt-1 block">
                  {formatCOP(resumenTurno?.ingresos_datafono)}
                </span>
                <span className="text-[10px] text-slate-500">Tarjetas</span>
              </div>

              {/* Cuentas Mixtas */}
              <div className="p-4 rounded-2xl bg-slate-800/90 border border-slate-700/80 shadow-md col-span-2 sm:col-span-1 lg:col-span-2">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs font-bold text-slate-400">Cuentas Mixtas</span>
                  <span className="text-xs font-bold text-amber-400 font-mono">
                    {resumenTurno?.cuentas_mixtas ?? 0} cuenta{(resumenTurno?.cuentas_mixtas ?? 0) !== 1 ? 's' : ''}
                  </span>
                </div>
                <span className="text-lg sm:text-xl font-black text-white font-mono mt-1 block">
                  {formatCOP(resumenTurno?.monto_mixtas)}
                </span>
                <span className="text-[10px] text-amber-300/80 italic block mt-0.5">
                  * Ya incluidas en los métodos de arriba, no se suman
                </span>
              </div>

              {/* Mesas Cobradas */}
              <div className="p-4 rounded-2xl bg-slate-800/90 border border-slate-700/80 shadow-md">
                <span className="text-xs font-bold text-slate-400 block">Mesas Cobradas</span>
                <span className="text-lg sm:text-xl font-black text-sky-400 font-mono mt-1 block">
                  {resumenTurno?.mesas_cobradas ?? 0}
                </span>
                <span className="text-[10px] text-slate-500">Cierres de mesa</span>
              </div>

              {/* Egresos */}
              <div className="p-4 rounded-2xl bg-slate-800/90 border border-slate-700/80 shadow-md">
                <span className="text-xs font-bold text-slate-400 block">Egresos</span>
                <span className="text-lg sm:text-xl font-black text-rose-400 font-mono mt-1 block">
                  {formatCOP(resumenTurno?.egresos_total)}
                </span>
                <span className="text-[10px] text-slate-500">Gastos / Compras</span>
              </div>

              {/* Tarjeta resumen Liberadas sin cobro (Tarea 4) */}
              <div className="p-4 rounded-2xl bg-slate-800/90 border border-rose-600/40 shadow-md">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-rose-300">Liberadas sin cobro</span>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40">
                    {totalMesasLiberadas} mesa{totalMesasLiberadas !== 1 ? 's' : ''}
                  </span>
                </div>
                <span className="text-lg sm:text-xl font-black text-rose-400 font-mono mt-1 block">
                  {formatCOP(totalMontoNoCobrado)}
                </span>
                <span className="text-[10px] text-rose-200/80 block mt-0.5">
                  Liberadas sin cobro: {totalMesasLiberadas} por {formatCOP(totalMontoNoCobrado)}
                </span>
              </div>

              {/* Efectivo Esperado en Caja (SOLO ADMIN) */}
              {role === 'admin' && (
                <div className="p-4 rounded-2xl bg-gradient-to-br from-indigo-950/80 to-slate-900 border-2 border-indigo-500/50 shadow-lg col-span-2 sm:col-span-3 lg:col-span-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-extrabold uppercase tracking-wider text-indigo-300">
                          Efectivo Esperado en Caja
                        </span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
                          Solo Admin
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Base inicial ({formatCOP(baseInicial)}) + Ventas en efectivo ({formatCOP(ingresosEfectivo)}) - Egresos en efectivo ({formatCOP(egresosEfectivo)})
                      </p>
                    </div>
                    <span className="text-2xl sm:text-3xl font-black text-emerald-400 font-mono drop-shadow-md">
                      {formatCOP(efectivoEsperadoEnCaja)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Tabla de Movimientos de Solo Lectura (incluye venta_mesa) */}
          <div className="bg-slate-800/60 border border-slate-700/80 rounded-2xl overflow-hidden shadow-xl">
            <div className="p-4 sm:p-5 border-b border-slate-700/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <h3 className="text-lg font-black text-white">
                  Movimientos del turno
                </h3>
                <span className="px-2.5 py-0.5 rounded-full bg-slate-700 text-slate-300 text-xs font-bold">
                  {movimientos.length}
                </span>
              </div>
              <p className="text-xs text-slate-400 italic">
                * Conteo a ciegas: el total físico se valida al cerrar el turno
              </p>
            </div>

            {movimientos.length === 0 ? (
              <div className="py-16 text-center text-slate-400">
                <span className="text-4xl block mb-2">📋</span>
                <p className="font-semibold text-slate-300">No hay movimientos registrados</p>
                <p className="text-xs text-slate-500 mt-1">
                  Los cobros de mesas y movimientos rápidos aparecerán aquí automáticamente.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-200">
                  <thead className="bg-slate-900/60 text-xs uppercase tracking-wider text-slate-400 font-bold border-b border-slate-700">
                    <tr>
                      <th scope="col" className="px-4 py-3">Fecha / Hora</th>
                      <th scope="col" className="px-4 py-3">Tipo</th>
                      <th scope="col" className="px-4 py-3">Categoría</th>
                      <th scope="col" className="px-4 py-3">Concepto</th>
                      <th scope="col" className="px-4 py-3">Método</th>
                      <th scope="col" className="px-4 py-3 text-right">Monto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/50">
                    {movimientos.map((m) => {
                      const esIngreso = m.tipo === 'ingreso'
                      return (
                        <tr key={m.id} className="hover:bg-slate-700/30 transition-colors">
                          <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                            {formatFecha(m.created_at || m.fecha)}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-bold ${
                                esIngreso
                                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-700/40'
                                  : 'bg-rose-950 text-rose-400 border border-rose-700/40'
                              }`}
                            >
                              {esIngreso ? '+ Ingreso' : '- Egreso'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-300 font-medium whitespace-nowrap capitalize">
                            {m.categoria === 'venta_mesa'
                              ? 'Venta mesa'
                              : m.categoria === 'pago_propinas'
                              ? 'Pago propinas'
                              : m.categoria === 'propina'
                              ? 'Propina'
                              : m.categoria.replace('_', ' ')}
                          </td>
                          <td className="px-4 py-3 font-semibold text-slate-100 max-w-xs break-words">
                            {m.concepto}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="text-xs px-2 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-700 capitalize font-medium">
                              {m.metodo_pago}
                            </span>
                          </td>
                          <td
                            className={`px-4 py-3 text-right font-black whitespace-nowrap ${
                              esIngreso ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {esIngreso ? '+' : '-'} {formatCOP(m.monto)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* SECCIÓN: PROPINAS POR MESERO (TAREAS 3, 4, 5) */}
          {(role === 'cajero' || role === 'admin' || !role) && (
            <div className="bg-slate-800/60 border border-slate-700/80 rounded-2xl overflow-hidden shadow-xl">
              <div className="p-4 sm:p-5 border-b border-slate-700/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <h3 className="text-lg font-black text-white flex items-center gap-2">
                    <span>💵</span>
                    <span>Propinas por mesero</span>
                  </h3>
                  <span className="px-2.5 py-0.5 rounded-full bg-amber-950 border border-amber-700/50 text-amber-300 text-xs font-bold">
                    {propinasPorMesero.length}
                  </span>
                </div>
                <p className="text-xs text-slate-400 italic">
                  * Discriminación de propinas en efectivo y digitales
                </p>
              </div>

              <div className="p-4 sm:p-5 space-y-4">
                {propinasPorMesero.length === 0 ? (
                  <div className="py-8 text-center text-slate-400">
                    <span className="text-3xl block mb-2">🪙</span>
                    <p className="font-semibold text-slate-300">
                      No hay propinas registradas en este turno
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {propinasPorMesero.map((p, idx) => {
                      const esSinAsignar =
                        p.mesero?.trim().toLowerCase() === 'sin asignar' ||
                        !p.mesero

                      return (
                        <div
                          key={p.mesero_id ?? idx}
                          className={`p-4 rounded-xl border transition-all flex flex-col justify-between ${
                            esSinAsignar
                              ? 'bg-amber-950/40 border-amber-500/70 shadow-amber-900/20 ring-1 ring-amber-500/40'
                              : 'bg-slate-900/80 border-slate-700/80'
                          }`}
                        >
                          {/* Encabezado con nombre del mesero (ancho completo, sin empujar el total) */}
                          <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-700/60 min-w-0">
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <span className="text-base shrink-0">👤</span>
                              <h4
                                className="font-black text-white text-sm sm:text-base truncate"
                                title={p.mesero || 'Sin asignar'}
                              >
                                {p.mesero || 'Sin asignar'}
                              </h4>
                            </div>
                            {esSinAsignar && (
                              <span className="shrink-0 px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[11px] font-bold">
                                ⚠️ Sin asignar
                              </span>
                            )}
                          </div>

                          {/* Cuerpo: Total dentro del cuadro y desglose */}
                          <div className="pt-3 space-y-2.5">
                            {/* Fila destacada con el total de propinas del mesero */}
                            <div className="flex items-center justify-between bg-slate-950/60 px-3 py-2 rounded-lg border border-slate-800">
                              <span className="text-xs font-bold text-slate-300">
                                Total propinas:
                              </span>
                              <span className="text-base sm:text-lg font-black text-amber-400 font-mono">
                                {formatCOP(p.total)}
                              </span>
                            </div>

                            {/* Desglose efectivo vs digital */}
                            <div className="space-y-1.5 text-xs px-1">
                              <div className="flex items-center justify-between text-slate-300">
                                <span className="text-slate-400">
                                  En efectivo (en caja):
                                </span>
                                <span className="font-bold font-mono text-emerald-400">
                                  {formatCOP(p.en_efectivo)}
                                </span>
                              </div>
                              <div className="flex items-center justify-between text-slate-300">
                                <span className="text-slate-400">
                                  Por transferir (Nequi/datáfono):
                                </span>
                                <span className="font-bold font-mono text-purple-400">
                                  {formatCOP(p.digital)}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Línea con el total de propinas del turno */}
                <div className="pt-3 border-t border-slate-700/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-900/40 p-3.5 rounded-xl border border-slate-700/50">
                  <span className="text-xs sm:text-sm font-bold text-slate-300">
                    Total de propinas del turno:
                  </span>
                  <span className="text-lg sm:text-xl font-black text-amber-400 font-mono">
                    {formatCOP(totalPropinas)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* SECCIÓN: MESAS LIBERADAS SIN COBRO (TAREA 4) */}
          <div className="bg-slate-800/60 border border-slate-700/80 rounded-2xl overflow-hidden shadow-xl">
            <div className="p-4 sm:p-5 border-b border-slate-700/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <h3 className="text-lg font-black text-white flex items-center gap-2">
                  <span>🔓</span>
                  <span>Mesas liberadas sin cobro</span>
                </h3>
                <span className="px-2.5 py-0.5 rounded-full bg-rose-950 border border-rose-700/50 text-rose-300 text-xs font-bold">
                  {liberaciones.length}
                </span>
              </div>
              <p className="text-xs text-slate-400 italic">
                * Auditoría de mesas liberadas con consumo sin cobrar en este turno
              </p>
            </div>

            {liberaciones.length === 0 ? (
              <div className="py-12 text-center text-slate-400">
                <span className="text-3xl block mb-2">✅</span>
                <p className="font-semibold text-slate-300">No hay mesas liberadas sin cobro</p>
                <p className="text-xs text-slate-500 mt-1">
                  Todas las mesas del turno han sido cobradas o liberadas sin consumo pendiente.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-200">
                  <thead className="bg-slate-900/60 text-xs uppercase tracking-wider text-slate-400 font-bold border-b border-slate-700">
                    <tr>
                      <th scope="col" className="px-4 py-3">Hora</th>
                      <th scope="col" className="px-4 py-3">Mesa</th>
                      <th scope="col" className="px-4 py-3">Motivo</th>
                      <th scope="col" className="px-4 py-3">Liberada por</th>
                      <th scope="col" className="px-4 py-3 text-right">Monto no cobrado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/50">
                    {liberaciones.map((lib, idx) => {
                      const horaStr = lib.fecha
                        ? new Date(lib.fecha).toLocaleTimeString('es-CO', {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                            hour12: true,
                          })
                        : '—'
                      const numMesa = lib.mesas?.numero ?? lib.mesa_id
                      return (
                        <tr key={lib.id ?? idx} className="hover:bg-slate-700/30 transition-colors">
                          <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                            {horaStr}
                          </td>
                          <td className="px-4 py-3 font-extrabold text-white whitespace-nowrap">
                            Mesa {numMesa}
                          </td>
                          <td className="px-4 py-3 text-slate-300 text-xs font-medium max-w-xs break-words">
                            {lib.motivo}
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                            {lib.liberada_por_nombre || 'Desconocido'}
                          </td>
                          <td className="px-4 py-3 text-right font-black text-rose-400 font-mono whitespace-nowrap">
                            {formatCOP(lib.monto_no_cobrado)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
        </>
      ) : (
        /* PESTAÑA: HISTÓRICO DE CAJAS */
        <div className="mt-4 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2">
            <div>
              <h2 className="text-xl font-black text-white flex items-center gap-2">
                <span>📅</span> Historial de Turnos Cerrados
              </h2>
              <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
                Auditoría y consulta de cajas de días anteriores y jornadas finalizadas
              </p>
            </div>
            <span className="text-xs px-3 py-1 rounded-full bg-slate-800 border border-slate-700 text-slate-300 font-bold self-start sm:self-center">
              {historicoTurnos.length} turno{historicoTurnos.length !== 1 ? 's' : ''} registrado{historicoTurnos.length !== 1 ? 's' : ''}
            </span>
          </div>

          {errorHistorico && (
            <div className="p-4 rounded-xl bg-red-950/80 border border-red-600/60 text-red-200 text-xs sm:text-sm font-semibold flex items-center justify-between shadow-lg">
              <div className="flex items-center gap-2">
                <span>⚠️</span>
                <span>{errorHistorico}</span>
              </div>
              <button
                type="button"
                onClick={() => void cargarHistorico()}
                className="text-xs px-2.5 py-1 bg-red-900 hover:bg-red-800 text-white font-bold rounded-lg"
              >
                Reintentar
              </button>
            </div>
          )}

          {loadingHistorico ? (
            <div className="py-20 text-center">
              <div className="w-10 h-10 border-4 border-slate-700 border-t-blue-500 rounded-full animate-spin mx-auto mb-4" />
              <p className="text-slate-400 text-sm">Cargando histórico de turnos...</p>
            </div>
          ) : historicoTurnos.length === 0 ? (
            <div className="bg-slate-800/60 border border-slate-700/80 rounded-2xl p-12 text-center shadow-xl">
              <span className="text-5xl block mb-3">📁</span>
              <h3 className="text-lg font-black text-white">No hay turnos cerrados en el historial</h3>
              <p className="text-slate-400 text-sm max-w-md mx-auto mt-1">
                Cuando se cierre un turno de caja mediante conteo ciego, su resumen consolidado
                aparecerá aquí para auditoría y consulta.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {historicoTurnos.map((t) => {
                const fechaApertura = formatFecha(
                  t.fecha_apertura || t.created_at || (t as Record<string, unknown>).fecha as string | undefined
                )
                const fechaCierre = formatFecha(
                  t.fecha_cierre || t.cerrado_at || (t as Record<string, unknown>).updated_at as string | undefined
                )
                const base = Number(t.base_inicial ?? t.base ?? 0)
                const esperado = Number(t.efectivo_esperado ?? t.esperado ?? 0)
                const contado = Number(t.efectivo_contado ?? t.contado ?? 0)
                const diferencia =
                  t.diferencia !== undefined && t.diferencia !== null
                    ? Number(t.diferencia)
                    : contado - esperado
                const totalVendido = Number(t.total_vendido ?? t.ingresos_total ?? 0)
                const esPositiva = diferencia >= 0

                return (
                  <div
                    key={t.id}
                    className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-5 shadow-xl hover:border-slate-600 transition-all space-y-4"
                  >
                    {/* Encabezado del turno */}
                    <div className="flex items-center justify-between pb-3 border-b border-slate-700/60">
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-0.5 rounded-md bg-slate-700/60 text-slate-300 text-xs font-bold font-mono">
                          Turno #{t.id}
                        </span>
                        <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-slate-900 text-slate-400 border border-slate-700">
                          Cerrado
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-[11px] text-slate-400 block font-medium">Total Vendido</span>
                        <span className="text-base sm:text-lg font-black text-emerald-400 font-mono">
                          {formatCOP(totalVendido)}
                        </span>
                      </div>
                    </div>

                    {/* Fechas de apertura y cierre */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs bg-slate-900/60 p-3 rounded-xl border border-slate-800/80">
                      <div>
                        <span className="text-slate-400 block text-[11px]">Apertura:</span>
                        <span className="text-slate-200 font-medium">{fechaApertura}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[11px]">Cierre:</span>
                        <span className="text-slate-200 font-medium">{fechaCierre}</span>
                      </div>
                    </div>

                    {/* Métricas clave: Base, Esperado, Contado, Diferencia */}
                    <div className="grid grid-cols-2 gap-3 text-xs pt-1">
                      <div className="bg-slate-900/40 p-2.5 rounded-xl border border-slate-800">
                        <span className="text-slate-400 text-[11px] block">Base Inicial</span>
                        <span className="text-sm font-bold text-slate-200 font-mono">
                          {formatCOP(base)}
                        </span>
                      </div>

                      <div className="bg-slate-900/40 p-2.5 rounded-xl border border-slate-800">
                        <span className="text-slate-400 text-[11px] block">Efectivo Esperado</span>
                        <span className="text-sm font-bold text-slate-200 font-mono">
                          {formatCOP(esperado)}
                        </span>
                      </div>

                      <div className="bg-slate-900/40 p-2.5 rounded-xl border border-slate-800">
                        <span className="text-slate-400 text-[11px] block">Efectivo Contado</span>
                        <span className="text-sm font-bold text-white font-mono">
                          {formatCOP(contado)}
                        </span>
                      </div>

                      <div
                        className={`p-2.5 rounded-xl border ${
                          esPositiva
                            ? 'bg-emerald-950/30 border-emerald-700/40'
                            : 'bg-rose-950/30 border-rose-700/40'
                        }`}
                      >
                        <span className="text-slate-400 text-[11px] block">Diferencia</span>
                        <span
                          className={`text-sm font-black font-mono ${
                            esPositiva ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {esPositiva && diferencia > 0 ? '+' : ''}
                          {formatCOP(diferencia)}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* MODAL: REGISTRAR MOVIMIENTO RÁPIDO */}
      {modalMovimientoOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md bg-slate-800 border border-slate-700 rounded-2xl p-6 shadow-2xl relative text-left">
            <div className="flex items-center justify-between pb-4 border-b border-slate-700">
              <h3 className="text-lg font-black text-white flex items-center gap-2">
                <span>{movTipo === 'ingreso' ? '➕' : '➖'}</span>
                <span>{movTipo === 'ingreso' ? 'Registrar Ingreso Rápido' : 'Registrar Egreso Rápido'}</span>
              </h3>
              <button
                type="button"
                onClick={() => {
                  if (!guardandoMovimiento) {
                    setModalMovimientoOpen(false)
                    setConfirmandoMovimiento(false)
                  }
                }}
                disabled={guardandoMovimiento}
                className="text-slate-400 hover:text-white text-xl leading-none font-bold"
              >
                ✕
              </button>
            </div>

            {/* Paso 2: Confirmación previa requerida con resumen exacto */}
            {confirmandoMovimiento ? (
              <div className="py-4 space-y-4">
                <div className="p-4 rounded-xl bg-slate-900 border border-slate-700 space-y-2">
                  <p className="text-xs uppercase font-bold tracking-wider text-slate-400">
                    Confirmación de movimiento
                  </p>
                  <p className="text-lg font-black text-white">
                    {movTipo === 'ingreso' ? 'Ingreso' : 'Egreso'} de {formatCOP(movMonto)} — {movConcepto.trim()}
                  </p>
                  <div className="flex flex-wrap gap-2 pt-2 text-xs text-slate-300">
                    <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700">
                      Categoría: <strong>{movCategoria.replace('_', ' ')}</strong>
                    </span>
                    <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700">
                      Método: <strong>{movMetodoPago}</strong>
                    </span>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-amber-950/60 border border-amber-600/40 text-amber-200 text-xs">
                  ⚠️ <strong>Atención:</strong> Los movimientos registrados no se pueden modificar ni eliminar.
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setConfirmandoMovimiento(false)}
                    disabled={guardandoMovimiento}
                    className="flex-1 min-h-[44px] py-2.5 px-4 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold text-sm transition-all disabled:opacity-50"
                  >
                    Editar datos
                  </button>
                  <button
                    type="button"
                    onClick={handleGuardarMovimiento}
                    disabled={guardandoMovimiento || !isOnline}
                    className={`flex-1 min-h-[44px] py-2.5 px-4 rounded-xl font-bold text-sm text-white transition-all shadow-lg flex items-center justify-center gap-2 ${
                      movTipo === 'ingreso'
                        ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/30'
                        : 'bg-rose-600 hover:bg-rose-500 shadow-rose-600/30'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {guardandoMovimiento ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>Guardando...</span>
                      </>
                    ) : (
                      <span>Confirmar y Guardar</span>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              /* Paso 1: Formulario */
              <form onSubmit={handlePrepararConfirmacion} className="py-4 space-y-4">
                {/* Concepto */}
                <div>
                  <label
                    htmlFor="mov-concepto"
                    className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5"
                  >
                    Concepto *
                  </label>
                  <input
                    id="mov-concepto"
                    type="text"
                    required
                    placeholder={
                      movTipo === 'ingreso'
                        ? 'Ej. Venta rápida bebidas / gaseosas'
                        : 'Ej. Bolsa de hielo / compra verduras'
                    }
                    value={movConcepto}
                    onChange={(e) => setMovConcepto(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white placeholder-slate-500 font-medium text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                  />
                </div>

                {/* Monto */}
                <div>
                  <label
                    htmlFor="mov-monto"
                    className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5"
                  >
                    Monto (Pesos colombianos) *
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold">
                      $
                    </span>
                    <input
                      id="mov-monto"
                      type="number"
                      step="1"
                      min="1"
                      required
                      placeholder="Ej. 12000"
                      value={movMonto}
                      onChange={(e) => setMovMonto(e.target.value)}
                      className="w-full pl-8 pr-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white placeholder-slate-500 font-bold text-base focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    />
                  </div>
                  {movMonto && !isNaN(Number(movMonto)) && (
                    <p className="text-xs text-sky-400 font-bold mt-1">
                      {formatCOP(movMonto)}
                    </p>
                  )}
                </div>

                {/* Categoría */}
                <div>
                  <label
                    htmlFor="mov-categoria"
                    className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5"
                  >
                    Categoría *
                  </label>
                  <select
                    id="mov-categoria"
                    value={movCategoria}
                    onChange={(e) => setMovCategoria(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white font-medium text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                  >
                    {(movTipo === 'ingreso' ? CATEGORIAS_INGRESO : CATEGORIAS_EGRESO).map(
                      (cat) => (
                        <option key={cat.value} value={cat.value}>
                          {cat.label}
                        </option>
                      )
                    )}
                  </select>
                </div>

                {/* Método de pago */}
                <div>
                  <label
                    htmlFor="mov-metodo-pago"
                    className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5"
                  >
                    Método de pago *
                  </label>
                  <select
                    id="mov-metodo-pago"
                    value={movMetodoPago}
                    onChange={(e) =>
                      setMovMetodoPago(e.target.value as 'efectivo' | 'nequi' | 'datafono')
                    }
                    className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white font-medium text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                  >
                    {METODOS_PAGO.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex gap-3 pt-3">
                  <button
                    type="button"
                    onClick={() => setModalMovimientoOpen(false)}
                    className="flex-1 min-h-[44px] py-2.5 px-4 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold text-sm transition-all"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className={`flex-1 min-h-[44px] py-2.5 px-4 rounded-xl font-bold text-sm text-white transition-all shadow-lg ${
                      movTipo === 'ingreso'
                        ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/30'
                        : 'bg-rose-600 hover:bg-rose-500 shadow-rose-600/30'
                    }`}
                  >
                    Continuar
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* MODAL: CERRAR TURNO (ARQUEO A CIEGAS) */}
      {modalCerrarOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md bg-slate-800 border border-slate-700 rounded-2xl p-6 shadow-2xl relative text-left">
            <div className="flex items-center justify-between pb-4 border-b border-slate-700">
              <h3 className="text-lg font-black text-white flex items-center gap-2">
                <span>🔒</span>
                <span>Cierre de Turno de Caja</span>
              </h3>
              <button
                type="button"
                onClick={() => {
                  if (!cerrandoTurno) setModalCerrarOpen(false)
                }}
                disabled={cerrandoTurno}
                className="text-slate-400 hover:text-white text-xl leading-none font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleConfirmarCierreTurno} className="py-4 space-y-4">
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-700 text-xs text-slate-300">
                <p className="font-bold text-white mb-1">Arqueo ciego de caja</p>
                <p>
                  Cuenta físicamente todos los billetes y monedas en efectivo.
                  El sistema contrastará el valor contado contra el flujo registrado.
                </p>
              </div>

              <div>
                <label
                  htmlFor="efectivo-contado-input"
                  className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5"
                >
                  Efectivo físico contado *
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-base">
                    $
                  </span>
                  <input
                    id="efectivo-contado-input"
                    type="number"
                    step="1"
                    min="0"
                    required
                    placeholder="Ej. 250000"
                    value={efectivoContadoInput}
                    onChange={(e) => setEfectivoContadoInput(e.target.value)}
                    className="w-full pl-8 pr-3.5 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white placeholder-slate-500 font-black text-lg focus:outline-none focus:ring-2 focus:ring-amber-500 transition-all"
                  />
                </div>
                {efectivoContadoInput && !isNaN(Number(efectivoContadoInput)) && (
                  <p className="text-xs text-amber-400 font-bold mt-1.5">
                    Total contado: {formatCOP(efectivoContadoInput)}
                  </p>
                )}
              </div>

              <div className="flex gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setModalCerrarOpen(false)}
                  disabled={cerrandoTurno}
                  className="flex-1 min-h-[44px] py-2.5 px-4 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold text-sm transition-all disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={cerrandoTurno || !isOnline}
                  className="flex-1 min-h-[44px] py-2.5 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 active:scale-95 text-white font-bold text-sm shadow-lg shadow-amber-600/30 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {cerrandoTurno ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Cerrando...</span>
                    </>
                  ) : (
                    <span>Cerrar turno</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL / VISTA DE RESULTADO DEL CIERRE */}
      {resultadoCierre && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in">
          <div className="w-full max-w-lg bg-slate-800 border border-slate-700 rounded-3xl p-6 sm:p-8 shadow-2xl text-left space-y-6">
            <div className="text-center space-y-2">
              <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center text-3xl mx-auto">
                ✅
              </div>
              <h2 className="text-2xl font-black text-white">
                Turno Cerrado con Éxito
              </h2>
              <p className="text-xs sm:text-sm text-slate-400">
                Resumen del balance y arqueo de caja registrado
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-4 rounded-2xl bg-slate-900 border border-slate-700/80 text-center">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Esperado
                </p>
                <p className="text-lg font-black text-white mt-1">
                  {formatCOP(resultadoCierre.esperado)}
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-slate-900 border border-slate-700/80 text-center">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Contado
                </p>
                <p className="text-lg font-black text-amber-400 mt-1">
                  {formatCOP(resultadoCierre.contado)}
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-slate-900 border border-slate-700/80 text-center">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Diferencia
                </p>
                <p
                  className={`text-lg font-black mt-1 ${
                    resultadoCierre.diferencia === 0
                      ? 'text-emerald-400'
                      : resultadoCierre.diferencia > 0
                      ? 'text-sky-400'
                      : 'text-rose-400'
                  }`}
                >
                  {resultadoCierre.diferencia > 0 ? '+' : ''}
                  {formatCOP(resultadoCierre.diferencia)}
                </p>
              </div>
            </div>

            <div
              className={`p-4 rounded-xl text-xs font-bold flex items-center gap-3 ${
                resultadoCierre.diferencia === 0
                  ? 'bg-emerald-950/80 border border-emerald-600/50 text-emerald-300'
                  : resultadoCierre.diferencia > 0
                  ? 'bg-sky-950/80 border border-sky-600/50 text-sky-300'
                  : 'bg-rose-950/80 border border-rose-600/50 text-rose-300'
              }`}
            >
              <span className="text-xl">
                {resultadoCierre.diferencia === 0 ? '🎯' : resultadoCierre.diferencia > 0 ? '📈' : '📉'}
              </span>
              <span>
                {resultadoCierre.diferencia === 0
                  ? 'Cuadre perfecto: El dinero contado coincide exactamente con el flujo del turno.'
                  : resultadoCierre.diferencia > 0
                  ? `Sobrante en caja de ${formatCOP(resultadoCierre.diferencia)}.`
                  : `Faltante en caja de ${formatCOP(Math.abs(resultadoCierre.diferencia))}.`}
              </span>
            </div>

            <button
              type="button"
              onClick={handleFinalizarCierre}
              className="w-full min-h-[48px] py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-[0.99] text-white font-bold text-sm shadow-lg shadow-blue-600/30 transition-all text-center"
            >
              Aceptar y Volver a Apertura
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default ControlCaja
