import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { buildTicketXML, buildCuentaXML, type CuentaItem } from '../lib/ticket'
import { sendPrintJob } from '../lib/printing'

export interface PedidoItemDetalle {
  id: number
  cantidad: number
  nota?: string | null
  impreso?: boolean
  producto_id?: number
  productos?: {
    nombre: string
  } | null
}

export interface PedidoCaja {
  id: number
  tipo?: 'ronda' | 'cuenta'
  solicitud_id?: number
  ronda_id?: number
  numero_ronda?: number
  mesa_id: number
  mesa_numero?: string | number
  fecha_apertura?: string
  estado?: string
  impreso: boolean
  items: PedidoItemDetalle[]
  mesero?: string
}

interface RawPedidoItemRow {
  id: number
  producto_id: number
  cantidad: number
  nota?: string | null
  impreso?: boolean
  ronda_id?: number | null
  productos?: {
    nombre: string
  } | null
}

interface RawPedidoQueryRow {
  id: number
  mesa_id: number
  estado: string
  fecha_apertura?: string
  usuario_id?: string
  mesas?: {
    numero: string | number
  } | null
  detalle_pedido?: RawPedidoItemRow[] | null
}

interface RondaJoinRow {
  id: number
  numero?: number
  mesero_nombre?: string | null
  pedido_id: number
  impreso?: boolean
  fecha?: string
  pedidos?: {
    id: number
    mesa_id: number
    fecha_apertura?: string
    estado?: string
    mesas?: {
      numero: string | number
    } | null
  } | null
}

export interface UseCajaRealtimeResult {
  pendientesImprimir: PedidoCaja[]
  pedidosRecientes: PedidoCaja[]
  reintentar: (id: number) => Promise<boolean>
  reimprimir: (id: number) => Promise<boolean>
  loading: boolean
}

