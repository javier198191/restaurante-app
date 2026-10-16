import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

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
      precio_unitario?: number | null
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
    precio_unitario?: number | null
    productos?: {
      id: number
      nombre: string
      precio: number
    } | null
  }> | null
}

type MetodoPagoSimple = 'efectivo' | 'nequi' | 'datafono'
type TipoCobro = MetodoPagoSimple | 'mixto'

interface FilaPagoMixto {
  id: string
  metodo: MetodoPagoSimple
  monto: string
}

interface PagoItem {
  metodo: MetodoPagoSimple
  monto: number
}

// Formato de moneda colombiana
const formatCOP = (valor: number | string | undefined | null): string => {
  const num = Number(valor) || 0
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(num)
}

export const ResumenMesa: React.FC<ResumenMesaProps> = ({
  mesaId: propMesaId,
  onVolver,
  onCobroExitoso,
  onAgregarProductos,
  onNavigate,
}) => {
  const { role } = useAuth()

  // 1. Obtener mesaId de props o de la URL
  const mesaId = useMemo(() => {
    if (propMesaId !== undefined && propMesaId !== null) {
      return Number(propMesaId)
    }
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
  const [error, setError] = useState<string | null>(null)
  const [pedidoActivo, setPedidoActivo] = useState<PedidoActivoRaw | null>(null)

  // 1. Manejo reactivo de propina: null = sugerida (10%)
  const [propinaManual, setPropinaManual] = useState<number | null>(null)

  // Estados del modal de cobro
  const [modalPagoOpen, setModalPagoOpen] = useState<boolean>(false)
  const [tipoCobro, setTipoCobro] = useState<TipoCobro>('efectivo')
  const [efectivoRecibido, setEfectivoRecibido] = useState<string>('')
  const [filasMixtas, setFilasMixtas] = useState<FilaPagoMixto[]>([
    { id: '1', metodo: 'efectivo', monto: '' },
    { id: '2', metodo: 'nequi', monto: '' },
  ])
  const [pasoConfirmacion, setPasoConfirmacion] = useState<boolean>(false)
  const [procesandoCobro, setProcesandoCobro] = useState<boolean>(false)
  const [exitoModalData, setExitoModalData] = useState<{
    totalCobrado: number
    cambioADevolver: number
    metodo: string
  } | null>(null)

  // Estados para imprimir cuenta (Tarea 3)
  const [deshabilitarImprimirCuenta, setDeshabilitarImprimirCuenta] = useState<boolean>(false)
  const [cuentaMensaje, setCuentaMensaje] = useState<{
    tipo: 'success' | 'error'
    texto: string
  } | null>(null)

  // Estados para modal de liberar mesa (Tarea 3)
  const [modalLiberarOpen, setModalLiberarOpen] = useState<boolean>(false)
  const [opcionMotivo, setOpcionMotivo] = useState<string>('Cliente se fue sin pagar')
  const [motivoTextoLibre, setMotivoTextoLibre] = useState<string>('')
  const [liberandoMesa, setLiberandoMesa] = useState<boolean>(false)
  const [errorLiberar, setErrorLiberar] = useState<string | null>(null)

  // Rol permitido para liberar mesa: mesero, cajero y admin
  const puedeLiberar = role === 'mesero' || role === 'cajero' || role === 'admin' || !role

  // Rol permitido para anular productos del pedido: solo admin o cajero
  const puedeAnularItem = role === 'admin' || role === 'cajero'

  // Estados para Cambiar de Mesa (Tarea 3)
  const [modalMoverMesaOpen, setModalMoverMesaOpen] = useState<boolean>(false)
  const [mesasLibres, setMesasLibres] = useState<Array<{ id: number; numero: string | number }>>([])
  const [cargandoMesasLibres, setCargandoMesasLibres] = useState<boolean>(false)
  const [mesaDestinoId, setMesaDestinoId] = useState<number | null>(null)
  const [moviendoMesa, setMoviendoMesa] = useState<boolean>(false)
  const [errorMoverMesa, setErrorMoverMesa] = useState<string | null>(null)

  // Estados para Anular Ítem (Tarea 3)
  const [modalAnularItemOpen, setModalAnularItemOpen] = useState<boolean>(false)
  const [itemAAnular, setItemAAnular] = useState<ItemDetalleResumen | null>(null)
  const [motivoAnulacion, setMotivoAnulacion] = useState<string>('Error al digitar')
  const [motivoAnulacionTextoLibre, setMotivoAnulacionTextoLibre] = useState<string>('')
  const [anulandoItem, setAnulandoItem] = useState<boolean>(false)
  const [errorAnularItem, setErrorAnularItem] = useState<string | null>(null)

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
              precio_unitario,
              productos (id, nombre, precio)
            )
          ),
          detalle_pedido (
            id,
            producto_id,
            cantidad,
            nota,
            ronda_id,
            precio_unitario,
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

  // 3. Consolidar items usando precio_unitario (o productos.precio si es null)
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
            const precioEfectivo =
              it.precio_unitario !== null && it.precio_unitario !== undefined
                ? Number(it.precio_unitario)
                : Number(it.productos?.precio ?? 0)

            items.push({
              id: it.id,
              producto_id: it.producto_id,
              cantidad: it.cantidad,
              nota: it.nota,
              nombre: it.productos?.nombre || `Producto #${it.producto_id}`,
              precio: precioEfectivo,
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
          const precioEfectivo =
            it.precio_unitario !== null && it.precio_unitario !== undefined
              ? Number(it.precio_unitario)
              : Number(it.productos?.precio ?? 0)

          items.push({
            id: it.id,
            producto_id: it.producto_id,
            cantidad: it.cantidad,
            nota: it.nota,
            nombre: it.productos?.nombre || `Producto #${it.producto_id}`,
            precio: precioEfectivo,
            ronda_numero: 0,
          })
        }
      }
    }

    return items
  }, [pedidoActivo])

  // 4. Subtotal, Propina y Total a pagar
  const subtotal = useMemo(() => {
    return itemsConsolidados.reduce((acc, it) => acc + it.cantidad * it.precio, 0)
  }, [itemsConsolidados])

  // Propina sugerida (10%) y efectiva (recalcula si subtotal cambia)
  const propinaSugerida = useMemo(() => {
    return Math.round(subtotal * 0.1)
  }, [subtotal])

  const propina = useMemo(() => {
    return propinaManual ?? propinaSugerida
  }, [propinaManual, propinaSugerida])

  // Validación: la propina no puede ser mayor al subtotal
  const propinaMayorAlSubtotal = useMemo(() => {
    return subtotal > 0 && propina > subtotal
  }, [subtotal, propina])

  const totalAPagar = useMemo(() => {
    return subtotal + propina
  }, [subtotal, propina])

  // Sanitizador del input de propina
  const handlePropinaInputChange = (valStr: string) => {
    if (valStr.trim() === '') {
      setPropinaManual(0)
      return
    }
    const valNum = Number(valStr)
    if (isNaN(valNum) || valNum <= 0) {
      setPropinaManual(0)
    } else {
      setPropinaManual(Math.round(valNum))
    }
  }

  // Navegar a tomar pedidos
  const handleAgregarProductos = () => {
    if (onAgregarProductos) {
      onAgregarProductos(mesaId)
    } else if (onNavigate) {
      onNavigate('tomar-pedido', mesaId)
    }
  }

  // Sanitizar número de mesa
  const numeroMesa = useMemo(() => {
    const raw = pedidoActivo?.mesas?.numero ?? mesaId
    const str = String(raw).trim()
    return str.toLowerCase().startsWith('mesa') ? str.replace(/^mesa\s*/i, '').trim() : str
  }, [pedidoActivo?.mesas?.numero, mesaId])

  // Abrir modal de cobro (usando totalAPagar)
  const handleAbrirModalPago = () => {
    setTipoCobro('efectivo')
    setEfectivoRecibido(totalAPagar > 0 ? String(totalAPagar) : '')
    setFilasMixtas([
      { id: '1', metodo: 'efectivo', monto: '' },
      { id: '2', metodo: 'nequi', monto: '' },
    ])
    setPasoConfirmacion(false)
    setError(null)
    setModalPagoOpen(true)
  }

  // Cálculos para pago mixto (usando totalAPagar)
  const sumaMixta = useMemo(() => {
    return filasMixtas.reduce((acc, f) => acc + (Number(f.monto) || 0), 0)
  }, [filasMixtas])

  const diferenciaMixta = useMemo(() => {
    return totalAPagar - sumaMixta
  }, [totalAPagar, sumaMixta])

  // Cálculos para efectivo (usando totalAPagar)
  const recibidoNum = Number(efectivoRecibido) || 0
  const cambioEfectivo = recibidoNum - totalAPagar

  // Validación para habilitar el paso a confirmación
  const esValidoParaContinuar = useMemo(() => {
    if (totalAPagar <= 0 || propinaMayorAlSubtotal) return false
    if (tipoCobro === 'efectivo') {
      return recibidoNum >= totalAPagar
    }
    if (tipoCobro === 'nequi' || tipoCobro === 'datafono') {
      return true
    }
    if (tipoCobro === 'mixto') {
      if (filasMixtas.length < 2) return false
      const todosValidos = filasMixtas.every((f) => {
        const val = Number(f.monto)
        return !isNaN(val) && val > 0 && Number.isInteger(val)
      })
      return todosValidos && sumaMixta === totalAPagar
    }
    return false
  }, [totalAPagar, propinaMayorAlSubtotal, tipoCobro, recibidoNum, filasMixtas, sumaMixta])

  // Construir arreglo de pagos según la opción seleccionada
  const construirPagos = useCallback((): PagoItem[] => {
    if (tipoCobro === 'efectivo') {
      return [{ metodo: 'efectivo', monto: totalAPagar }]
    }
    if (tipoCobro === 'nequi') {
      return [{ metodo: 'nequi', monto: totalAPagar }]
    }
    if (tipoCobro === 'datafono') {
      return [{ metodo: 'datafono', monto: totalAPagar }]
    }
    if (tipoCobro === 'mixto') {
      return filasMixtas.map((f) => ({
        metodo: f.metodo,
        monto: Math.round(Number(f.monto)),
      }))
    }
    return []
  }, [tipoCobro, totalAPagar, filasMixtas])

  // Generar texto de resumen del cobro requerido para confirmación
  const resumenTextoCobro = useMemo(() => {
    const formatMetodoNombre = (m: MetodoPagoSimple) =>
      m === 'datafono' ? 'Datáfono' : m === 'nequi' ? 'Nequi' : 'efectivo'

    if (tipoCobro === 'efectivo') {
      return `Cobrar ${formatCOP(totalAPagar)}: ${formatCOP(totalAPagar)} efectivo`
    }
    if (tipoCobro === 'nequi') {
      return `Cobrar ${formatCOP(totalAPagar)}: ${formatCOP(totalAPagar)} Nequi`
    }
    if (tipoCobro === 'datafono') {
      return `Cobrar ${formatCOP(totalAPagar)}: ${formatCOP(totalAPagar)} Datáfono`
    }
    if (tipoCobro === 'mixto') {
      const desglose = filasMixtas
        .map((f) => `${formatCOP(Number(f.monto))} ${formatMetodoNombre(f.metodo)}`)
        .join(' + ')
      return `Cobrar ${formatCOP(totalAPagar)}: ${desglose}`
    }
    return ''
  }, [tipoCobro, totalAPagar, filasMixtas])

  // Manejo de filas en pago mixto
  const handleAgregarFilaMixta = () => {
    setFilasMixtas((prev) => [
      ...prev,
      { id: String(Date.now()), metodo: 'datafono', monto: '' },
    ])
  }

  const handleEliminarFilaMixta = (id: string) => {
    if (filasMixtas.length <= 2) return
    setFilasMixtas((prev) => prev.filter((f) => f.id !== id))
  }

  const handleActualizarFilaMixta = (
    id: string,
    campo: 'metodo' | 'monto',
    valor: string
  ) => {
    setFilasMixtas((prev) =>
      prev.map((f) => (f.id === id ? { ...f, [campo]: valor } : f))
    )
  }

  // 6. Acción de Cobrar y Liberar Mesa (ANTI-DUPLICADOS + Validación de Red)
  const handleConfirmarCobroFinal = async () => {
    if (procesandoCobro || propinaMayorAlSubtotal) return

    // 7. El cobro necesita internet: NO meter en cola offline
    if (!navigator.onLine) {
      setError('Sin conexión: el cobro necesita internet')
      return
    }

    setProcesandoCobro(true)
    setError(null)

    const pagosArray = construirPagos()
    // Asegurar propina como entero válido (nunca NaN, null ni undefined)
    const propinaEntera = Math.max(0, Math.round(Number(propina) || 0))

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: rpcErr } = await (supabase.rpc as any)('cerrar_mesa_y_cobrar', {
        p_mesa_id: Number(mesaId),
        p_pagos: pagosArray,
        p_propina: propinaEntera,
      })

      if (rpcErr) {
        console.error('Error RPC cerrar_mesa_y_cobrar:', rpcErr)
        const msg = rpcErr.message || ''

        // 6. Mapeo contextual de errores según especificación
        if (msg.includes('No hay turno de caja abierto')) {
          if (role === 'mesero') {
            setError('Pide al cajero que abra el turno de caja')
          } else {
            setError('Abre el turno en Control de Caja')
          }
        } else if (msg.includes('Los pagos suman')) {
          setError(msg)
          void cargarResumen()
        } else if (rpcErr.code === '42501' || msg.includes('42501')) {
          setError('Tu usuario no tiene permiso para cobrar')
        } else if (msg.includes('La mesa no tiene un pedido abierto')) {
          setError('La mesa no tiene un pedido abierto (probablemente ya se cobró).')
          void cargarResumen()
        } else {
          setError(msg || 'Error inesperado al cobrar la mesa')
        }

        setProcesandoCobro(false)
        return
      }

      // Éxito en el cobro
      const cambioCalculado = tipoCobro === 'efectivo' ? Math.max(0, cambioEfectivo) : 0
      setExitoModalData({
        totalCobrado: totalAPagar,
        cambioADevolver: cambioCalculado,
        metodo: tipoCobro,
      })

      setModalPagoOpen(false)
      setPasoConfirmacion(false)
      void cargarResumen()
    } catch (err: unknown) {
      const errObj = err as { message?: string; code?: string }
      const msg = errObj?.message || 'Error al comunicarse con el servidor de cobro'
      if (msg.includes('No hay turno de caja abierto')) {
        if (role === 'mesero') {
          setError('Pide al cajero que abra el turno de caja')
        } else {
          setError('Abre el turno en Control de Caja')
        }
      } else if (msg.includes('Los pagos suman')) {
        setError(msg)
        void cargarResumen()
      } else if (errObj?.code === '42501' || msg.includes('42501')) {
        setError('Tu usuario no tiene permiso para cobrar')
      } else if (msg.includes('La mesa no tiene un pedido abierto')) {
        setError('La mesa no tiene un pedido abierto (probablemente ya se cobró).')
        void cargarResumen()
      } else {
        setError(msg)
      }
    } finally {
      setProcesandoCobro(false)
    }
  }

  // Finalizar y regresar al mapa de mesas
  const handleFinalizarYSalir = () => {
    setExitoModalData(null)
    if (onCobroExitoso) {
      onCobroExitoso()
    } else if (onVolver) {
      onVolver()
    } else if (typeof window !== 'undefined') {
      window.location.href = '/mesas'
    }
  }

  // Tarea 3: Botón "Imprimir cuenta"
  const handleImprimirCuenta = async () => {
    if (!pedidoActivo?.id) return

    if (!navigator.onLine) {
      setCuentaMensaje({
        tipo: 'error',
        texto: 'Sin conexión: no se pudo enviar la cuenta',
      })
      return
    }

    setDeshabilitarImprimirCuenta(true)
    setCuentaMensaje(null)

    // Anti-doble-toque: deshabilitado 5 segundos tras el clic
    setTimeout(() => {
      setDeshabilitarImprimirCuenta(false)
    }, 5000)

    try {
      // Inserta { pedido_id } en solicitudes_cuenta sin pasar por cola offline
      const { error: insertErr } = await (
        supabase as unknown as {
          from: (table: string) => {
            insert: (values: Record<string, unknown>) => Promise<{ error: Error | null }>
          }
        }
      )
        .from('solicitudes_cuenta')
        .insert({
          pedido_id: pedidoActivo.id,
        })

      if (insertErr) {
        throw insertErr
      }

      setCuentaMensaje({
        tipo: 'success',
        texto: 'Cuenta enviada a la impresora de caja',
      })
    } catch (err: unknown) {
      if (!navigator.onLine) {
        setCuentaMensaje({
          tipo: 'error',
          texto: 'Sin conexión: no se pudo enviar la cuenta',
        })
      } else {
        const msg = err instanceof Error ? err.message : 'Error al solicitar impresión de cuenta'
        setCuentaMensaje({
          tipo: 'error',
          texto: msg,
        })
      }
    }
  }

  // Tarea 3: Botón "Liberar mesa"
  const handleLiberarMesa = async () => {
    setErrorLiberar(null)
    setLiberandoMesa(true)

    let motivoFinal: string | null = null
    if (subtotal > 0) {
      motivoFinal = opcionMotivo === 'Otro' ? motivoTextoLibre.trim() : opcionMotivo
      if (!motivoFinal || motivoFinal.length < 3) {
        setErrorLiberar('El motivo debe tener al menos 3 caracteres.')
        setLiberandoMesa(false)
        return
      }
    }

    try {
      const { error: rpcErr } = await (
        supabase as unknown as {
          rpc: (
            name: string,
            params: Record<string, unknown>
          ) => Promise<{ error: { code?: string; message?: string } | null }>
        }
      ).rpc('liberar_mesa', {
        p_mesa_id: Number(mesaId),
        p_motivo: motivoFinal,
      })

      if (rpcErr) {
        const errObj = rpcErr as { code?: string; message?: string }
        if (errObj.code === '42501' || errObj.message?.includes('42501')) {
          setErrorLiberar('Tu usuario no tiene permiso para liberar mesas')
        } else {
          setErrorLiberar(errObj.message || 'Error al liberar la mesa')
        }
        return
      }

      // En éxito refresca las mesas y vuelve al mapa
      setModalLiberarOpen(false)
      if (onCobroExitoso) {
        onCobroExitoso()
      } else if (onVolver) {
        onVolver()
      } else if (onNavigate) {
        onNavigate('mesas')
      } else if (typeof window !== 'undefined') {
        window.location.href = '/mesas'
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido al liberar la mesa'
      if (msg.includes('42501')) {
        setErrorLiberar('Tu usuario no tiene permiso para liberar mesas')
      } else {
        setErrorLiberar(msg)
      }
    } finally {
      setLiberandoMesa(false)
    }
  }

  // Tarea 3: Abrir modal y consultar mesas libres
  const handleAbrirMoverMesa = async () => {
    setErrorMoverMesa(null)
    setModalMoverMesaOpen(true)
    setCargandoMesasLibres(true)
    try {
      const { data, error: err } = await supabase
        .from('mesas')
        .select('id, numero')
        .eq('estado', 'libre')
        .order('id', { ascending: true })

      if (err) throw err

      const libres = (data as Array<{ id: number; numero: string | number }>) || []
      // Filtrar la mesa actual por si acaso
      const libresFiltradas = libres.filter((m) => Number(m.id) !== Number(mesaId))
      setMesasLibres(libresFiltradas)
      if (libresFiltradas.length > 0) {
        setMesaDestinoId(libresFiltradas[0].id)
      } else {
        setMesaDestinoId(null)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al consultar mesas libres'
      setErrorMoverMesa(msg)
    } finally {
      setCargandoMesasLibres(false)
    }
  }

  // Tarea 3: Confirmar cambio de mesa invocando cambiar_mesa_pedido
  const handleConfirmarMoverMesa = async () => {
    if (!pedidoActivo?.id) {
      setErrorMoverMesa('No hay un pedido activo para mover.')
      return
    }
    if (!mesaDestinoId) {
      setErrorMoverMesa('Debes seleccionar una mesa de destino.')
      return
    }

    setMoviendoMesa(true)
    setErrorMoverMesa(null)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: rpcErr } = await (supabase.rpc as any)('cambiar_mesa_pedido', {
        p_pedido_id: pedidoActivo.id,
        p_nueva_mesa_id: mesaDestinoId,
      })

      if (rpcErr) throw rpcErr

      setModalMoverMesaOpen(false)
      // En éxito, redirige al Mapa de Mesas
      if (onCobroExitoso) {
        onCobroExitoso()
      } else if (onVolver) {
        onVolver()
      } else if (onNavigate) {
        onNavigate('mapa')
      } else if (typeof window !== 'undefined') {
        window.location.href = '/mesas'
      }
    } catch (err: unknown) {
      console.error('Error al cambiar de mesa:', err)
      const msg = err instanceof Error ? err.message : 'Error al transferir pedido a la nueva mesa'
      setErrorMoverMesa(msg)
    } finally {
      setMoviendoMesa(false)
    }
  }

  // Tarea 3: Iniciar anulación de ítem
  const handleIniciarAnularItem = (item: ItemDetalleResumen) => {
    setItemAAnular(item)
    setMotivoAnulacion('Error al digitar')
    setMotivoAnulacionTextoLibre('')
    setErrorAnularItem(null)
    setModalAnularItemOpen(true)
  }

  // Tarea 3: Confirmar anulación de ítem invocando anular_item_pedido
  const handleConfirmarAnularItem = async () => {
    if (!itemAAnular) return

    const motivoFinal =
      motivoAnulacion === 'Otro'
        ? motivoAnulacionTextoLibre.trim()
        : motivoAnulacion.trim()

    if (!motivoFinal || motivoFinal.length < 2) {
      setErrorAnularItem('Por favor indica un motivo válido para la anulación.')
      return
    }

    setAnulandoItem(true)
    setErrorAnularItem(null)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: rpcErr } = await (supabase.rpc as any)('anular_item_pedido', {
        p_detalle_id: itemAAnular.id,
        p_motivo: motivoFinal,
      })

      if (rpcErr) throw rpcErr

      setModalAnularItemOpen(false)
      setItemAAnular(null)
      // En éxito, refresca los datos de la mesa
      await cargarResumen()
    } catch (err: unknown) {
      console.error('Error al anular producto:', err)
      const msg = err instanceof Error ? err.message : 'Error al anular el producto del pedido'
      setErrorAnularItem(msg)
    } finally {
      setAnulandoItem(false)
    }
  }

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
          disabled={loading || procesandoCobro}
          className="p-2.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 rounded-xl border border-slate-700 text-xs font-semibold self-start sm:self-center transition-all disabled:opacity-50"
        >
          🔄 Recargar
        </button>
      </div>

      {/* Alerta de error */}
      {error && (
        <div className="p-4 rounded-2xl bg-rose-950/80 border border-rose-500 text-rose-200 text-sm font-semibold flex items-center justify-between shadow-lg animate-in fade-in">
          <div className="flex items-center gap-2">
            <span className="text-lg">❌</span>
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-xs px-2.5 py-1 bg-black/40 hover:bg-black/60 rounded-lg text-white font-bold ml-4"
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
            Esta mesa no tiene un pedido abierto con productos registrados. Si deseas agregar productos
            para cobrar, usa el botón a continuación.
          </p>
          <div className="mt-5 flex items-center justify-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={handleAgregarProductos}
              className="min-h-[44px] px-6 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs transition-all shadow-md active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
            >
              ➕ Añadir productos
            </button>
            {pedidoActivo && (
              <button
                type="button"
                onClick={handleAbrirMoverMesa}
                disabled={loading || procesandoCobro}
                className="min-h-[44px] px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-sky-300 font-bold text-xs transition-all border border-slate-700 active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
              >
                🔄 Mover a otra mesa
              </button>
            )}
            {puedeLiberar && (
              <button
                type="button"
                onClick={() => {
                  setOpcionMotivo('Cliente se fue sin pagar')
                  setMotivoTextoLibre('')
                  setErrorLiberar(null)
                  setModalLiberarOpen(true)
                }}
                disabled={loading || procesandoCobro}
                className="min-h-[44px] px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-bold text-xs transition-all border border-slate-700 active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
              >
                🔓 Liberar mesa
              </button>
            )}
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

            <div className="divide-y divide-slate-700/60 max-h-[360px] overflow-y-auto">
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

                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <span className="font-bold font-mono text-white text-base block">
                        {formatCOP(item.cantidad * item.precio)}
                      </span>
                      <p className="text-[11px] text-slate-400 font-mono">
                        ({formatCOP(item.precio)} c/u)
                      </p>
                    </div>

                    {/* Botón Anular Ítem: visible solo para admin o cajero */}
                    {puedeAnularItem && (
                      <button
                        type="button"
                        onClick={() => handleIniciarAnularItem(item)}
                        disabled={procesandoCobro || anulandoItem}
                        title="Anular este producto del pedido"
                        className="px-2.5 py-1.5 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-rose-950/50 border border-slate-700/60 hover:border-rose-700/60 transition-all active:scale-95 cursor-pointer text-xs font-bold flex items-center gap-1.5"
                      >
                        <span className="text-sm">🗑️</span>
                        <span className="hidden sm:inline">Anular</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* DESGLOSE: SUBTOAL, PROPINA VOLUNTARIA Y TOTAL A PAGAR */}
          <div className="bg-slate-800/90 rounded-2xl border border-slate-700 p-5 sm:p-6 flex flex-col gap-3.5 shadow-xl">
            {/* Subtotal */}
            <div className="flex justify-between items-center text-slate-300 text-sm sm:text-base">
              <span>Subtotal de productos:</span>
              <strong className="font-mono text-white text-lg">{formatCOP(subtotal)}</strong>
            </div>

            {/* Fila de Propina voluntaria con input interactivo y botones rápidos */}
            <div className="py-3 px-4 rounded-xl bg-slate-900/80 border border-slate-700/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="text-xs sm:text-sm font-bold text-slate-200 block">
                  Propina voluntaria (10% sugerida)
                </span>
                <span className="text-[11px] text-slate-400">
                  {propinaManual === null
                    ? `Calculada automáticamente: 10% (${formatCOP(propinaSugerida)})`
                    : propinaManual === 0
                    ? 'Sin propina'
                    : 'Personalizada por el cliente'}
                </span>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-bold">
                    $
                  </span>
                  <input
                    type="number"
                    inputMode="numeric"
                    step="1"
                    min="0"
                    value={propina}
                    onChange={(e) => handlePropinaInputChange(e.target.value)}
                    className="w-32 pl-6 pr-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-white font-mono font-bold text-sm text-right focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => setPropinaManual(0)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                    propina === 0
                      ? 'bg-rose-950 border-rose-600/50 text-rose-300'
                      : 'bg-slate-800 border-slate-700 hover:border-slate-600 text-slate-300'
                  }`}
                >
                  Sin propina
                </button>

                <button
                  type="button"
                  onClick={() => setPropinaManual(null)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                    propinaManual === null
                      ? 'bg-emerald-950 border-emerald-600/50 text-emerald-300'
                      : 'bg-slate-800 border-slate-700 hover:border-slate-600 text-slate-300'
                  }`}
                >
                  Restaurar 10%
                </button>
              </div>
            </div>

            {/* Advertencia si la propina excede el subtotal */}
            {propinaMayorAlSubtotal && (
              <div className="p-3 rounded-xl bg-amber-950/70 border border-amber-600/50 text-amber-200 text-xs font-semibold flex items-center gap-2">
                <span>⚠️</span>
                <span>
                  La propina no puede ser mayor al subtotal de la cuenta ({formatCOP(subtotal)}). Ajusta el valor para continuar.
                </span>
              </div>
            )}

            {/* Total a Pagar en Tamaño Grande */}
            <div className="flex justify-between items-baseline pt-2 border-t border-slate-700/80">
              <div>
                <span className="text-xs sm:text-sm font-extrabold uppercase tracking-wider text-slate-400 block">
                  Total a Pagar
                </span>
                <span className="text-xs text-slate-500">
                  {propina > 0 ? 'Subtotal + Propina voluntaria' : 'Solo subtotal (sin propina)'}
                </span>
              </div>
              <span className="text-3xl sm:text-4xl font-black text-emerald-400 font-mono drop-shadow-md">
                {formatCOP(totalAPagar)}
              </span>
            </div>
          </div>

          {/* Mensaje de notificación para impresión de cuenta */}
          {cuentaMensaje && (
            <div
              role="alert"
              className={`p-3.5 rounded-xl text-xs sm:text-sm font-semibold flex items-center justify-between shadow-lg animate-in fade-in ${
                cuentaMensaje.tipo === 'success'
                  ? 'bg-emerald-950/80 border border-emerald-500 text-emerald-200'
                  : 'bg-rose-950/80 border border-rose-500 text-rose-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <span>{cuentaMensaje.tipo === 'success' ? '✅' : '❌'}</span>
                <span>{cuentaMensaje.texto}</span>
              </div>
              <button
                type="button"
                onClick={() => setCuentaMensaje(null)}
                className="text-xs px-2 py-0.5 rounded bg-black/40 hover:bg-black/60 text-white font-bold"
              >
                ✕
              </button>
            </div>
          )}

          {/* Botones de Acción */}
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={handleAgregarProductos}
              disabled={procesandoCobro}
              className="flex-1 min-h-[54px] px-4 py-3.5 rounded-2xl font-black text-sm sm:text-base bg-slate-800 hover:bg-slate-700 active:scale-95 text-sky-400 hover:text-sky-300 transition-all border-2 border-sky-500/40 hover:border-sky-400 flex items-center justify-center gap-2 cursor-pointer shadow-xl shadow-slate-950/40 disabled:opacity-50"
            >
              <span>➕ Añadir más productos</span>
            </button>

            <button
              type="button"
              onClick={handleImprimirCuenta}
              disabled={deshabilitarImprimirCuenta || procesandoCobro}
              className="flex-1 min-h-[54px] px-4 py-3.5 rounded-2xl font-black text-sm sm:text-base bg-slate-800 hover:bg-slate-700 active:scale-95 text-amber-300 hover:text-amber-200 transition-all border-2 border-amber-500/40 hover:border-amber-400 flex items-center justify-center gap-2 cursor-pointer shadow-xl shadow-slate-950/40 disabled:opacity-50"
            >
              <span>🖨️ {deshabilitarImprimirCuenta ? 'Cuenta enviada (5s)' : 'Imprimir cuenta'}</span>
            </button>

            <button
              type="button"
              onClick={handleAbrirModalPago}
              disabled={procesandoCobro || totalAPagar <= 0 || propinaMayorAlSubtotal}
              className="flex-1 min-h-[54px] px-4 py-3.5 rounded-2xl font-black text-sm sm:text-base bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:scale-95 text-white transition-all shadow-xl shadow-emerald-950/60 border-2 border-emerald-400/40 disabled:bg-slate-700 disabled:text-slate-500 flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>💳 Cobrar y Liberar Mesa ({formatCOP(totalAPagar)})</span>
            </button>
          </div>

          {/* Botones secundarios: Mover a otra mesa y Liberar mesa */}
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={handleAbrirMoverMesa}
              disabled={procesandoCobro || !pedidoActivo}
              className="px-4 py-2 rounded-xl text-xs font-bold text-slate-300 hover:text-sky-300 bg-slate-900/60 hover:bg-slate-800 border border-slate-700 hover:border-sky-500/50 transition-all active:scale-95 flex items-center gap-1.5 cursor-pointer"
            >
              <span>🔄 Mover a otra mesa</span>
            </button>

            {puedeLiberar && (
              <button
                type="button"
                onClick={() => {
                  setOpcionMotivo('Cliente se fue sin pagar')
                  setMotivoTextoLibre('')
                  setErrorLiberar(null)
                  setModalLiberarOpen(true)
                }}
                disabled={procesandoCobro || liberandoMesa}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-rose-400 bg-slate-900/60 hover:bg-slate-800 border border-slate-800 hover:border-rose-900/50 transition-all active:scale-95 flex items-center gap-1.5 cursor-pointer"
              >
                <span>🔓 Liberar mesa</span>
              </button>
            )}
          </div>
        </>
      )}

      {/* MODAL DE PAGO (4 OPCIONES + CONFIRMACIÓN FINAL CON totalAPagar) */}
      {modalPagoOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-slate-800 border border-slate-700 rounded-3xl shadow-2xl max-w-lg w-full p-6 text-left flex flex-col gap-5">
            {/* Encabezado del Modal */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-700">
              <div className="flex items-center gap-2.5">
                <span className="text-2xl">💳</span>
                <div>
                  <h3 className="text-lg font-black text-white">
                    {pasoConfirmacion ? 'Confirmación de Cobro' : 'Liquidar Mesa ' + numeroMesa}
                  </h3>
                  <p className="text-xs text-slate-400">Total a cobrar: {formatCOP(totalAPagar)}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!procesandoCobro) {
                    setModalPagoOpen(false)
                    setPasoConfirmacion(false)
                  }
                }}
                disabled={procesandoCobro}
                className="text-slate-400 hover:text-white text-xl leading-none font-bold"
              >
                ✕
              </button>
            </div>

            {/* PASO 2: CONFIRMACIÓN FINAL REQUERIDA (ANTI-DUPLICADOS) */}
            {pasoConfirmacion ? (
              <div className="space-y-4">
                <div className="p-4 rounded-2xl bg-slate-900 border border-slate-700 space-y-2.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
                    Resumen del Cobro
                  </span>
                  <p className="text-lg font-black text-white break-words">
                    {resumenTextoCobro}
                  </p>
                  <div className="pt-2 border-t border-slate-800 text-xs text-slate-300 space-y-1">
                    <div className="flex justify-between">
                      <span>Subtotal consumido:</span>
                      <strong className="text-white font-mono">{formatCOP(subtotal)}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span>Propina voluntaria:</span>
                      <strong className="text-emerald-400 font-mono">{formatCOP(propina)}</strong>
                    </div>
                    {tipoCobro === 'efectivo' && (
                      <>
                        <div className="flex justify-between pt-1 border-t border-slate-800">
                          <span>Efectivo recibido:</span>
                          <strong className="text-white font-mono">{formatCOP(recibidoNum)}</strong>
                        </div>
                        <div className="flex justify-between text-emerald-400 font-bold">
                          <span>Cambio a devolver:</span>
                          <span className="font-mono text-sm">{formatCOP(cambioEfectivo)}</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-amber-950/60 border border-amber-600/40 text-amber-200 text-xs">
                  ⚠️ <strong>Aviso:</strong> Al confirmar, el pedido se liquidará en la base de datos y la mesa quedará libre de inmediato.
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setPasoConfirmacion(false)}
                    disabled={procesandoCobro}
                    className="flex-1 min-h-[46px] py-2.5 px-4 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold text-sm transition-all disabled:opacity-50"
                  >
                    Modificar
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmarCobroFinal}
                    disabled={procesandoCobro || propinaMayorAlSubtotal}
                    className="flex-1 min-h-[46px] py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 font-black text-sm text-white transition-all shadow-lg shadow-emerald-950/50 flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {procesandoCobro ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>Procesando...</span>
                      </>
                    ) : (
                      <span>Confirmar Cobro</span>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              /* PASO 1: SELECCIÓN Y CONFIGURACIÓN DE PAGO (4 OPCIONES) */
              <div className="space-y-5">
                {/* Selector de pestañas con 4 opciones */}
                <div className="grid grid-cols-4 gap-1.5 p-1 bg-slate-900 rounded-2xl border border-slate-700">
                  <button
                    type="button"
                    onClick={() => setTipoCobro('efectivo')}
                    className={`py-2 px-1 text-center rounded-xl text-xs font-bold transition-all ${
                      tipoCobro === 'efectivo'
                        ? 'bg-emerald-600 text-white shadow-md'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    💵 Efectivo
                  </button>
                  <button
                    type="button"
                    onClick={() => setTipoCobro('nequi')}
                    className={`py-2 px-1 text-center rounded-xl text-xs font-bold transition-all ${
                      tipoCobro === 'nequi'
                        ? 'bg-purple-600 text-white shadow-md'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    📱 Nequi
                  </button>
                  <button
                    type="button"
                    onClick={() => setTipoCobro('datafono')}
                    className={`py-2 px-1 text-center rounded-xl text-xs font-bold transition-all ${
                      tipoCobro === 'datafono'
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    💳 Datáfono
                  </button>
                  <button
                    type="button"
                    onClick={() => setTipoCobro('mixto')}
                    className={`py-2 px-1 text-center rounded-xl text-xs font-bold transition-all ${
                      tipoCobro === 'mixto'
                        ? 'bg-amber-600 text-white shadow-md'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    🔀 Mixto
                  </button>
                </div>

                {/* 1. OPCIÓN EFECTIVO */}
                {tipoCobro === 'efectivo' && (
                  <div className="space-y-4">
                    <div>
                      <label
                        htmlFor="efectivo-recibido-input"
                        className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5"
                      >
                        Monto Recibido en Efectivo *
                      </label>
                      <div className="relative">
                        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold">
                          $
                        </span>
                        <input
                          id="efectivo-recibido-input"
                          type="number"
                          step="1"
                          min="0"
                          required
                          placeholder="Ej. 100000"
                          value={efectivoRecibido}
                          onChange={(e) => setEfectivoRecibido(e.target.value)}
                          className="w-full pl-8 pr-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white font-bold text-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
                        />
                      </div>
                    </div>

                    {/* Botones de sugerencias rápidas de billetes */}
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setEfectivoRecibido(String(totalAPagar))}
                        className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700 hover:border-slate-500 text-xs font-semibold text-slate-300 hover:text-white transition-all"
                      >
                        Exacto ({formatCOP(totalAPagar)})
                      </button>
                      {[20000, 50000, 100000].map(
                        (b) =>
                          b >= totalAPagar && (
                            <button
                              key={b}
                              type="button"
                              onClick={() => setEfectivoRecibido(String(b))}
                              className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700 hover:border-slate-500 text-xs font-semibold text-slate-300 hover:text-white transition-all"
                            >
                              {formatCOP(b)}
                            </button>
                          )
                      )}
                    </div>

                    {/* Desglose de cambio */}
                    <div className="p-4 rounded-xl bg-slate-900 border border-slate-700 space-y-1.5 text-xs">
                      <div className="flex justify-between text-slate-400">
                        <span>Total a pagar (con propina):</span>
                        <span className="font-mono text-white font-bold">{formatCOP(totalAPagar)}</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Efectivo entregado:</span>
                        <span className="font-mono text-white font-bold">{formatCOP(recibidoNum)}</span>
                      </div>
                      <div className="flex justify-between pt-1 border-t border-slate-800 text-sm font-bold">
                        <span>Cambio a devolver:</span>
                        <span
                          className={`font-mono ${
                            cambioEfectivo >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {cambioEfectivo >= 0
                            ? formatCOP(cambioEfectivo)
                            : `Falta ${formatCOP(Math.abs(cambioEfectivo))}`}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* 2. OPCIÓN NEQUI */}
                {tipoCobro === 'nequi' && (
                  <div className="p-5 rounded-2xl bg-slate-900 border border-slate-700 text-center space-y-2">
                    <span className="text-3xl block">📱</span>
                    <p className="font-bold text-white text-base">Cobro directo por Nequi</p>
                    <p className="text-xs text-slate-400">
                      Se liquidará el total completo de <strong>{formatCOP(totalAPagar)}</strong> vía Nequi.
                    </p>
                  </div>
                )}

                {/* 3. OPCIÓN DATÁFONO */}
                {tipoCobro === 'datafono' && (
                  <div className="p-5 rounded-2xl bg-slate-900 border border-slate-700 text-center space-y-2">
                    <span className="text-3xl block">💳</span>
                    <p className="font-bold text-white text-base">Cobro directo por Datáfono</p>
                    <p className="text-xs text-slate-400">
                      Se liquidará el total completo de <strong>{formatCOP(totalAPagar)}</strong> con tarjeta bancaria.
                    </p>
                  </div>
                )}

                {/* 4. OPCIÓN MIXTO */}
                {tipoCobro === 'mixto' && (
                  <div className="space-y-3">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold uppercase tracking-wider text-slate-400">
                        Desglose de métodos
                      </span>
                      <button
                        type="button"
                        onClick={handleAgregarFilaMixta}
                        className="text-xs font-bold text-sky-400 hover:text-sky-300 flex items-center gap-1 cursor-pointer"
                      >
                        ➕ Agregar método
                      </button>
                    </div>

                    <div className="space-y-2.5 max-h-48 overflow-y-auto pr-1">
                      {filasMixtas.map((fila, index) => (
                        <div
                          key={fila.id}
                          className="flex items-center gap-2 p-2 rounded-xl bg-slate-900 border border-slate-700"
                        >
                          <span className="text-xs text-slate-400 font-bold w-4 text-center">
                            #{index + 1}
                          </span>
                          <select
                            value={fila.metodo}
                            onChange={(e) =>
                              handleActualizarFilaMixta(
                                fila.id,
                                'metodo',
                                e.target.value as MetodoPagoSimple
                              )
                            }
                            className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white font-semibold focus:outline-none focus:ring-1 focus:ring-blue-500"
                          >
                            <option value="efectivo">Efectivo</option>
                            <option value="nequi">Nequi</option>
                            <option value="datafono">Datáfono</option>
                          </select>

                          <div className="relative flex-1">
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs font-bold">
                              $
                            </span>
                            <input
                              type="number"
                              step="1"
                              min="1"
                              placeholder="Monto"
                              value={fila.monto}
                              onChange={(e) =>
                                handleActualizarFilaMixta(fila.id, 'monto', e.target.value)
                              }
                              className="w-full pl-6 pr-2 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white font-bold focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </div>

                          {filasMixtas.length > 2 && (
                            <button
                              type="button"
                              onClick={() => handleEliminarFilaMixta(fila.id)}
                              className="text-rose-400 hover:text-rose-300 text-sm font-bold px-1"
                              title="Eliminar método"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Estado de balance para pago mixto */}
                    <div className="p-3 rounded-xl bg-slate-900 border border-slate-700 text-xs space-y-1">
                      <div className="flex justify-between text-slate-400">
                        <span>Total a pagar:</span>
                        <span className="font-mono text-white font-bold">{formatCOP(totalAPagar)}</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Suma de métodos ingresados:</span>
                        <span className="font-mono text-white font-bold">{formatCOP(sumaMixta)}</span>
                      </div>
                      <div className="flex justify-between pt-1 border-t border-slate-800 font-bold">
                        <span>Estado:</span>
                        <span
                          className={`font-mono ${
                            diferenciaMixta === 0
                              ? 'text-emerald-400'
                              : 'text-amber-400'
                          }`}
                        >
                          {diferenciaMixta === 0
                            ? '✅ Total cubierto exactamente'
                            : diferenciaMixta > 0
                            ? `Falta ${formatCOP(diferenciaMixta)}`
                            : `Sobra ${formatCOP(Math.abs(diferenciaMixta))}`}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Botones de acción modal */}
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setModalPagoOpen(false)}
                    className="flex-1 min-h-[46px] py-2.5 px-4 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold text-sm transition-all"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => setPasoConfirmacion(true)}
                    disabled={!esValidoParaContinuar}
                    className="flex-1 min-h-[46px] py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 font-black text-sm text-white transition-all shadow-lg shadow-emerald-950/50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Continuar al Cobro
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL DE ÉXITO EN EL COBRO */}
      {exitoModalData && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-slate-800 border border-slate-700 rounded-3xl shadow-2xl max-w-md w-full p-6 text-center space-y-5">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center text-3xl mx-auto">
              ✅
            </div>
            <div>
              <h3 className="text-2xl font-black text-white">¡Cobro Exitoso!</h3>
              <p className="text-xs sm:text-sm text-slate-400 mt-1">
                Mesa {numeroMesa} liquidada y liberada en el sistema.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-slate-900 border border-slate-700 space-y-2 text-left text-xs">
              <div className="flex justify-between text-slate-300">
                <span>Total pagado:</span>
                <strong className="text-white font-mono text-sm">
                  {formatCOP(exitoModalData.totalCobrado)}
                </strong>
              </div>
              {exitoModalData.cambioADevolver > 0 && (
                <div className="flex justify-between items-center pt-2 border-t border-slate-800 text-emerald-400 font-black text-sm">
                  <span>Cambio a devolver:</span>
                  <span className="font-mono text-base">
                    {formatCOP(exitoModalData.cambioADevolver)}
                  </span>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={handleFinalizarYSalir}
              className="w-full min-h-[48px] py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-[0.99] text-white font-bold text-sm shadow-lg shadow-blue-600/30 transition-all text-center cursor-pointer"
            >
              Volver al Mapa de Mesas
            </button>
          </div>
        </div>
      )}

      {/* MODAL DE LIBERAR MESA (TAREA 3) */}
      {modalLiberarOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-slate-800 border border-slate-700 rounded-3xl shadow-2xl max-w-md w-full p-6 text-left flex flex-col gap-4">
            {/* Encabezado del Modal */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-700">
              <div className="flex items-center gap-2.5">
                <span className="text-2xl">🔓</span>
                <h3 className="text-lg font-black text-white">Liberar Mesa {numeroMesa}</h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!liberandoMesa) setModalLiberarOpen(false)
                }}
                disabled={liberandoMesa}
                className="text-slate-400 hover:text-white text-xl leading-none font-bold"
              >
                ✕
              </button>
            </div>

            {/* Error al liberar */}
            {errorLiberar && (
              <div className="p-3 rounded-xl bg-rose-950 border border-rose-600 text-rose-200 text-xs font-semibold">
                {errorLiberar}
              </div>
            )}

            {/* Caso con consumo sin cobrar */}
            {subtotal > 0 ? (
              <div className="space-y-4">
                <div className="p-3.5 rounded-xl bg-amber-950/80 border border-amber-600/60 text-amber-200 text-xs sm:text-sm font-semibold flex items-start gap-2.5">
                  <span className="text-lg shrink-0">⚠️</span>
                  <div>
                    <p className="font-bold text-amber-100">
                      Esta mesa tiene consumo por {formatCOP(subtotal)} sin cobrar.
                    </p>
                    <p className="text-amber-300 text-xs mt-0.5">
                      Al liberarla se registra como <strong>NO COBRADA</strong>.
                    </p>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-2">
                    Motivo obligatorio *
                  </label>
                  <div className="grid grid-cols-1 gap-2">
                    {[
                      'Cliente se fue sin pagar',
                      'Error al tomar el pedido',
                      'Cortesía autorizada',
                      'Otro',
                    ].map((opcion) => (
                      <button
                        key={opcion}
                        type="button"
                        onClick={() => setOpcionMotivo(opcion)}
                        className={`px-3 py-2.5 rounded-xl text-xs font-bold text-left border transition-all ${
                          opcionMotivo === opcion
                            ? 'bg-rose-950/80 border-rose-500 text-rose-200 shadow-md'
                            : 'bg-slate-900/60 border-slate-700 text-slate-300 hover:border-slate-500'
                        }`}
                      >
                        <span className="mr-2">{opcionMotivo === opcion ? '🔘' : '⚪'}</span>
                        {opcion}
                      </button>
                    ))}
                  </div>

                  {opcionMotivo === 'Otro' && (
                    <div className="mt-3">
                      <input
                        type="text"
                        placeholder="Escribe el motivo detallado (mínimo 3 caracteres)..."
                        value={motivoTextoLibre}
                        onChange={(e) => setMotivoTextoLibre(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white placeholder-slate-500 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-rose-500 transition-all font-medium"
                      />
                    </div>
                  )}
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setModalLiberarOpen(false)}
                    disabled={liberandoMesa}
                    className="flex-1 min-h-[44px] py-2.5 px-4 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold text-xs sm:text-sm transition-all disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleLiberarMesa}
                    disabled={
                      liberandoMesa ||
                      (opcionMotivo === 'Otro' ? motivoTextoLibre.trim().length < 3 : opcionMotivo.length < 3)
                    }
                    className="flex-1 min-h-[44px] py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 active:scale-95 text-white font-bold text-xs sm:text-sm shadow-lg shadow-rose-950/50 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {liberandoMesa ? 'Liberando...' : 'Confirmar Liberación'}
                  </button>
                </div>
              </div>
            ) : (
              /* Caso sin consumo: confirmación simple */
              <div className="space-y-4">
                <p className="text-sm text-slate-300">
                  ¿Estás seguro de que deseas liberar la <strong>Mesa {numeroMesa}</strong>? La mesa quedará disponible de inmediato.
                </p>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setModalLiberarOpen(false)}
                    disabled={liberandoMesa}
                    className="flex-1 min-h-[44px] py-2.5 px-4 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold text-xs sm:text-sm transition-all disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleLiberarMesa}
                    disabled={liberandoMesa}
                    className="flex-1 min-h-[44px] py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 active:scale-95 text-white font-bold text-xs sm:text-sm shadow-lg shadow-rose-950/50 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {liberandoMesa ? 'Liberando...' : 'Liberar Mesa'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: CAMBIAR / MOVER PEDIDO A OTRA MESA (TAREA 3) */}
      {modalMoverMesaOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-slate-800 border border-slate-700 rounded-3xl shadow-2xl max-w-md w-full p-6 text-left flex flex-col gap-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-700">
              <div className="flex items-center gap-2">
                <span className="text-xl">🔄</span>
                <h3 className="text-lg font-black text-white">Mover a otra mesa</h3>
              </div>
              <button
                type="button"
                onClick={() => setModalMoverMesaOpen(false)}
                disabled={moviendoMesa}
                className="text-slate-400 hover:text-white text-xl font-bold p-1 leading-none disabled:opacity-50"
              >
                ✕
              </button>
            </div>

            <p className="text-xs sm:text-sm text-slate-300">
              Transfiere el pedido activo de la <strong>Mesa {numeroMesa}</strong> a una mesa que se encuentre libre.
            </p>

            {errorMoverMesa && (
              <div className="p-3 rounded-xl bg-red-950/80 border border-red-600/60 text-red-200 text-xs font-semibold flex items-center gap-2">
                <span>⚠️</span>
                <span>{errorMoverMesa}</span>
              </div>
            )}

            {cargandoMesasLibres ? (
              <div className="py-8 text-center text-slate-400 text-xs sm:text-sm">
                <div className="w-8 h-8 border-3 border-slate-700 border-t-blue-500 rounded-full animate-spin mx-auto mb-2" />
                Consultando mesas disponibles...
              </div>
            ) : mesasLibres.length === 0 ? (
              <div className="py-6 text-center text-slate-400 text-xs sm:text-sm bg-slate-900/60 rounded-2xl border border-slate-700/60 p-4">
                <span className="text-3xl block mb-2">🚫</span>
                <p className="font-bold text-slate-300">No hay mesas libres disponibles</p>
                <p className="text-slate-500 text-xs mt-1">
                  Todas las demás mesas están ocupadas actualmente. Libera o cobra otra mesa primero.
                </p>
              </div>
            ) : (
              <div>
                <label
                  htmlFor="select-mesa-destino"
                  className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2"
                >
                  Selecciona la nueva mesa libre:
                </label>
                <select
                  id="select-mesa-destino"
                  value={mesaDestinoId ?? ''}
                  onChange={(e) => setMesaDestinoId(Number(e.target.value))}
                  disabled={moviendoMesa}
                  className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white font-bold text-sm sm:text-base focus:outline-none focus:ring-2 focus:ring-sky-500 transition-all cursor-pointer disabled:opacity-50"
                >
                  {mesasLibres.map((m) => (
                    <option key={m.id} value={m.id}>
                      Mesa {m.numero} (Libre)
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex gap-3 pt-3">
              <button
                type="button"
                onClick={() => setModalMoverMesaOpen(false)}
                disabled={moviendoMesa}
                className="flex-1 min-h-[44px] py-2.5 px-4 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold text-xs sm:text-sm transition-all disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmarMoverMesa}
                disabled={moviendoMesa || cargandoMesasLibres || mesasLibres.length === 0 || !mesaDestinoId}
                className="flex-1 min-h-[44px] py-2.5 px-4 rounded-xl bg-sky-600 hover:bg-sky-500 active:scale-95 text-white font-bold text-xs sm:text-sm shadow-lg shadow-sky-600/30 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {moviendoMesa ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Moviendo...</span>
                  </>
                ) : (
                  <span>Confirmar Traslado</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: ANULAR ÍTEM DEL PEDIDO (TAREA 3) */}
      {modalAnularItemOpen && itemAAnular && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-slate-800 border border-slate-700 rounded-3xl shadow-2xl max-w-md w-full p-6 text-left flex flex-col gap-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-700">
              <div className="flex items-center gap-2">
                <span className="text-xl">🗑️</span>
                <h3 className="text-lg font-black text-white">Anular Producto</h3>
              </div>
              <button
                type="button"
                onClick={() => setModalAnularItemOpen(false)}
                disabled={anulandoItem}
                className="text-slate-400 hover:text-white text-xl font-bold p-1 leading-none disabled:opacity-50"
              >
                ✕
              </button>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-700 space-y-1">
              <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">
                Producto a anular
              </p>
              <p className="text-base font-black text-white">
                {itemAAnular.cantidad}x {itemAAnular.nombre}
              </p>
              <p className="text-xs text-slate-400 font-mono">
                Valor: {formatCOP(itemAAnular.cantidad * itemAAnular.precio)}
              </p>
            </div>

            {errorAnularItem && (
              <div className="p-3 rounded-xl bg-red-950/80 border border-red-600/60 text-red-200 text-xs font-semibold flex items-center gap-2">
                <span>⚠️</span>
                <span>{errorAnularItem}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-2">
                Motivo de anulación *
              </label>
              <div className="space-y-2">
                {[
                  'Error al digitar',
                  'Cliente canceló el pedido',
                  'Plato en mal estado / devuelto',
                  'Otro',
                ].map((mot) => (
                  <label
                    key={mot}
                    className={`flex items-center gap-3 p-3 rounded-xl border text-xs sm:text-sm font-semibold cursor-pointer transition-all ${
                      motivoAnulacion === mot
                        ? 'bg-rose-950/40 border-rose-600/60 text-white'
                        : 'bg-slate-900/60 border-slate-700 text-slate-300 hover:bg-slate-700/50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="motivo_anular_item"
                      value={mot}
                      checked={motivoAnulacion === mot}
                      onChange={(e) => setMotivoAnulacion(e.target.value)}
                      className="text-rose-600 focus:ring-rose-500"
                    />
                    <span>{mot}</span>
                  </label>
                ))}
              </div>

              {motivoAnulacion === 'Otro' && (
                <div className="mt-3">
                  <input
                    type="text"
                    required
                    placeholder="Especifica el motivo de la anulación..."
                    value={motivoAnulacionTextoLibre}
                    onChange={(e) => setMotivoAnulacionTextoLibre(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white placeholder-slate-500 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-rose-500 transition-all font-medium"
                  />
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-3">
              <button
                type="button"
                onClick={() => setModalAnularItemOpen(false)}
                disabled={anulandoItem}
                className="flex-1 min-h-[44px] py-2.5 px-4 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold text-xs sm:text-sm transition-all disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmarAnularItem}
                disabled={
                  anulandoItem ||
                  (motivoAnulacion === 'Otro' && !motivoAnulacionTextoLibre.trim())
                }
                className="flex-1 min-h-[44px] py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 active:scale-95 text-white font-bold text-xs sm:text-sm shadow-lg shadow-rose-950/50 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {anulandoItem ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Anulando...</span>
                  </>
                ) : (
                  <span>Confirmar Anulación</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ResumenMesa