interface UntypedQueryBuilder<T = unknown> {
  select(columns?: string): UntypedQueryBuilder<T>
  update(values: Record<string, unknown>): UntypedQueryBuilder<T>
  eq(column: string, value: unknown): UntypedQueryBuilder<T>
  in(column: string, values: unknown[]): UntypedQueryBuilder<T>
  order(column: string, options?: { ascending?: boolean }): UntypedQueryBuilder<T>
  limit(count: number): UntypedQueryBuilder<T>
  maybeSingle(): Promise<{ data: T | null; error: Error | null }>
  then<TResult1 = { data: T[] | null; error: Error | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: T[] | null; error: Error | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2>
}

interface UntypedSupabase {
  from<T = unknown>(table: string): UntypedQueryBuilder<T>
}

const db = supabase as unknown as UntypedSupabase

export function useCajaRealtime(): UseCajaRealtimeResult {
  const [pendientesImprimir, setPendientesImprimir] = useState<PedidoCaja[]>([])
  const [pedidosRecientes, setPedidosRecientes] = useState<PedidoCaja[]>([])
  const [loading, setLoading] = useState<boolean>(true)

  const isMountedRef = useRef<boolean>(true)

  /**
   * Único camino para imprimir una ronda.
   * Reclamo atómico: UPDATE detalle_pedido SET impreso = true WHERE ronda_id = rondaId AND impreso = false encadenado con .select()
   */
  const claimAndPrint = useCallback(async (rondaId: number): Promise<boolean> => {
    // 1. Reclamo atómico en detalle_pedido
    const { data: filasAfectadas, error: updateError } = await db
      .from<RawPedidoItemRow>('detalle_pedido')
      .update({ impreso: true })
      .eq('ronda_id', rondaId)
      .eq('impreso', false)
      .select('id, producto_id, cantidad, nota, impreso, productos(nombre)')

    if (updateError) {
      console.error(`Error al reclamar ronda #${rondaId} en detalle_pedido:`, updateError)
      return false
    }

    // Si no devuelve filas (ya reclamada por otro proceso o ya impresa), termina sin hacer nada
    if (!filasAfectadas || filasAfectadas.length === 0) {
      return false
    }

    const items: PedidoItemDetalle[] = filasAfectadas.map((it) => ({
      id: it.id,
      producto_id: it.producto_id,
      cantidad: it.cantidad,
      nota: it.nota,
      impreso: true,
      productos: it.productos,
    }))

    // 2. Consulta metadatos con JOIN para traer información de la ronda (numero, mesero_nombre) además del pedido_id y la mesa
    const { data: rondaData, error: rondaError } = await db
      .from<RondaJoinRow>('rondas')
      .select(
        'id, numero, mesero_nombre, pedido_id, fecha, pedidos(id, mesa_id, fecha_apertura, estado, mesas(numero))'
      )
      .eq('id', rondaId)
      .maybeSingle()

    if (rondaError) {
      console.warn(`Aviso al consultar metadatos de ronda #${rondaId}:`, rondaError)
    }

    const rondaInfo = rondaData || null
    const pedidoId = rondaInfo?.pedido_id ?? 0
    const numeroRonda = rondaInfo?.numero ?? 0
    const meseroNombre = rondaInfo?.mesero_nombre ?? null

    let mesaNumero: string | number =
      rondaInfo?.pedidos?.mesas?.numero ?? rondaInfo?.pedidos?.mesa_id ?? pedidoId
    let fechaApertura: string | undefined =
      rondaInfo?.pedidos?.fecha_apertura ?? rondaInfo?.fecha
    let mesaId: number = rondaInfo?.pedidos?.mesa_id ?? 1
    let estado: string = rondaInfo?.pedidos?.estado ?? 'abierto'

    // Respaldo directo a pedidos si el JOIN anidado vino vacío
    if (!rondaInfo?.pedidos && pedidoId) {
      const { data: pData } = await supabase
        .from('pedidos')
        .select('id, mesa_id, fecha_apertura, estado, mesas(numero)')
        .eq('id', pedidoId)
        .maybeSingle()

      if (pData) {
        const rawP = pData as unknown as RawPedidoQueryRow
        mesaNumero = rawP.mesas?.numero ?? rawP.mesa_id
        fechaApertura = rawP.fecha_apertura
        mesaId = rawP.mesa_id
        estado = rawP.estado
      }
    }

    // 3. Arma el ticket con buildTicketXML pasando ronda_numero y mesero_nombre
    const xml = buildTicketXML(
      { id: pedidoId, fecha_apertura: fechaApertura },
      items,
      mesaNumero,
      numeroRonda,
      meseroNombre
    )

    // 4. Intenta enviar a la impresora
    let exito: boolean
    try {
      exito = await sendPrintJob(xml)
    } catch (err) {
      console.error(`Error al enviar trabajo a la impresora para ronda #${rondaId}:`, err)
      exito = false
    }

    // 5. Si falla: revierte detalle_pedido a impreso = false para esas mismas filas y agrega a pendientesImprimir
    if (!exito) {
      const idsRevertir = filasAfectadas.map((it) => it.id)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('detalle_pedido') as any)
        .update({ impreso: false })
        .in('id', idsRevertir)

      const pedidoPendiente: PedidoCaja = {
        id: pedidoId,
        ronda_id: rondaId,
        numero_ronda: numeroRonda,
        mesa_id: mesaId,
        mesa_numero: mesaNumero,
        fecha_apertura: fechaApertura,
        estado,
        impreso: false,
        items: items.map((it) => ({ ...it, impreso: false })),
        mesero: meseroNombre ?? undefined,
      }

      if (isMountedRef.current) {
        setPendientesImprimir((prev) => {
          if (prev.some((p) => p.ronda_id === rondaId)) {
            return prev.map((p) => (p.ronda_id === rondaId ? pedidoPendiente : p))
          }
          return [pedidoPendiente, ...prev]
        })

        setPedidosRecientes((prev) => {
          if (prev.some((p) => p.ronda_id === rondaId)) {
            return prev.map((p) => (p.ronda_id === rondaId ? { ...p, impreso: false } : p))
          }
          return [pedidoPendiente, ...prev]
        })
      }

      return false
    }

    // 6. Si tiene éxito: marcar también rondas.impreso = true y actualizar estados locales
    await db
      .from('rondas')
      .update({ impreso: true })
      .eq('id', rondaId)

    if (isMountedRef.current) {
      setPendientesImprimir((prev) => prev.filter((p) => p.ronda_id !== rondaId))

      setPedidosRecientes((prev) => {
        const index = prev.findIndex((p) => p.ronda_id === rondaId)
        const itemActualizado: PedidoCaja = {
          id: pedidoId,
          tipo: 'ronda',
          ronda_id: rondaId,
          numero_ronda: numeroRonda,
          mesa_id: mesaId,
          mesa_numero: mesaNumero,
          fecha_apertura: fechaApertura,
          estado,
          impreso: true,
          items,
          mesero: meseroNombre ?? undefined,
        }
        if (index >= 0) {
          const copy = [...prev]
          copy[index] = itemActualizado
          return copy
        }
        return [itemActualizado, ...prev]
      })
    }

    return true
  }, [])

  /**
   * Reclamo atómico e impresión para solicitudes de cuenta.
   * UPDATE solicitudes_cuenta SET impreso = true WHERE id = solicitudId AND impreso = false con .select()
   */
  const claimAndPrintCuenta = useCallback(async (solicitudId: number): Promise<boolean> => {
    // 1. Reclamo atómico en solicitudes_cuenta
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: filasAfectadas, error: updateError } = await (supabase.from('solicitudes_cuenta') as any)
      .update({ impreso: true })
      .eq('id', solicitudId)
      .eq('impreso', false)
      .select('id, pedido_id, impreso, fecha')

    if (updateError) {
      console.error(`Error al reclamar solicitud_cuenta #${solicitudId}:`, updateError)
      return false
    }

    // Si no devuelve filas (ya reclamada o ya impresa), termina
    if (!filasAfectadas || filasAfectadas.length === 0) {
      return false
    }

    const solicitud = filasAfectadas[0] as {
      id: number
      pedido_id: number
      impreso: boolean
      fecha?: string
    }
    const pedidoId = solicitud.pedido_id

    // 2. Consulta el pedido y la mesa
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: pedidoData, error: pedidoError } = await (supabase.from('pedidos') as any)
      .select('id, mesa_id, fecha_apertura, estado, mesas(id, numero)')
      .eq('id', pedidoId)
      .maybeSingle()

    if (pedidoError) {
      console.warn(`Aviso al consultar pedido #${pedidoId} para cuenta:`, pedidoError)
    }

    // 3. Consulta los detalles del pedido con productos(nombre, precio)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: detallesData, error: detallesError } = await (supabase.from('detalle_pedido') as any)
      .select('id, producto_id, cantidad, nota, precio_unitario, productos(id, nombre, precio)')
      .eq('pedido_id', pedidoId)

    if (detallesError) {
      console.warn(`Aviso al consultar detalles de pedido #${pedidoId} para cuenta:`, detallesError)
    }

    // 4. Consulta el mesero de la primera ronda del pedido
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: primeraRonda } = await (supabase.from('rondas') as any)
      .select('mesero_nombre')
      .eq('pedido_id', pedidoId)
      .order('id', { ascending: true })
      .limit(1)
      .maybeSingle()

    const meseroNombre = primeraRonda?.mesero_nombre ?? null

    const mesaNumero = pedidoData?.mesas?.numero ?? pedidoData?.mesa_id ?? pedidoId
    const mesaId = Number(pedidoData?.mesa_id ?? 1)
    const fechaApertura = pedidoData?.fecha_apertura ?? solicitud.fecha

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const itemsParaCuenta: CuentaItem[] = (detallesData || []).map((it: any) => ({
      id: it.id,
      producto_id: it.producto_id,
      cantidad: it.cantidad,
      nota: it.nota,
      precio_unitario: it.precio_unitario,
      productos: it.productos,
    }))

    // 5. Arma el XML con buildCuentaXML
    const xml = buildCuentaXML(
      { id: pedidoId, fecha_apertura: fechaApertura },
      itemsParaCuenta,
      mesaNumero,
      meseroNombre
    )

    // 6. Llama sendPrintJob
    let exito: boolean
    try {
      exito = await sendPrintJob(xml)
    } catch (err) {
      console.error(`Error al imprimir cuenta #${solicitudId} (pedido #${pedidoId}):`, err)
      exito = false
    }

    // 7. Si falla: revierte impreso = false y agrégala a pendientesImprimir marcada como tipo 'cuenta'
    if (!exito) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('solicitudes_cuenta') as any)
        .update({ impreso: false })
        .eq('id', solicitudId)

      const itemsCaja: PedidoItemDetalle[] = itemsParaCuenta.map((it) => ({
        id: it.id ?? 0,
        producto_id: Number(it.producto_id ?? 0),
        cantidad: it.cantidad,
        nota: (it as any).nota ?? null,
        impreso: false,
        productos: it.productos?.nombre ? { nombre: it.productos.nombre } : null,
      }))

      const cuentaPendiente: PedidoCaja = {
        id: pedidoId,
        tipo: 'cuenta',
        solicitud_id: solicitudId,
        mesa_id: mesaId,
        mesa_numero: mesaNumero,
        fecha_apertura: fechaApertura,
        estado: pedidoData?.estado ?? 'abierto',
        impreso: false,
        items: itemsCaja,
        mesero: meseroNombre ?? undefined,
      }

      if (isMountedRef.current) {
        setPendientesImprimir((prev) => {
          if (prev.some((p) => p.tipo === 'cuenta' && p.solicitud_id === solicitudId)) {
            return prev.map((p) =>
              p.tipo === 'cuenta' && p.solicitud_id === solicitudId ? cuentaPendiente : p
            )
          }
          return [cuentaPendiente, ...prev]
        })
      }

      return false
    }

    // 8. Si tiene éxito: remover de pendientesImprimir si estaba encolada
    if (isMountedRef.current) {
      setPendientesImprimir((prev) =>
        prev.filter((p) => !(p.tipo === 'cuenta' && p.solicitud_id === solicitudId))
      )
    }

    return true
  }, [])

  // fetchPendientes(): busca rondas que tengan ítems en detalle_pedido con impreso = false
  // y solicitudes_cuenta con impreso = false de los últimos 10 minutos
  const fetchPendientes = useCallback(async () => {
    try {
      // 1. Rondas pendientes
      const { data, error } = await db
        .from<RondaJoinRow>('rondas')
        .select('id, detalle_pedido!inner(id)')
        .eq('detalle_pedido.impreso', false)

      if (error) {
        console.warn('Error al consultar rondas pendientes en sondeo:', error.message)
      } else {
        const rondas = data || []
        if (rondas.length > 0) {
          const idsUnicos = Array.from(new Set(rondas.map((r) => r.id)))
          for (const id of idsUnicos) {
            if (!isMountedRef.current) break
            await claimAndPrint(id)
          }
        }
      }

      // 2. Solicitudes de cuenta pendientes (SOLO últimos 10 minutos)
      const diezMinutosAtras = new Date(Date.now() - 10 * 60 * 1000).toISOString()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: solData, error: solError } = await (supabase.from('solicitudes_cuenta') as any)
        .select('id')
        .eq('impreso', false)
        .gte('fecha', diezMinutosAtras)
        .order('id', { ascending: true })

      if (solError) {
        console.warn('Error al consultar solicitudes_cuenta pendientes en sondeo:', solError.message)
      } else {
        const solicitudes = (solData || []) as Array<{ id: number }>
        if (solicitudes.length > 0) {
          for (const sol of solicitudes) {
            if (!isMountedRef.current) break
            await claimAndPrintCuenta(sol.id)
          }
        }
      }
    } catch (err) {
      console.error('Error en sondeo fetchPendientes:', err)
    }
  }, [claimAndPrint, claimAndPrintCuenta])

  // Reintentar impresión de una ronda o cuenta pendiente
  const reintentar = useCallback(
    async (id: number): Promise<boolean> => {
      const pend = pendientesImprimir.find(
        (p) => p.id === id || p.ronda_id === id || p.solicitud_id === id
      )
      if (pend?.tipo === 'cuenta') {
        const targetSolicitudId = pend.solicitud_id ?? pend.id
        return claimAndPrintCuenta(targetSolicitudId)
      }
      const targetRondaId = pend?.ronda_id ?? id
      return claimAndPrint(targetRondaId)
    },
    [pendientesImprimir, claimAndPrint, claimAndPrintCuenta]
  )

  // Reimprimir cualquier ronda (desmarca detalle_pedido para imprimir de nuevo a través de claimAndPrint)
  const reimprimir = useCallback(
    async (id: number): Promise<boolean> => {
      let targetRondaId = id
      const encontrado = pedidosRecientes.find((p) => p.id === id || p.ronda_id === id)
      if (encontrado?.ronda_id) {
        targetRondaId = encontrado.ronda_id
      } else {
        try {
          const { data: rondaData } = await db
            .from<RondaJoinRow>('rondas')
            .select('id')
            .eq('pedido_id', id)
            .order('id', { ascending: false })
            .limit(1)
            .maybeSingle()

          if (rondaData?.id) {
            targetRondaId = rondaData.id
          }
        } catch {
          // Fallback a id directo
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('detalle_pedido') as any)
        .update({ impreso: false })
        .eq('ronda_id', targetRondaId)

      return claimAndPrint(targetRondaId)
    },
    [pedidosRecientes, claimAndPrint]
  )

  // Carga inicial de últimos pedidos/rondas para la pantalla de caja
  const cargarPedidosIniciales = useCallback(async () => {
    try {
      // 1. Cargar las últimas rondas con información completa
      const { data: rondasData, error: rondasError } = await db
        .from<RondaJoinRow & { detalle_pedido?: RawPedidoItemRow[] }>('rondas')
        .select(
          'id, numero, mesero_nombre, fecha, pedido_id, impreso, pedidos(id, mesa_id, fecha_apertura, estado, mesas(numero)), detalle_pedido(id, producto_id, cantidad, nota, impreso, productos(nombre))'
        )
        .order('id', { ascending: false })
        .limit(20)

      if (!rondasError && rondasData && rondasData.length > 0) {
        const mapped: PedidoCaja[] = rondasData.map((row) => {
          const itemsList: PedidoItemDetalle[] = (row.detalle_pedido || []).map((it) => ({
            id: it.id,
            producto_id: it.producto_id,
            cantidad: it.cantidad,
            nota: it.nota,
            impreso: it.impreso,
            productos: it.productos,
          }))

          const todosImpresos =
            itemsList.length > 0 && itemsList.every((item) => item.impreso === true)

          return {
            id: row.pedido_id,
            ronda_id: row.id,
            numero_ronda: row.numero,
            mesa_id: Number(row.pedidos?.mesa_id ?? 1),
            mesa_numero: row.pedidos?.mesas?.numero ?? row.pedidos?.mesa_id ?? row.pedido_id,
            fecha_apertura: row.fecha ?? row.pedidos?.fecha_apertura,
            estado: row.pedidos?.estado ?? 'abierto',
            impreso: todosImpresos,
            items: itemsList,
            mesero: row.mesero_nombre ?? undefined,
          }
        })

        if (isMountedRef.current) {
          setPedidosRecientes(mapped)
          const pendientes = mapped.filter((p) => !p.impreso)
          setPendientesImprimir(pendientes)
        }
        return
      }

      // 2. Fallback a pedidos en caso de no haber registros en rondas
      const { data, error } = await supabase
        .from('pedidos')
        .select(
          'id, mesa_id, estado, fecha_apertura, mesas(numero), detalle_pedido(id, producto_id, cantidad, nota, impreso, productos(nombre))'
        )
        .order('id', { ascending: false })
        .limit(20)

      if (error) {
        console.warn('Error al cargar pedidos iniciales en Caja:', error.message)
        return
      }

      if (isMountedRef.current && data) {
        const rawList = data as unknown as RawPedidoQueryRow[]
        const mapped: PedidoCaja[] = rawList.map((row) => {
          const itemsList: PedidoItemDetalle[] = (row.detalle_pedido || []).map((it) => ({
            id: it.id,
            producto_id: it.producto_id,
            cantidad: it.cantidad,
            nota: it.nota,
            impreso: it.impreso,
            productos: it.productos,
          }))

          const todosImpresos =
            itemsList.length > 0 && itemsList.every((item) => item.impreso === true)

          return {
            id: row.id,
            mesa_id: row.mesa_id,
            mesa_numero: row.mesas?.numero ?? row.mesa_id,
            fecha_apertura: row.fecha_apertura,
            estado: row.estado,
            impreso: todosImpresos,
            items: itemsList,
          }
        })

        setPedidosRecientes(mapped)
        const pendientes = mapped.filter((p) => !p.impreso)
        setPendientesImprimir(pendientes)
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    isMountedRef.current = true

    // Carga inicial del registro para la UI
    void cargarPedidosIniciales()

    // Ejecuta fetchPendientes() una vez al montar el componente
    void fetchPendientes()

    // Configura un setInterval que llame a fetchPendientes() cada 15000 ms
    const intervalId = setInterval(() => {
      void fetchPendientes()
    }, 15000)

    // Suscripción Realtime: escuchar eventos INSERT en rondas y solicitudes_cuenta
    const channel = supabase
      .channel('caja-rondas-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'rondas' },
        (payload) => {
          const nuevaRonda = payload.new as { id?: number }

          if (nuevaRonda?.id) {
            void claimAndPrint(nuevaRonda.id)
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'solicitudes_cuenta' },
        (payload) => {
          const nuevaSolicitud = payload.new as { id?: number }

          if (nuevaSolicitud?.id) {
            void claimAndPrintCuenta(nuevaSolicitud.id)
          }
        }
      )
      .subscribe()

    // Limpieza con clearInterval y supabase.removeChannel()
    return () => {
      isMountedRef.current = false
      clearInterval(intervalId)
      void supabase.removeChannel(channel)
    }
  }, [cargarPedidosIniciales, fetchPendientes, claimAndPrint, claimAndPrintCuenta])

  return {
    pendientesImprimir,
    pedidosRecientes,
    reintentar,
    reimprimir,
    loading,
  }
}
