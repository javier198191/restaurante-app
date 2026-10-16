import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import type { Insumo, Producto, Categoria } from '../types/database'

// Cliente Supabase flexible para operaciones de inventario
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

interface RecetaItem {
  id: number
  producto_id: number
  insumo_id: number
  cantidad: number
  insumos?: Insumo | null
}

interface MovimientoItem {
  id: number
  insumo_id: number
  tipo: 'entrada' | 'merma' | 'consumo' | 'ajuste_positivo' | 'ajuste_negativo' | string
  cantidad: number
  motivo?: string | null
  pedido_id?: number | null
  fecha?: string
  insumos?: {
    nombre: string
    unidad: string
    costo_unitario?: number
  } | null
}

interface FilaRecetaModal {
  insumo_id: number | string
  cantidad: number | string
}

type TabType = 'insumos' | 'carta-recetas' | 'auditoria'
type TipoMovimiento = 'entrada' | 'merma' | 'ajuste_positivo' | 'ajuste_negativo'

const UNIDADES_DISPONIBLES = ['porcion', 'und', 'g', 'kg', 'ml', 'l']

function formatPrice(precio: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(precio)
}

function formatCantidad(cantidad: number, unidad?: string): string {
  const numStr = Number(cantidad).toLocaleString('es-CO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
  return unidad ? `${numStr} ${unidad}` : numStr
}

function formatFecha(fechaStr?: string): string {
  if (!fechaStr) return '-'
  try {
    const d = new Date(fechaStr)
    return d.toLocaleString('es-CO', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return fechaStr
  }
}

export const Inventario: React.FC = () => {
  const { role } = useAuth()
  const isAdmin = role === 'admin'

  const [activeTab, setActiveTab] = useState<TabType>('insumos')

  // Datos principales
  const [insumos, setInsumos] = useState<Insumo[]>([])
  const [productos, setProductos] = useState<Producto[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [todasLasRecetas, setTodasLasRecetas] = useState<RecetaItem[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [notification, setNotification] = useState<{
    type: 'success' | 'error' | 'info'
    message: string
  } | null>(null)

  // ==========================================
  // ESTADOS - PESTAÑA 1: INSUMOS Y STOCK
  // ==========================================
  const [busquedaInsumo, setBusquedaInsumo] = useState<string>('')
  const [filtroStock, setFiltroStock] = useState<'todos' | 'alerta' | 'negativos' | 'inactivos'>('todos')

  // Modal Crear / Editar Insumo
  const [modalInsumoAbierto, setModalInsumoAbierto] = useState<boolean>(false)
  const [insumoEditando, setInsumoEditando] = useState<Insumo | null>(null)
  const [formNombre, setFormNombre] = useState<string>('')
  const [formUnidad, setFormUnidad] = useState<string>('porcion')
  const [formStockMinimo, setFormStockMinimo] = useState<string>('5')
  const [formCostoUnitario, setFormCostoUnitario] = useState<string>('0')
  const [formStockInicial, setFormStockInicial] = useState<string>('0')
  const [formActivo, setFormActivo] = useState<boolean>(true)
  const [guardandoInsumo, setGuardandoInsumo] = useState<boolean>(false)

  // Modal Rápido de Movimiento (+ Entrada / - Merma / Ajuste)
  const [modalMovimientoAbierto, setModalMovimientoAbierto] = useState<boolean>(false)
  const [insumoSeleccionadoMov, setInsumoSeleccionadoMov] = useState<Insumo | null>(null)
  const [movTipo, setMovTipo] = useState<TipoMovimiento>('entrada')
  const [movCantidad, setMovCantidad] = useState<string>('1')
  const [movMotivo, setMovMotivo] = useState<string>('')
  const [guardandoMovimiento, setGuardandoMovimiento] = useState<boolean>(false)

  // ==========================================
  // ESTADOS - PESTAÑA 2: CARTA Y RECETAS
  // ==========================================
  const [busquedaPlato, setBusquedaPlato] = useState<string>('')
  const [filtroCategoriaPlato, setFiltroCategoriaPlato] = useState<string>('todas')
  const [filtroEstadoPlato, setFiltroEstadoPlato] = useState<'todos' | 'disponibles' | 'agotados'>('todos')

  // Modal Crear / Editar Plato y su Receta
  const [modalPlatoAbierto, setModalPlatoAbierto] = useState<boolean>(false)
  const [platoEditando, setPlatoEditando] = useState<Producto | null>(null)
  const [formPlatoNombre, setFormPlatoNombre] = useState<string>('')
  const [formPlatoCategoriaId, setFormPlatoCategoriaId] = useState<string>('')
  const [formPlatoPrecio, setFormPlatoPrecio] = useState<string>('')
  const [formPlatoDisponible, setFormPlatoDisponible] = useState<boolean>(true)
  const [formFilasReceta, setFormFilasReceta] = useState<FilaRecetaModal[]>([])
  const [guardando, setGuardando] = useState<boolean>(false)
  const guardandoPlato = guardando
  const setGuardandoPlato = setGuardando

  // Sub-formulario: Crear Nueva Categoría al instante
  const [mostrarCrearCategoria, setMostrarCrearCategoria] = useState<boolean>(false)
  const [nuevaCatNombre, setNuevaCatNombre] = useState<string>('')
  const [guardandoCategoria, setGuardandoCategoria] = useState<boolean>(false)

  // ==========================================
  // ESTADOS - PESTAÑA 3: AUDITORÍA Y MERMAS
  // ==========================================
  const [movimientos, setMovimientos] = useState<MovimientoItem[]>([])
  const [cargandoMovimientos, setCargandoMovimientos] = useState<boolean>(false)
  const [filtroTipoAuditoria, setFiltroTipoAuditoria] = useState<string>('todos')
  const [busquedaAuditoria, setBusquedaAuditoria] = useState<string>('')

  // ==========================================
  // CARGA DE DATOS
  // ==========================================
  const cargarInsumos = useCallback(async () => {
    try {
      const { data, error } = await db
        .from('insumos')
        .select('*')
        .order('nombre')

      if (error) throw error
      setInsumos((data as Insumo[]) || [])
    } catch (err: unknown) {
      console.error('Error al cargar insumos:', err)
      const msg = err instanceof Error ? err.message : String(err)
      setNotification({ type: 'error', message: `No se pudieron cargar insumos: ${msg}` })
    }
  }, [])

  const cargarCategorias = useCallback(async () => {
    try {
      const { data, error } = await db
        .from('categorias')
        .select('*')
        .order('nombre')

      if (error) throw error
      setCategorias((data as Categoria[]) || [])
    } catch (err: unknown) {
      console.error('Error al cargar categorias:', err)
    }
  }, [])

  const cargarProductos = useCallback(async () => {
    try {
      const { data, error } = await db
        .from('productos')
        .select('id, nombre, precio, categoria_id, disponible, categorias(id, nombre)')
        .order('nombre')

      if (error) throw error
      setProductos((data as Producto[]) || [])
    } catch (err: unknown) {
      console.error('Error al cargar productos:', err)
    }
  }, [])

  const cargarTodasLasRecetas = useCallback(async () => {
    try {
      const { data, error } = await db
        .from('receta')
        .select('id, producto_id, insumo_id, cantidad, insumos(*)')

      if (error) throw error
      setTodasLasRecetas((data as RecetaItem[]) || [])
    } catch (err: unknown) {
      console.error('Error al cargar recetas:', err)
    }
  }, [])

  const cargarMovimientos = useCallback(async () => {
    setCargandoMovimientos(true)
    try {
      const { data, error } = await db
        .from('movimientos_inventario')
        .select('id, insumo_id, tipo, cantidad, motivo, pedido_id, fecha, insumos(nombre, unidad, costo_unitario)')
        .order('fecha', { ascending: false })
        .limit(200)

      if (error) throw error
      setMovimientos((data as MovimientoItem[]) || [])
    } catch (err: unknown) {
      console.error('Error al cargar movimientos:', err)
      const msg = err instanceof Error ? err.message : String(err)
      setNotification({ type: 'error', message: `No se pudieron cargar movimientos: ${msg}` })
    } finally {
      setCargandoMovimientos(false)
    }
  }, [])

  useEffect(() => {
    const init = async () => {
      setLoading(true)
      await Promise.all([
        cargarInsumos(),
        cargarCategorias(),
        cargarProductos(),
        cargarTodasLasRecetas(),
      ])
      setLoading(false)
    }
    void init()
  }, [cargarInsumos, cargarCategorias, cargarProductos, cargarTodasLasRecetas])

  useEffect(() => {
    if (activeTab === 'auditoria') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void cargarMovimientos()
    }
  }, [activeTab, cargarMovimientos])

  // ==========================================
  // MAPAS Y CÁLCULOS REACTIVOS (RECETAS POR PLATO)
  // ==========================================
  const insumosMap = useMemo(() => {
    const map = new Map<number, Insumo>()
    insumos.forEach((i) => map.set(i.id, i))
    return map
  }, [insumos])

  const insumosActivos = useMemo(() => insumos.filter((i) => i.activo), [insumos])

  // Agrupación de recetas por producto_id para visualización inmediata en tarjetas
  const recetasPorProducto = useMemo(() => {
    const map = new Map<number, RecetaItem[]>()
    todasLasRecetas.forEach((r) => {
      const list = map.get(r.producto_id) || []
      list.push(r)
      map.set(r.producto_id, list)
    })
    return map
  }, [todasLasRecetas])

  // ==========================================
  // CÁLCULOS Y RESÚMENES (PESTAÑA 1: INSUMOS)
  // ==========================================
  const insumosEnAlerta = useMemo(
    () => insumosActivos.filter((i) => Number(i.stock_actual) <= Number(i.stock_minimo)),
    [insumosActivos]
  )
  const insumosEnNegativo = useMemo(
    () => insumosActivos.filter((i) => Number(i.stock_actual) < 0),
    [insumosActivos]
  )
  const valorTotalInventario = useMemo(
    () =>
      insumosActivos.reduce(
        (acc, item) => acc + Math.max(0, Number(item.stock_actual)) * Number(item.costo_unitario || 0),
        0
      ),
    [insumosActivos]
  )

  const insumosFiltrados = useMemo(() => {
    return insumos.filter((item) => {
      if (busquedaInsumo.trim() !== '') {
        const query = busquedaInsumo.toLowerCase().trim()
        if (!item.nombre.toLowerCase().includes(query)) return false
      }
      if (filtroStock === 'alerta') {
        return item.activo && Number(item.stock_actual) <= Number(item.stock_minimo)
      }
      if (filtroStock === 'negativos') {
        return item.activo && Number(item.stock_actual) < 0
      }
      if (filtroStock === 'inactivos') {
        return !item.activo
      }
      return item.activo
    })
  }, [insumos, busquedaInsumo, filtroStock])

  // ==========================================
  // HANDLERS - INSUMOS (CREAR / EDITAR / INACTIVAR)
  // ==========================================
  const abrirModalCrearInsumo = () => {
    setInsumoEditando(null)
    setFormNombre('')
    setFormUnidad('porcion')
    setFormStockMinimo('5')
    setFormCostoUnitario('0')
    setFormStockInicial('0')
    setFormActivo(true)
    setModalInsumoAbierto(true)
  }

  const abrirModalEditarInsumo = (insumo: Insumo) => {
    setInsumoEditando(insumo)
    setFormNombre(insumo.nombre)
    setFormUnidad(insumo.unidad)
    setFormStockMinimo(String(insumo.stock_minimo))
    setFormCostoUnitario(String(insumo.costo_unitario))
    setFormStockInicial(String(insumo.stock_actual))
    setFormActivo(insumo.activo)
    setModalInsumoAbierto(true)
  }

  const handleGuardarInsumo = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formNombre.trim()) {
      setNotification({ type: 'error', message: 'El nombre del insumo es obligatorio.' })
      return
    }

    setGuardandoInsumo(true)
    setNotification(null)

    try {
      const payload = {
        nombre: formNombre.trim(),
        unidad: formUnidad,
        stock_minimo: Number(formStockMinimo) || 0,
        costo_unitario: Number(formCostoUnitario) || 0,
        activo: formActivo,
      }

      if (insumoEditando) {
        const { error } = await db
          .from('insumos')
          .update(payload)
          .eq('id', insumoEditando.id)

        if (error) throw error
        setNotification({ type: 'success', message: `Insumo "${payload.nombre}" actualizado correctamente.` })
      } else {
        const { error } = await db.from('insumos').insert({
          ...payload,
          stock_actual: Number(formStockInicial) || 0,
        })

        if (error) throw error
        setNotification({ type: 'success', message: `Insumo "${payload.nombre}" creado exitosamente.` })
      }

      setModalInsumoAbierto(false)
      await cargarInsumos()
    } catch (err: unknown) {
      console.error('Error al guardar insumo:', err)
      const msg = err instanceof Error ? err.message : String(err)
      setNotification({ type: 'error', message: `Error al guardar insumo: ${msg}` })
    } finally {
      setGuardandoInsumo(false)
    }
  }

  const handleToggleActivoInsumo = async (insumo: Insumo) => {
    const nuevoEstado = !insumo.activo
    const accion = nuevoEstado ? 'reactivar' : 'inactivar'
    if (!confirm(`¿Estás seguro de que deseas ${accion} el insumo "${insumo.nombre}"?`)) {
      return
    }

    try {
      // Borrado lógico, NUNCA DELETE
      const { error } = await db
        .from('insumos')
        .update({ activo: nuevoEstado })
        .eq('id', insumo.id)

      if (error) throw error

      setNotification({
        type: 'success',
        message: `Insumo "${insumo.nombre}" ${nuevoEstado ? 'activado' : 'inactivado'} correctamente.`,
      })
      await cargarInsumos()
    } catch (err: unknown) {
      console.error('Error al cambiar estado de insumo:', err)
      const msg = err instanceof Error ? err.message : String(err)
      setNotification({ type: 'error', message: `No se pudo cambiar estado: ${msg}` })
    }
  }

  // ==========================================
  // HANDLERS - MOVIMIENTOS RÁPIDOS (+ / -)
  // ==========================================
  const abrirModalMovimiento = (insumo: Insumo, tipoInicial: TipoMovimiento) => {
    setInsumoSeleccionadoMov(insumo)
    setMovTipo(tipoInicial)
    setMovCantidad('1')
    setMovMotivo(tipoInicial === 'entrada' ? 'Compra mercado' : tipoInicial === 'merma' ? 'Producto dañado' : '')
    setModalMovimientoAbierto(true)
  }

  const handleRegistrarMovimiento = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!insumoSeleccionadoMov) return

    const cantNum = Number(movCantidad)
    if (isNaN(cantNum) || cantNum <= 0) {
      setNotification({ type: 'error', message: 'La cantidad debe ser un número mayor a 0 (ej. 0.5 o 1).' })
      return
    }

    if (!movMotivo.trim()) {
      setNotification({ type: 'error', message: 'El motivo del movimiento es obligatorio.' })
      return
    }

    setGuardandoMovimiento(true)
    setNotification(null)

    try {
      const { error } = await db.rpc('registrar_movimiento_inventario', {
        p_insumo_id: insumoSeleccionadoMov.id,
        p_tipo: movTipo,
        p_cantidad: cantNum,
        p_motivo: movMotivo.trim(),
      })

      if (error) throw error

      setNotification({
        type: 'success',
        message: `✅ Movimiento de ${movTipo} registrado: ${cantNum} ${insumoSeleccionadoMov.unidad} en "${insumoSeleccionadoMov.nombre}".`,
      })

      setModalMovimientoAbierto(false)
      await cargarInsumos()
    } catch (err: unknown) {
      console.error('Error al registrar movimiento:', err)
      const msg = err instanceof Error ? err.message : String(err)
      setNotification({ type: 'error', message: `Error al registrar movimiento: ${msg}` })
    } finally {
      setGuardandoMovimiento(false)
    }
  }

  const sumarCantidadRapida = (valor: number) => {
    const actual = Number(movCantidad) || 0
    const nueva = actual + valor
    setMovCantidad(nueva.toFixed(nueva % 1 === 0 ? 0 : 2))
  }

  // ==========================================
  // HANDLERS - PESTAÑA 2: CARTA Y RECETAS
  // ==========================================
  // 1. Switch rápido Activar / Desactivar Plato (disponible para admin y cajero)
  const handleToggleDisponiblePlato = async (prod: Producto) => {
    const nuevoEstado = !prod.disponible
    // Actualización optimista instantánea
    setProductos((prev) =>
      prev.map((p) => (p.id === prod.id ? { ...p, disponible: nuevoEstado } : p))
    )

    try {
      // NUNCA DELETE en productos
      const { error } = await db
        .from('productos')
        .update({ disponible: nuevoEstado })
        .eq('id', prod.id)

      if (error) throw error

      setNotification({
        type: 'success',
        message: `Plato "${prod.nombre}" ahora está ${
          nuevoEstado ? 'DISPONIBLE' : 'AGOTADO / INACTIVO'
        }.`,
      })
    } catch (err: unknown) {
      // Revertir optimismo ante falla
      setProductos((prev) =>
        prev.map((p) => (p.id === prod.id ? { ...p, disponible: !nuevoEstado } : p))
      )
      console.error('Error al cambiar disponibilidad:', err)
      const msg = err instanceof Error ? err.message : String(err)
      setNotification({ type: 'error', message: `No se pudo cambiar estado del plato: ${msg}` })
    }
  }

  // 2. Abrir Modal Crear Plato
  const abrirModalCrearPlato = () => {
    setPlatoEditando(null)
    setFormPlatoNombre('')
    setFormPlatoCategoriaId(categorias[0]?.id ? String(categorias[0].id) : '')
    setFormPlatoPrecio('')
    setFormPlatoDisponible(true)
    setFormFilasReceta([])
    setMostrarCrearCategoria(false)
    setNuevaCatNombre('')
    setModalPlatoAbierto(true)
  }

  // 3. Abrir Modal Editar Plato y su Receta
  const abrirModalEditarPlato = (prod: Producto) => {
    setPlatoEditando(prod)
    setFormPlatoNombre(prod.nombre)
    setFormPlatoCategoriaId(String(prod.categoria_id))
    setFormPlatoPrecio(String(prod.precio))
    setFormPlatoDisponible(prod.disponible)

    // Cargar ingredientes actuales configurados en receta
    const recetaDelPlato = recetasPorProducto.get(prod.id) || []
    setFormFilasReceta(
      recetaDelPlato.map((r) => ({
        insumo_id: r.insumo_id,
        cantidad: r.cantidad,
      }))
    )
    setMostrarCrearCategoria(false)
    setNuevaCatNombre('')
    setModalPlatoAbierto(true)
  }

  // 4. Agregar / Quitar filas en la receta dentro del modal
  const agregarFilaReceta = () => {
    setFormFilasReceta((prev) => [
      ...prev,
      {
        insumo_id: '',
        cantidad: 1,
      },
    ])
  }

  const actualizarFilaReceta = (
    index: number,
    campo: 'insumo_id' | 'cantidad',
    valor: string | number
  ) => {
    setFormFilasReceta((prev) =>
      prev.map((fila, i) => (i === index ? { ...fila, [campo]: valor } : fila))
    )
  }

  const eliminarFilaReceta = (index: number) => {
    setFormFilasReceta((prev) => prev.filter((_, i) => i !== index))
  }

  const quitarFilaReceta = eliminarFilaReceta

  // 5. Crear categoría rápida al instante si no existe
  const handleCrearCategoriaRapida = async (e: React.FormEvent) => {
    e.preventDefault()
    const nombre = nuevaCatNombre.trim()
    if (!nombre) return

    setGuardandoCategoria(true)
    try {
      const { data, error } = await db
        .from('categorias')
        .insert({ nombre })
        .select()
        .single()

      if (error) throw error

      const nuevaCat = data as Categoria
      setCategorias((prev) => [...prev, nuevaCat].sort((a, b) => a.nombre.localeCompare(b.nombre)))
      setFormPlatoCategoriaId(String(nuevaCat.id))
      setNuevaCatNombre('')
      setMostrarCrearCategoria(false)
      setNotification({ type: 'success', message: `Categoría "${nombre}" creada y seleccionada.` })
    } catch (err: unknown) {
      console.error('Error al crear categoría:', err)
      const msg = err instanceof Error ? err.message : String(err)
      setNotification({ type: 'error', message: `No se pudo crear la categoría: ${msg}` })
    } finally {
      setGuardandoCategoria(false)
    }
  }

  // 6. Guardado Completo del Plato y su Receta
  const handleGuardarPlato = async (e: React.FormEvent) => {
    e.preventDefault()
    const nombre = formPlatoNombre.trim()
    const precio = Number(formPlatoPrecio)
    const categoria_id = Number(formPlatoCategoriaId)

    if (!nombre) {
      alert('Error al guardar: El nombre del plato es obligatorio.')
      return
    }
    if (!categoria_id) {
      alert('Error al guardar: Debes seleccionar una categoría.')
      return
    }
    if (isNaN(precio) || precio <= 0) {
      alert('Error al guardar: Ingresa un precio de venta válido mayor a 0.')
      return
    }

    setGuardando(true)

    try {
      let productoId: number

      if (platoEditando) {
        productoId = platoEditando.id
        const { error: prodError } = await supabase
          .from('productos')
          .update({
            nombre,
            precio,
            categoria_id,
            disponible: formPlatoDisponible,
          })
          .eq('id', platoEditando.id)

        if (prodError) {
          alert('Error al guardar: ' + prodError.message)
          return
        }
      } else {
        const { data: prodData, error: prodError } = await supabase
          .from('productos')
          .insert({
            nombre,
            precio,
            categoria_id,
            disponible: formPlatoDisponible,
          })
          .select('id')
          .single()

        if (prodError) {
          alert('Error al guardar: ' + prodError.message)
          return
        }

        if (!prodData?.id) {
          alert('Error al guardar: No se pudo obtener el identificador del nuevo plato.')
          return
        }
        productoId = prodData.id
      }

      // Limpia los ingredientes anteriores de la receta
      const { error: delError } = await (supabase as any)
        .from('receta')
        .delete()
        .eq('producto_id', productoId)

      if (delError) {
        alert('Error al guardar: ' + delError.message)
        return
      }

      // Filtra solo las filas válidas que tengan un insumo_id seleccionado y Number(cantidad) > 0
      const filasValidas = formFilasReceta.filter(
        (f) =>
          f.insumo_id !== '' &&
          f.insumo_id !== null &&
          f.insumo_id !== undefined &&
          !isNaN(Number(f.cantidad)) &&
          Number(f.cantidad) > 0
      )

      // Si quedan filas válidas, prepara el payload convirtiendo los valores a números explícitos
      if (filasValidas.length > 0) {
        const payloadReceta = filasValidas.map((f) => ({
          producto_id: Number(productoId),
          insumo_id: Number(f.insumo_id),
          cantidad: Number(f.cantidad),
          cantidad_usada: Number(f.cantidad),
        }))

        // Inserta el lote
        const { error: recError } = await (supabase as any).from('receta').insert(payloadReceta)
        if (recError) {
          alert('Error al guardar: ' + recError.message)
          return
        }
      }

      // Al tener éxito: cierra el modal, muestra un toast o alert de confirmación y refresca la lista de platos e insumos
      setModalPlatoAbierto(false)
      const mensajeExito = `Plato "${nombre}" y su receta guardados exitosamente.`
      setNotification({
        type: 'success',
        message: `✅ ${mensajeExito}`,
      })
      alert(mensajeExito)

      await Promise.all([cargarProductos(), cargarInsumos(), cargarTodasLasRecetas()])
    } catch (error: any) {
      console.error('Error al guardar plato y receta:', error)
      const msg = error?.message || String(error)
      alert('Error al guardar: ' + msg)
    } finally {
      setGuardando(false)
    }
  }

  const handleGuardarPlatoYReceta = handleGuardarPlato

  // Costo total estimado dentro del modal
  const costoTotalEstimadoModal = useMemo(() => {
    return formFilasReceta.reduce((sum, f) => {
      const insumo = insumosMap.get(Number(f.insumo_id))
      return sum + Number(f.cantidad || 0) * Number(insumo?.costo_unitario || 0)
    }, 0)
  }, [formFilasReceta, insumosMap])

  // Filtrado de platos para la visualización en Tab 2
  const productosFiltrados = useMemo(() => {
    return productos.filter((prod) => {
      // Búsqueda por texto
      if (busquedaPlato.trim() !== '') {
        const query = busquedaPlato.toLowerCase().trim()
        if (!prod.nombre.toLowerCase().includes(query)) return false
      }
      // Filtro de categoría
      if (filtroCategoriaPlato !== 'todas') {
        if (String(prod.categoria_id) !== filtroCategoriaPlato) return false
      }
      // Filtro de estado disponible
      if (filtroEstadoPlato === 'disponibles' && !prod.disponible) return false
      if (filtroEstadoPlato === 'agotados' && prod.disponible) return false

      return true
    })
  }, [productos, busquedaPlato, filtroCategoriaPlato, filtroEstadoPlato])

  // ==========================================
  // CÁLCULOS AUDITORÍA (PESTAÑA 3)
  // ==========================================
  const movimientosFiltrados = useMemo(() => {
    return movimientos.filter((m) => {
      if (filtroTipoAuditoria !== 'todos') {
        if (filtroTipoAuditoria === 'ajustes') {
          if (m.tipo !== 'ajuste_positivo' && m.tipo !== 'ajuste_negativo') return false
        } else if (m.tipo !== filtroTipoAuditoria) {
          return false
        }
      }

      if (busquedaAuditoria.trim() !== '') {
        const query = busquedaAuditoria.toLowerCase().trim()
        const nombreInsumo = m.insumos?.nombre?.toLowerCase() || ''
        const motivo = m.motivo?.toLowerCase() || ''
        if (!nombreInsumo.includes(query) && !motivo.includes(query)) return false
      }

      return true
    })
  }, [movimientos, filtroTipoAuditoria, busquedaAuditoria])

  const totalPerdidoMermas = useMemo(() => {
    return movimientos
      .filter((m) => m.tipo === 'merma')
      .reduce((acc, m) => {
        const costo = Number(m.insumos?.costo_unitario || 0)
        return acc + costo * Number(m.cantidad || 0)
      }, 0)
  }, [movimientos])

  const totalGastadoVentas = useMemo(() => {
    return movimientos
      .filter((m) => m.tipo === 'consumo')
      .reduce((acc, m) => {
        const costo = Number(m.insumos?.costo_unitario || 0)
        return acc + costo * Number(m.cantidad || 0)
      }, 0)
  }, [movimientos])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center text-slate-100">
        <div className="w-12 h-12 border-4 border-slate-700 border-t-blue-500 rounded-full animate-spin mb-4" />
        <h3 className="text-xl font-bold">Cargando inventario y menú...</h3>
        <p className="text-sm text-slate-400 mt-1">Sincronizando insumos, platos, recetas y auditoría</p>
      </div>
    )
  }

  return (
    <div className="w-full max-w-7xl mx-auto px-3 sm:px-6 py-4 flex flex-col gap-6 text-left">
      {/* Encabezado Principal */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-3">
            <span className="p-2.5 bg-blue-600/20 border border-blue-500/40 rounded-2xl text-2xl">
              📦
            </span>
            <div>
              <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                Control de Inventario y Carta
              </h1>
              <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
                Gestión de insumos en bodega, menú de platos con recetas vinculadas y auditoría de mermas
              </p>
            </div>
          </div>
        </div>

        {/* Acciones superiores contextuales */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => {
              void cargarInsumos()
              void cargarProductos()
              void cargarTodasLasRecetas()
            }}
            className="min-h-[40px] px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 hover:text-white rounded-xl border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm"
          >
            🔄 Actualizar
          </button>

          {isAdmin && activeTab === 'insumos' && (
            <button
              type="button"
              onClick={abrirModalCrearInsumo}
              className="min-h-[40px] px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 active:scale-95 text-white rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 shadow-lg shadow-blue-600/30 transition-all"
            >
              <span>+ Nuevo Insumo</span>
            </button>
          )}

          {isAdmin && activeTab === 'carta-recetas' && (
            <button
              type="button"
              onClick={abrirModalCrearPlato}
              className="min-h-[40px] px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:scale-95 text-white rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 shadow-lg shadow-emerald-600/30 transition-all"
            >
              <span>+ Nuevo Plato</span>
            </button>
          )}
        </div>
      </div>

      {/* Alerta o Notificación flotante */}
      {notification && (
        <div
          role="alert"
          className={`p-4 rounded-2xl text-sm font-semibold flex items-center justify-between gap-3 shadow-xl transition-all animate-in fade-in duration-200 ${
            notification.type === 'success'
              ? 'bg-emerald-950/80 border-2 border-emerald-500 text-emerald-200'
              : notification.type === 'error'
                ? 'bg-rose-950/80 border-2 border-rose-500 text-rose-200'
                : 'bg-blue-950/80 border-2 border-blue-500 text-blue-200'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <span className="text-xl">
              {notification.type === 'success' ? '✅' : notification.type === 'error' ? '⚠️' : 'ℹ️'}
            </span>
            <span>{notification.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setNotification(null)}
            className="text-xs px-2.5 py-1 bg-black/40 hover:bg-black/60 rounded-lg text-white"
          >
            ✕
          </button>
        </div>
      )}

      {/* Pestañas de Navegación (Tabs) */}
      <div className="flex items-center gap-2 bg-slate-800/80 p-1.5 rounded-2xl border border-slate-700 max-w-fit overflow-x-auto">
        {/* Pestaña 1 */}
        <button
          type="button"
          onClick={() => setActiveTab('insumos')}
          className={`min-h-[42px] px-4 sm:px-5 py-2 rounded-xl text-xs sm:text-sm font-extrabold transition-all flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'insumos'
              ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30 scale-[1.02]'
              : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
          }`}
        >
          <span>📦</span>
          <span>Insumos y Stock</span>
          {insumosEnAlerta.length > 0 && (
            <span className="ml-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-500 text-white">
              {insumosEnAlerta.length}
            </span>
          )}
        </button>

        {/* Pestaña 2: Carta y Recetas */}
        <button
          type="button"
          onClick={() => setActiveTab('carta-recetas')}
          className={`min-h-[42px] px-4 sm:px-5 py-2 rounded-xl text-xs sm:text-sm font-extrabold transition-all flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'carta-recetas'
              ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30 scale-[1.02]'
              : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
          }`}
        >
          <span>🍽️</span>
          <span>Carta y Recetas</span>
          <span className="text-xs text-slate-300 font-bold bg-slate-700/60 px-2 py-0.5 rounded-lg">
            {productos.length}
          </span>
        </button>

        {/* Pestaña 3: Auditoría y Mermas */}
        <button
          type="button"
          onClick={() => setActiveTab('auditoria')}
          className={`min-h-[42px] px-4 sm:px-5 py-2 rounded-xl text-xs sm:text-sm font-extrabold transition-all flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'auditoria'
              ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30 scale-[1.02]'
              : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
          }`}
        >
          <span>📋</span>
          <span>Auditoría y Mermas</span>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* PESTAÑA 1: INSUMOS Y STOCK */}
      {/* ========================================================================= */}
      {activeTab === 'insumos' && (
        <div className="flex flex-col gap-6">
          {/* Tarjetas de Resumen Superior */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-5 rounded-2xl bg-slate-800/90 border border-slate-700/80 shadow-lg flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Insumos Activos
                </span>
                <span className="p-2 bg-blue-500/10 text-blue-400 rounded-xl text-lg">📦</span>
              </div>
              <div className="mt-3">
                <span className="text-3xl font-black text-white">{insumosActivos.length}</span>
                <p className="text-xs text-slate-400 mt-1">Materias primas en catálogo</p>
              </div>
            </div>

            <div
              onClick={() => setFiltroStock(filtroStock === 'alerta' ? 'todos' : 'alerta')}
              className={`p-5 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between shadow-lg ${
                insumosEnAlerta.length > 0
                  ? 'bg-amber-950/30 border-amber-500/50 hover:border-amber-400'
                  : 'bg-slate-800/90 border-slate-700/80'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-amber-300 uppercase tracking-wider">
                  En Alerta Mínima
                </span>
                <span className="p-2 bg-amber-500/10 text-amber-400 rounded-xl text-lg">⚠️</span>
              </div>
              <div className="mt-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-black text-amber-300">{insumosEnAlerta.length}</span>
                  <span className="text-xs text-amber-400/80">bajo mínimo</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">Toca para filtrar en riesgo</p>
              </div>
            </div>

            <div
              onClick={() => setFiltroStock(filtroStock === 'negativos' ? 'todos' : 'negativos')}
              className={`p-5 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between shadow-lg ${
                insumosEnNegativo.length > 0
                  ? 'bg-rose-950/40 border-rose-500/60 hover:border-rose-400 animate-pulse'
                  : 'bg-slate-800/90 border-slate-700/80'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-rose-300 uppercase tracking-wider">
                  Stock en Negativo
                </span>
                <span className="p-2 bg-rose-500/10 text-rose-400 rounded-xl text-lg">⛔</span>
              </div>
              <div className="mt-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-black text-rose-300">{insumosEnNegativo.length}</span>
                  <span className="text-xs text-rose-400/90 font-semibold">ventas sin compra</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Se vendieron platos sin registrar la compra
                </p>
              </div>
            </div>

            <div className="p-5 rounded-2xl bg-slate-800/90 border border-slate-700/80 shadow-lg flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Valoración Bodega
                </span>
                <span className="p-2 bg-emerald-500/10 text-emerald-400 rounded-xl text-lg">💰</span>
              </div>
              <div className="mt-3">
                <span className="text-2xl sm:text-3xl font-black text-emerald-400">
                  {formatPrice(valorTotalInventario)}
                </span>
                <p className="text-xs text-slate-400 mt-1">Capital en existencias actuales</p>
              </div>
            </div>
          </div>

          {/* Barra de Filtros y Búsqueda */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-slate-800/60 p-3 rounded-2xl border border-slate-700/80">
            <div className="relative flex-1">
              <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 text-sm">
                🔍
              </span>
              <input
                type="text"
                value={busquedaInsumo}
                onChange={(e) => setBusquedaInsumo(e.target.value)}
                placeholder="Buscar insumo por nombre (ej. carne, camarón, arroz, porcion...)"
                className="w-full pl-10 pr-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => setFiltroStock('todos')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  filtroStock === 'todos'
                    ? 'bg-blue-600 text-white shadow'
                    : 'bg-slate-900/80 text-slate-400 hover:text-white border border-slate-700'
                }`}
              >
                Todos ({insumosActivos.length})
              </button>
              <button
                type="button"
                onClick={() => setFiltroStock('alerta')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1 ${
                  filtroStock === 'alerta'
                    ? 'bg-amber-600 text-white shadow'
                    : 'bg-slate-900/80 text-amber-400 hover:text-white border border-slate-700'
                }`}
              >
                <span>⚠️ En Alerta</span>
                <span>({insumosEnAlerta.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setFiltroStock('negativos')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1 ${
                  filtroStock === 'negativos'
                    ? 'bg-rose-600 text-white shadow'
                    : 'bg-slate-900/80 text-rose-400 hover:text-white border border-slate-700'
                }`}
              >
                <span>⛔ Negativos</span>
                <span>({insumosEnNegativo.length})</span>
              </button>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setFiltroStock('inactivos')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                    filtroStock === 'inactivos'
                      ? 'bg-slate-700 text-white shadow'
                      : 'bg-slate-900/80 text-slate-500 hover:text-white border border-slate-700'
                  }`}
                >
                  Inactivos
                </button>
              )}
            </div>
          </div>

          {/* Tabla de Insumos */}
          {insumosFiltrados.length === 0 ? (
            <div className="text-center py-16 px-4 rounded-3xl bg-slate-800/40 border border-slate-800">
              <span className="text-5xl">📦</span>
              <h3 className="text-slate-200 font-bold text-lg mt-3">No se encontraron insumos</h3>
              <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                No hay insumos que coincidan con la búsqueda o filtro seleccionado.
              </p>
              {isAdmin && (
                <button
                  type="button"
                  onClick={abrirModalCrearInsumo}
                  className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl transition-all shadow"
                >
                  + Crear Primer Insumo
                </button>
              )}
            </div>
          ) : (
            <div className="bg-slate-900 rounded-3xl border border-slate-800 shadow-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-800/80 border-b border-slate-700 text-[11px] font-black uppercase tracking-wider text-slate-400">
                      <th className="py-3.5 px-4">Insumo</th>
                      <th className="py-3.5 px-4 text-center">Unidad</th>
                      <th className="py-3.5 px-4 text-right">Stock Actual</th>
                      <th className="py-3.5 px-4 text-right">Mínimo</th>
                      <th className="py-3.5 px-4 text-right">Costo Unit.</th>
                      <th className="py-3.5 px-4 text-right">Valor Total</th>
                      <th className="py-3.5 px-4 text-center">Acciones Rápidas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-sm">
                    {insumosFiltrados.map((insumo) => {
                      const stockActual = Number(insumo.stock_actual)
                      const stockMin = Number(insumo.stock_minimo)
                      const costo = Number(insumo.costo_unitario || 0)
                      const valorTotal = Math.max(0, stockActual) * costo

                      const esNegativo = stockActual < 0
                      const esAlerta = stockActual <= stockMin && !esNegativo

                      return (
                        <tr
                          key={insumo.id}
                          className={`hover:bg-slate-800/50 transition-colors ${
                            !insumo.activo ? 'opacity-50 bg-slate-950/40' : ''
                          }`}
                        >
                          <td className="py-4 px-4 font-semibold text-white">
                            <div className="flex items-center gap-2">
                              <span>{insumo.nombre}</span>
                              {!insumo.activo && (
                                <span className="text-[10px] uppercase font-black px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                                  Inactivo
                                </span>
                              )}
                            </div>
                          </td>

                          <td className="py-4 px-4 text-center">
                            <span className="inline-block px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wider bg-slate-800 text-slate-300 border border-slate-700">
                              {insumo.unidad}
                            </span>
                          </td>

                          <td className="py-4 px-4 text-right">
                            <div className="flex flex-col items-end">
                              <span
                                className={`text-base font-black ${
                                  esNegativo
                                    ? 'text-rose-400 flex items-center gap-1 animate-pulse'
                                    : esAlerta
                                      ? 'text-amber-300'
                                      : 'text-emerald-400'
                                }`}
                              >
                                {esNegativo && '⛔ '}
                                {formatCantidad(stockActual, insumo.unidad)}
                              </span>
                              {esNegativo ? (
                                <span className="text-[10px] font-bold text-rose-400/90 bg-rose-950/60 px-1.5 py-0.5 rounded border border-rose-800/60 mt-0.5">
                                  Falta registrar compra
                                </span>
                              ) : esAlerta ? (
                                <span className="text-[10px] font-bold text-amber-400 bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-800/60 mt-0.5">
                                  Alerta de mínimo
                                </span>
                              ) : null}
                            </div>
                          </td>

                          <td className="py-4 px-4 text-right text-slate-300 font-medium">
                            {formatCantidad(stockMin, insumo.unidad)}
                          </td>

                          <td className="py-4 px-4 text-right text-slate-300 font-medium">
                            {formatPrice(costo)}
                          </td>

                          <td className="py-4 px-4 text-right font-bold text-slate-200">
                            {formatPrice(valorTotal)}
                          </td>

                          <td className="py-4 px-4">
                            <div className="flex items-center justify-center gap-1.5 flex-wrap">
                              <button
                                type="button"
                                onClick={() => abrirModalMovimiento(insumo, 'entrada')}
                                title="Registrar compra o abastecimiento"
                                className="min-h-[36px] px-3 py-1.5 bg-emerald-600/90 hover:bg-emerald-500 active:scale-95 text-white font-bold text-xs rounded-xl transition-all shadow-sm flex items-center gap-1"
                              >
                                <span>+ Entrada</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => abrirModalMovimiento(insumo, 'merma')}
                                title="Registrar desperdicio, daño o baja"
                                className="min-h-[36px] px-3 py-1.5 bg-rose-700/80 hover:bg-rose-600 active:scale-95 text-white font-bold text-xs rounded-xl transition-all shadow-sm flex items-center gap-1"
                              >
                                <span>- Merma</span>
                              </button>

                              {isAdmin && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => abrirModalEditarInsumo(insumo)}
                                    title="Editar datos del insumo"
                                    className="min-h-[36px] p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl border border-slate-700 transition-all text-xs"
                                  >
                                    ✏️
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleToggleActivoInsumo(insumo)}
                                    title={insumo.activo ? 'Inactivar insumo (borrado lógico)' : 'Reactivar insumo'}
                                    className="min-h-[36px] px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-xl border border-slate-700 text-xs font-semibold"
                                  >
                                    {insumo.activo ? 'Inactivar' : 'Activar'}
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* PESTAÑA 2: CARTA Y RECETAS */}
      {/* ========================================================================= */}
      {activeTab === 'carta-recetas' && (
        <div className="flex flex-col gap-6">
          {/* Barra de Filtros, Búsqueda y Categorías */}
          <div className="flex flex-col gap-3 bg-slate-800/60 p-4 rounded-3xl border border-slate-700/80 shadow-lg">
            <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
              {/* Buscador de plato */}
              <div className="relative flex-1">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 text-sm">
                  🔍
                </span>
                <input
                  type="text"
                  value={busquedaPlato}
                  onChange={(e) => setBusquedaPlato(e.target.value)}
                  placeholder="Buscar plato en la carta (ej. Cazuela de Mariscos, Carne Asada, Limonada...)"
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                />
              </div>

              {/* Filtro de disponibilidad */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => setFiltroEstadoPlato('todos')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                    filtroEstadoPlato === 'todos'
                      ? 'bg-blue-600 text-white shadow'
                      : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-700'
                  }`}
                >
                  Todos ({productos.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFiltroEstadoPlato('disponibles')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1 ${
                    filtroEstadoPlato === 'disponibles'
                      ? 'bg-emerald-600 text-white shadow'
                      : 'bg-slate-900 text-emerald-400 hover:text-white border border-slate-700'
                  }`}
                >
                  <span>🟢 Disponibles</span>
                  <span>({productos.filter((p) => p.disponible).length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setFiltroEstadoPlato('agotados')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1 ${
                    filtroEstadoPlato === 'agotados'
                      ? 'bg-rose-600 text-white shadow'
                      : 'bg-slate-900 text-rose-400 hover:text-white border border-slate-700'
                  }`}
                >
                  <span>🔴 Agotados / Inactivos</span>
                  <span>({productos.filter((p) => !p.disponible).length})</span>
                </button>
              </div>
            </div>

            {/* Selector de Categorías (Pills) */}
            <div className="flex items-center gap-2 overflow-x-auto pt-2 border-t border-slate-700/60">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider whitespace-nowrap">
                Categoría:
              </span>
              <button
                type="button"
                onClick={() => setFiltroCategoriaPlato('todas')}
                className={`px-3 py-1 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                  filtroCategoriaPlato === 'todas'
                    ? 'bg-slate-200 text-slate-900 shadow'
                    : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-700'
                }`}
              >
                Todas las categorías
              </button>
              {categorias.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setFiltroCategoriaPlato(String(cat.id))}
                  className={`px-3 py-1 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                    filtroCategoriaPlato === String(cat.id)
                      ? 'bg-slate-200 text-slate-900 shadow'
                      : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-700'
                  }`}
                >
                  {cat.nombre}
                </button>
              ))}
            </div>
          </div>

          {/* Grid de Platos de la Carta */}
          {productosFiltrados.length === 0 ? (
            <div className="text-center py-20 px-4 rounded-3xl bg-slate-800/40 border border-slate-800">
              <span className="text-5xl">🍽️</span>
              <h3 className="text-slate-200 font-bold text-lg mt-3">No hay platos que coincidan</h3>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                No se encontraron platos con los filtros aplicados.
              </p>
              {isAdmin && (
                <button
                  type="button"
                  onClick={abrirModalCrearPlato}
                  className="mt-4 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition-all shadow"
                >
                  + Crear Nuevo Plato
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {productosFiltrados.map((prod) => {
                const recetaDelPlato = recetasPorProducto.get(prod.id) || []
                const tieneReceta = recetaDelPlato.length > 0

                // Costo estimado de insumos de este plato
                const costoEstimado = recetaDelPlato.reduce((sum, r) => {
                  const insumo = r.insumos || insumosMap.get(r.insumo_id)
                  return sum + Number(r.cantidad) * Number(insumo?.costo_unitario || 0)
                }, 0)

                // Margen estimado %
                const margen =
                  prod.precio > 0 ? Math.max(0, ((prod.precio - costoEstimado) / prod.precio) * 100) : 0

                // Resumen de ingredientes
                const resumenIngredientes = tieneReceta
                  ? recetaDelPlato
                      .map((r) => {
                        const insumo = r.insumos || insumosMap.get(r.insumo_id)
                        return `${formatCantidad(r.cantidad)} ${insumo?.unidad || 'und'} ${
                          insumo?.nombre || 'insumo'
                        }`
                      })
                      .join(', ')
                  : null

                const nombreCategoria =
                  prod.categorias?.nombre ||
                  categorias.find((c) => c.id === prod.categoria_id)?.nombre ||
                  'Sin categoría'

                return (
                  <div
                    key={prod.id}
                    className={`p-5 rounded-3xl border transition-all flex flex-col justify-between gap-4 shadow-xl ${
                      prod.disponible
                        ? 'bg-slate-900 border-slate-800 hover:border-slate-700'
                        : 'bg-slate-950/70 border-slate-800/60 opacity-80'
                    }`}
                  >
                    {/* Fila Superior: Nombre, Categoría y Switch Rápido */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider bg-slate-800 text-slate-300 border border-slate-700">
                            {nombreCategoria}
                          </span>
                        </div>
                        <h3 className="font-extrabold text-white text-lg leading-snug mt-1.5">
                          {prod.nombre}
                        </h3>
                      </div>

                      {/* Switch Rápido Activar / Desactivar (Disponible para admin y cajero) */}
                      <div className="flex flex-col items-end">
                        <button
                          type="button"
                          onClick={() => void handleToggleDisponiblePlato(prod)}
                          title={`Click para marcar como ${prod.disponible ? 'Agotado' : 'Disponible'}`}
                          className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-slate-900 ${
                            prod.disponible ? 'bg-emerald-600' : 'bg-slate-700'
                          }`}
                        >
                          <span
                            className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                              prod.disponible ? 'translate-x-6' : 'translate-x-1'
                            }`}
                          />
                        </button>
                        <span
                          className={`text-[10px] font-black uppercase tracking-wider mt-1 ${
                            prod.disponible ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {prod.disponible ? 'Disponible' : 'Agotado'}
                        </span>
                      </div>
                    </div>

                    {/* Fila Central: Precios y Resumen de Receta */}
                    <div className="space-y-3 pt-2 border-t border-slate-800/80">
                      {/* Precio de venta y costos */}
                      <div className="flex items-baseline justify-between">
                        <div>
                          <span className="text-[10px] font-bold text-slate-400 block uppercase">
                            Precio de Venta
                          </span>
                          <span className="text-xl font-black text-emerald-400">
                            {formatPrice(prod.precio)}
                          </span>
                        </div>

                        <div className="text-right">
                          <span className="text-[10px] font-bold text-slate-400 block uppercase">
                            Costo Insumos
                          </span>
                          <span
                            className={`text-sm font-extrabold ${
                              tieneReceta ? 'text-amber-300' : 'text-slate-500'
                            }`}
                          >
                            {tieneReceta ? formatPrice(costoEstimado) : '-'}
                          </span>
                          {tieneReceta && (
                            <span className="text-[10px] text-emerald-400 font-bold block">
                              Margen: {margen.toFixed(0)}%
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Resumen de receta */}
                      <div className="p-3 rounded-2xl bg-slate-800/60 border border-slate-700/60 text-xs">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1">
                          Insumos en Receta:
                        </span>
                        {tieneReceta ? (
                          <p className="text-slate-200 leading-relaxed font-medium line-clamp-3">
                            <span className="text-blue-400 font-bold">Requiere: </span>
                            {resumenIngredientes}
                          </p>
                        ) : (
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-bold">
                            <span>⚠️ Sin receta asignada</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Fila Inferior: Botón Editar Plato y Receta (Solo Admin) */}
                    {isAdmin && (
                      <div className="pt-2 border-t border-slate-800/80 flex justify-end">
                        <button
                          type="button"
                          onClick={() => abrirModalEditarPlato(prod)}
                          className="min-h-[38px] px-4 py-1.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-white font-bold text-xs rounded-xl border border-slate-700 transition-all flex items-center gap-1.5 shadow"
                        >
                          <span>✏️ Editar Plato y Receta</span>
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* PESTAÑA 3: AUDITORÍA Y MERMAS */}
      {/* ========================================================================= */}
      {activeTab === 'auditoria' && (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-5 rounded-2xl bg-slate-800/90 border border-slate-700/80 shadow-lg">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                Total Movimientos
              </span>
              <span className="text-3xl font-black text-white mt-2 block">
                {movimientos.length}
              </span>
              <span className="text-xs text-slate-400 mt-1 block">Registros auditados</span>
            </div>

            <div className="p-5 rounded-2xl bg-slate-800/90 border border-slate-700/80 shadow-lg">
              <span className="text-xs font-bold text-rose-400 uppercase tracking-wider block">
                Total Pérdidas en Mermas
              </span>
              <span className="text-2xl sm:text-3xl font-black text-rose-400 mt-2 block">
                {formatPrice(totalPerdidoMermas)}
              </span>
              <span className="text-xs text-rose-300/80 mt-1 block">Daño, pérdida y desperdicio</span>
            </div>

            <div className="p-5 rounded-2xl bg-slate-800/90 border border-slate-700/80 shadow-lg">
              <span className="text-xs font-bold text-blue-400 uppercase tracking-wider block">
                Costo en Ventas (Mesas)
              </span>
              <span className="text-2xl sm:text-3xl font-black text-blue-400 mt-2 block">
                {formatPrice(totalGastadoVentas)}
              </span>
              <span className="text-xs text-blue-300/80 mt-1 block">Descuento automático por receta</span>
            </div>

            <div className="p-5 rounded-2xl bg-slate-800/90 border border-slate-700/80 shadow-lg">
              <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider block">
                Entradas Registradas
              </span>
              <span className="text-2xl sm:text-3xl font-black text-emerald-400 mt-2 block">
                {movimientos.filter((m) => m.tipo === 'entrada').length}
              </span>
              <span className="text-xs text-emerald-300/80 mt-1 block">Compras y abastecimiento</span>
            </div>
          </div>

          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-slate-800/60 p-3 rounded-2xl border border-slate-700/80">
            <div className="relative flex-1">
              <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 text-sm">
                🔍
              </span>
              <input
                type="text"
                value={busquedaAuditoria}
                onChange={(e) => setBusquedaAuditoria(e.target.value)}
                placeholder="Filtrar por nombre de insumo o motivo..."
                className="w-full pl-10 pr-4 py-2 bg-slate-900 border border-slate-700 rounded-xl text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => setFiltroTipoAuditoria('todos')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  filtroTipoAuditoria === 'todos'
                    ? 'bg-blue-600 text-white shadow'
                    : 'bg-slate-900 text-slate-400 border border-slate-700'
                }`}
              >
                Todos
              </button>
              <button
                type="button"
                onClick={() => setFiltroTipoAuditoria('entrada')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  filtroTipoAuditoria === 'entrada'
                    ? 'bg-emerald-600 text-white shadow'
                    : 'bg-slate-900 text-emerald-400 border border-slate-700'
                }`}
              >
                📥 Compras
              </button>
              <button
                type="button"
                onClick={() => setFiltroTipoAuditoria('consumo')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  filtroTipoAuditoria === 'consumo'
                    ? 'bg-blue-600 text-white shadow'
                    : 'bg-slate-900 text-blue-400 border border-slate-700'
                }`}
              >
                🍽️ Ventas
              </button>
              <button
                type="button"
                onClick={() => setFiltroTipoAuditoria('merma')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  filtroTipoAuditoria === 'merma'
                    ? 'bg-rose-600 text-white shadow'
                    : 'bg-slate-900 text-rose-400 border border-slate-700'
                }`}
              >
                🗑️ Mermas
              </button>
              <button
                type="button"
                onClick={() => setFiltroTipoAuditoria('ajustes')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  filtroTipoAuditoria === 'ajustes'
                    ? 'bg-amber-600 text-white shadow'
                    : 'bg-slate-900 text-amber-400 border border-slate-700'
                }`}
              >
                ⚖️ Ajustes
              </button>
            </div>
          </div>

          {cargandoMovimientos ? (
            <div className="py-16 text-center text-slate-400">Cargando registros de auditoría...</div>
          ) : movimientosFiltrados.length === 0 ? (
            <div className="text-center py-16 px-4 rounded-3xl bg-slate-800/40 border border-slate-800">
              <span className="text-5xl">📋</span>
              <h3 className="text-slate-200 font-bold text-lg mt-3">Sin movimientos registrados</h3>
              <p className="text-xs text-slate-400 mt-1">
                No hay movimientos para el filtro de auditoría seleccionado.
              </p>
            </div>
          ) : (
            <div className="bg-slate-900 rounded-3xl border border-slate-800 shadow-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-800/80 border-b border-slate-700 text-[11px] font-black uppercase tracking-wider text-slate-400">
                      <th className="py-3.5 px-4">Fecha y Hora</th>
                      <th className="py-3.5 px-4">Insumo</th>
                      <th className="py-3.5 px-4 text-center">Tipo</th>
                      <th className="py-3.5 px-4 text-right">Cantidad</th>
                      <th className="py-3.5 px-4">Motivo / Detalle</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-sm">
                    {movimientosFiltrados.map((mov) => {
                      const insumo = mov.insumos
                      const nombreInsumo = insumo?.nombre || `Insumo #${mov.insumo_id}`
                      const unidad = insumo?.unidad || 'und'
                      const esPositivo = mov.tipo === 'entrada' || mov.tipo === 'ajuste_positivo'

                      return (
                        <tr key={mov.id} className="hover:bg-slate-800/40 transition-colors">
                          <td className="py-3.5 px-4 text-xs font-semibold text-slate-300 whitespace-nowrap">
                            {formatFecha(mov.fecha)}
                          </td>
                          <td className="py-3.5 px-4 font-bold text-white">{nombreInsumo}</td>
                          <td className="py-3.5 px-4 text-center">
                            <span
                              className={`inline-block px-2.5 py-1 rounded-lg text-xs font-black uppercase tracking-wider ${
                                mov.tipo === 'entrada'
                                  ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/40'
                                  : mov.tipo === 'merma'
                                    ? 'bg-rose-950/80 text-rose-300 border border-rose-500/40'
                                    : mov.tipo === 'consumo'
                                      ? 'bg-blue-950/80 text-blue-300 border border-blue-500/40'
                                      : 'bg-amber-950/80 text-amber-300 border border-amber-500/40'
                              }`}
                            >
                              {mov.tipo === 'entrada'
                                ? '📥 Entrada'
                                : mov.tipo === 'merma'
                                  ? '🗑️ Merma'
                                  : mov.tipo === 'consumo'
                                    ? '🍽️ Consumo'
                                    : mov.tipo === 'ajuste_positivo'
                                      ? '➕ Ajuste (+)'
                                      : '➖ Ajuste (-)'}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <span
                              className={`font-black text-sm ${
                                esPositivo ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {esPositivo ? '+' : '-'}
                              {formatCantidad(Number(mov.cantidad), unidad)}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-xs text-slate-300">
                            <div className="flex items-center gap-2">
                              <span>{mov.motivo || 'Sin motivo especificado'}</span>
                              {mov.pedido_id && (
                                <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-blue-300 border border-slate-700 font-bold">
                                  Pedido #{mov.pedido_id}
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: CREAR / EDITAR INSUMO (SOLO ADMIN) */}
      {/* ========================================================================= */}
      {modalInsumoAbierto && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
        >
          <div className="bg-slate-900 border-2 border-slate-700 rounded-3xl max-w-lg w-full p-6 shadow-2xl text-slate-100 flex flex-col gap-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <span className="p-2 bg-blue-600/20 text-blue-400 rounded-xl text-xl">📦</span>
                <div>
                  <h3 className="text-lg font-black text-white">
                    {insumoEditando ? 'Editar Insumo' : 'Nuevo Insumo en Bodega'}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {insumoEditando
                      ? 'Actualiza los parámetros de control del insumo'
                      : 'Define el nombre, unidad de medida y stock mínimo'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModalInsumoAbierto(false)}
                className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleGuardarInsumo} className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  Nombre del Insumo <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formNombre}
                  onChange={(e) => setFormNombre(e.target.value)}
                  placeholder="Ej: Camarón Tigre, Carne Res, Arroz Blanco..."
                  className="w-full px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 font-semibold"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">
                    Unidad de Medida <span className="text-rose-400">*</span>
                  </label>
                  <select
                    value={formUnidad}
                    onChange={(e) => setFormUnidad(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {UNIDADES_DISPONIBLES.map((u) => (
                      <option key={u} value={u}>
                        {u === 'porcion'
                          ? 'porcion (Porción)'
                          : u === 'und'
                            ? 'und (Unidad)'
                            : u === 'g'
                              ? 'g (Gramos)'
                              : u === 'kg'
                                ? 'kg (Kilogramos)'
                                : u === 'ml'
                                  ? 'ml (Mililitros)'
                                  : 'l (Litros)'}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">
                    Stock Mínimo (Alerta)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formStockMinimo}
                    onChange={(e) => setFormStockMinimo(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">
                    Costo Unitario (COP)
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={formCostoUnitario}
                    onChange={(e) => setFormCostoUnitario(e.target.value)}
                    placeholder="0"
                    className="w-full px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {!insumoEditando && (
                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1">
                      Stock Inicial
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={formStockInicial}
                      onChange={(e) => setFormStockInicial(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                )}
              </div>

              {insumoEditando && (
                <div className="p-3 rounded-xl bg-slate-800/80 border border-slate-700 flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-white block">Estado del Insumo</span>
                    <span className="text-[11px] text-slate-400">
                      Inactiva el insumo si ya no se utiliza (borrado lógico)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFormActivo(!formActivo)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                      formActivo ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-400'
                    }`}
                  >
                    {formActivo ? 'Activo' : 'Inactivo'}
                  </button>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setModalInsumoAbierto(false)}
                  className="min-h-[44px] px-5 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardandoInsumo}
                  className="min-h-[44px] px-6 py-2 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-bold text-xs sm:text-sm rounded-xl transition-all shadow-lg shadow-blue-600/30 disabled:bg-slate-700"
                >
                  {guardandoInsumo ? 'Guardando...' : insumoEditando ? 'Guardar Cambios' : 'Crear Insumo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: MOVIMIENTO RÁPIDO (+ ENTRADA / - MERMA / AJUSTES) */}
      {/* ========================================================================= */}
      {modalMovimientoAbierto && insumoSeleccionadoMov && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
        >
          <div className="bg-slate-900 border-2 border-slate-700 rounded-3xl max-w-lg w-full p-6 shadow-2xl text-slate-100 flex flex-col gap-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <span
                  className={`p-2 rounded-xl text-xl ${
                    movTipo === 'entrada'
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : movTipo === 'merma'
                        ? 'bg-rose-500/20 text-rose-400'
                        : 'bg-amber-500/20 text-amber-400'
                  }`}
                >
                  {movTipo === 'entrada' ? '📥' : movTipo === 'merma' ? '🗑️' : '⚖️'}
                </span>
                <div>
                  <h3 className="text-lg font-black text-white">
                    {movTipo === 'entrada'
                      ? 'Registrar Entrada / Compra'
                      : movTipo === 'merma'
                        ? 'Registrar Merma / Baja'
                        : 'Ajuste de Inventario'}
                  </h3>
                  <p className="text-xs text-slate-400">
                    Insumo: <strong className="text-white font-bold">{insumoSeleccionadoMov.nombre}</strong> (Stock actual: {formatCantidad(Number(insumoSeleccionadoMov.stock_actual), insumoSeleccionadoMov.unidad)})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModalMovimientoAbierto(false)}
                className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleRegistrarMovimiento} className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5">
                  Tipo de Operación
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setMovTipo('entrada')}
                    className={`p-2.5 rounded-xl text-xs font-bold text-left border transition-all ${
                      movTipo === 'entrada'
                        ? 'bg-emerald-950/80 border-emerald-500 text-emerald-200 shadow'
                        : 'bg-slate-800/80 border-slate-700 text-slate-400 hover:text-white'
                    }`}
                  >
                    📥 Entrada (Compra)
                  </button>
                  <button
                    type="button"
                    onClick={() => setMovTipo('merma')}
                    className={`p-2.5 rounded-xl text-xs font-bold text-left border transition-all ${
                      movTipo === 'merma'
                        ? 'bg-rose-950/80 border-rose-500 text-rose-200 shadow'
                        : 'bg-slate-800/80 border-slate-700 text-slate-400 hover:text-white'
                    }`}
                  >
                    🗑️ Merma (Pérdida)
                  </button>
                  <button
                    type="button"
                    onClick={() => setMovTipo('ajuste_positivo')}
                    className={`p-2.5 rounded-xl text-xs font-bold text-left border transition-all ${
                      movTipo === 'ajuste_positivo'
                        ? 'bg-teal-950/80 border-teal-500 text-teal-200 shadow'
                        : 'bg-slate-800/80 border-slate-700 text-slate-400 hover:text-white'
                    }`}
                  >
                    ➕ Ajuste Físico (+)
                  </button>
                  <button
                    type="button"
                    onClick={() => setMovTipo('ajuste_negativo')}
                    className={`p-2.5 rounded-xl text-xs font-bold text-left border transition-all ${
                      movTipo === 'ajuste_negativo'
                        ? 'bg-amber-950/80 border-amber-500 text-amber-200 shadow'
                        : 'bg-slate-800/80 border-slate-700 text-slate-400 hover:text-white'
                    }`}
                  >
                    ➖ Ajuste Físico (-)
                  </button>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-slate-300">
                    Cantidad ({insumoSeleccionadoMov.unidad}) <span className="text-rose-400">*</span>
                  </label>
                  <span className="text-[11px] text-slate-400">
                    Soporta decimales (ej. 0.5 media porción)
                  </span>
                </div>

                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={movCantidad}
                  onChange={(e) => setMovCantidad(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-lg font-black text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />

                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <span className="text-[11px] font-bold text-slate-400">Atajos rápidos:</span>
                  <button
                    type="button"
                    onClick={() => sumarCantidadRapida(0.5)}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-extrabold text-blue-400 border border-slate-700"
                  >
                    +0.5 (Media)
                  </button>
                  <button
                    type="button"
                    onClick={() => sumarCantidadRapida(1)}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-extrabold text-blue-400 border border-slate-700"
                  >
                    +1
                  </button>
                  <button
                    type="button"
                    onClick={() => sumarCantidadRapida(5)}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-extrabold text-blue-400 border border-slate-700"
                  >
                    +5
                  </button>
                  <button
                    type="button"
                    onClick={() => sumarCantidadRapida(10)}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-extrabold text-blue-400 border border-slate-700"
                  >
                    +10
                  </button>
                  <button
                    type="button"
                    onClick={() => setMovCantidad('1')}
                    className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-400 border border-slate-700"
                  >
                    Reiniciar a 1
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  Motivo obligatorio <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={movMotivo}
                  onChange={(e) => setMovMotivo(e.target.value)}
                  placeholder={
                    movTipo === 'entrada'
                      ? 'Ej: Compra mercado mañana, Abastecimiento distribuidor...'
                      : movTipo === 'merma'
                        ? 'Ej: Se dañaron 2 porciones, Desperdicio en cocción...'
                        : 'Ej: Ajuste por conteo físico semanal...'
                  }
                  className="w-full px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                />
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-800/80 border border-slate-700 flex items-center justify-between text-xs">
                <span className="text-slate-400 font-semibold">Proyección de Stock:</span>
                <div>
                  <span className="text-slate-300">{insumoSeleccionadoMov.stock_actual}</span>
                  <span className="text-slate-500 mx-1.5">➔</span>
                  <span
                    className={`font-black text-sm ${
                      movTipo === 'entrada' || movTipo === 'ajuste_positivo'
                        ? 'text-emerald-400'
                        : 'text-amber-400'
                    }`}
                  >
                    {movTipo === 'entrada' || movTipo === 'ajuste_positivo'
                      ? Number(insumoSeleccionadoMov.stock_actual) + (Number(movCantidad) || 0)
                      : Number(insumoSeleccionadoMov.stock_actual) - (Number(movCantidad) || 0)}{' '}
                    {insumoSeleccionadoMov.unidad}
                  </span>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setModalMovimientoAbierto(false)}
                  className="min-h-[44px] px-5 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardandoMovimiento}
                  className={`min-h-[44px] px-6 py-2 active:scale-95 text-white font-bold text-xs sm:text-sm rounded-xl transition-all shadow-lg disabled:bg-slate-700 disabled:cursor-not-allowed ${
                    movTipo === 'entrada'
                      ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/30'
                      : movTipo === 'merma'
                        ? 'bg-rose-600 hover:bg-rose-500 shadow-rose-600/30'
                        : 'bg-amber-600 hover:bg-amber-500 shadow-amber-600/30'
                  }`}
                >
                  {guardandoMovimiento ? 'Procesando...' : 'Confirmar Movimiento'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: CREAR / EDITAR PLATO Y SU RECETA (EXCLUSIVO ADMIN) */}
      {/* ========================================================================= */}
      {modalPlatoAbierto && isAdmin && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 overflow-y-auto animate-in fade-in duration-200"
        >
          <div className="bg-slate-900 border-2 border-slate-700 rounded-3xl max-w-2xl w-full p-5 sm:p-7 shadow-2xl text-slate-100 flex flex-col gap-5 my-auto max-h-[92vh] overflow-y-auto">
            {/* Cabecera del modal */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <span className="p-2.5 bg-emerald-500/20 text-emerald-400 rounded-2xl text-2xl">
                  🍽️
                </span>
                <div>
                  <h3 className="text-xl font-black text-white">
                    {platoEditando ? `Editar Plato: ${platoEditando.nombre}` : 'Nuevo Plato y su Receta'}
                  </h3>
                  <p className="text-xs text-slate-400">
                    Configura el precio, categoría y las materias primas que descuenta al venderse
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModalPlatoAbierto(false)}
                className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleGuardarPlato} className="flex flex-col gap-5">
              {/* SECCIÓN 1: DATOS DEL PLATO */}
              <div className="p-4 rounded-2xl bg-slate-800/60 border border-slate-700/80 flex flex-col gap-4">
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-300 flex items-center gap-2">
                  <span>📌</span>
                  <span>Datos Generales del Plato</span>
                </h4>

                {/* Nombre */}
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">
                    Nombre del Plato <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formPlatoNombre}
                    onChange={(e) => setFormPlatoNombre(e.target.value)}
                    placeholder="Ej: Cazuela de Mariscos, Carne Asada con Patacón..."
                    className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 font-semibold"
                  />
                </div>

                {/* Categoría con botón rápido de "+ Nueva categoría" */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-bold text-slate-300">
                      Categoría <span className="text-rose-400">*</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setMostrarCrearCategoria(!mostrarCrearCategoria)}
                      className="text-xs font-bold text-blue-400 hover:text-blue-300 underline"
                    >
                      {mostrarCrearCategoria ? 'Cancelar nueva categoría' : '+ Nueva categoría'}
                    </button>
                  </div>

                  {mostrarCrearCategoria ? (
                    <div className="p-3 rounded-xl bg-slate-900 border border-blue-500/40 flex items-center gap-2 animate-in fade-in">
                      <input
                        type="text"
                        value={nuevaCatNombre}
                        onChange={(e) => setNuevaCatNombre(e.target.value)}
                        placeholder="Nombre de la nueva categoría..."
                        className="flex-1 px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={handleCrearCategoriaRapida}
                        disabled={guardandoCategoria || !nuevaCatNombre.trim()}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold disabled:bg-slate-700"
                      >
                        {guardandoCategoria ? 'Creando...' : 'Crear'}
                      </button>
                    </div>
                  ) : (
                    <select
                      required
                      value={formPlatoCategoriaId}
                      onChange={(e) => setFormPlatoCategoriaId(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-sm text-white font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">-- Selecciona una categoría --</option>
                      {categorias.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.nombre}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Precio y Nota Informativa */}
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">
                    Precio de Venta en Pesos (COP) <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="number"
                    step="100"
                    min="100"
                    required
                    value={formPlatoPrecio}
                    onChange={(e) => setFormPlatoPrecio(e.target.value)}
                    placeholder="Ej: 35000"
                    className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-lg font-black text-emerald-400 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <div className="mt-1.5 flex items-start gap-1.5 text-[11px] text-slate-400">
                    <span className="text-blue-400 font-bold">ℹ️</span>
                    <span>
                      Nota: Cambiar el precio solo aplica a pedidos nuevos; las ventas pasadas conservan su precio histórico.
                    </span>
                  </div>
                </div>

                {/* Switch Disponible para la venta */}
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-700 flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-white block">Disponible para la venta</span>
                    <span className="text-[11px] text-slate-400">
                      Si está apagado, saldrá marcado como "Agotado" en toma de pedidos
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFormPlatoDisponible(!formPlatoDisponible)}
                    className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none ${
                      formPlatoDisponible ? 'bg-emerald-600' : 'bg-slate-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                        formPlatoDisponible ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* SECCIÓN 2: INSUMOS QUE CONSUME ESTE PLATO (RECETA) */}
              <div className="p-4 rounded-2xl bg-slate-800/60 border border-slate-700/80 flex flex-col gap-3">
                <div>
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-300 flex items-center gap-2">
                    <span>🍲</span>
                    <span>Insumos que consume este plato (Receta)</span>
                  </h4>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Se descontarán de bodega automáticamente cada vez que se pida este plato.
                  </p>
                </div>

                {/* Lista dinámica de insumos */}
                <div className="flex flex-col gap-3">
                  {formFilasReceta.length === 0 ? (
                    <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 flex items-center gap-2.5 text-center sm:text-left">
                      <span className="text-base text-slate-500">ℹ️</span>
                      <p className="text-xs text-slate-400 font-medium">
                        Este plato no tiene insumos asignados todavía
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
                      {formFilasReceta.map((fila, index) => {
                        const insumoActual = insumosMap.get(Number(fila.insumo_id))
                        const costoSubtotal =
                          Number(fila.cantidad || 0) * Number(insumoActual?.costo_unitario || 0)

                        return (
                          <div
                            key={index}
                            className="p-3 rounded-2xl bg-slate-900 border border-slate-700/80 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 transition-all hover:border-slate-600"
                          >
                            {/* Selector de Insumo */}
                            <div className="flex-1">
                              <label className="text-[10px] text-slate-400 font-bold block mb-1">
                                Insumo #{index + 1}
                              </label>
                              <select
                                value={fila.insumo_id}
                                onChange={(e) =>
                                  actualizarFilaReceta(index, 'insumo_id', e.target.value)
                                }
                                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs font-bold text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                              >
                                <option value="">-- Seleccionar insumo --</option>
                                {insumos
                                  .filter(
                                    (ins) =>
                                      ins.activo || String(ins.id) === String(fila.insumo_id)
                                  )
                                  .map((ins) => {
                                    const yaSeleccionado = formFilasReceta.some(
                                      (f, i) =>
                                        i !== index && String(f.insumo_id) === String(ins.id)
                                    )
                                    return (
                                      <option
                                        key={ins.id}
                                        value={ins.id}
                                        disabled={yaSeleccionado}
                                      >
                                        {ins.nombre} ({ins.unidad})
                                        {yaSeleccionado ? ' — (Ya seleccionado)' : ''}
                                      </option>
                                    )
                                  })}
                              </select>
                            </div>

                            {/* Controles de Cantidad, Costo y Eliminar */}
                            <div className="flex items-end justify-between sm:justify-end gap-2.5">
                              <div className="w-28">
                                <label className="text-[10px] text-slate-400 font-bold block mb-1">
                                  Cant. {insumoActual ? `(${insumoActual.unidad})` : ''}
                                </label>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0.01"
                                  placeholder="Cant."
                                  value={fila.cantidad}
                                  onChange={(e) =>
                                    actualizarFilaReceta(index, 'cantidad', e.target.value)
                                  }
                                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs font-black text-emerald-400 text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              </div>

                              {costoSubtotal > 0 && (
                                <div className="text-right pb-2 min-w-[70px]">
                                  <span className="text-[11px] font-bold text-amber-300 block">
                                    {formatPrice(costoSubtotal)}
                                  </span>
                                </div>
                              )}

                              <button
                                type="button"
                                onClick={() => eliminarFilaReceta(index)}
                                title="Eliminar insumo"
                                aria-label="Remover insumo"
                                className="h-9 w-9 bg-rose-600/20 hover:bg-rose-600 active:scale-95 text-rose-400 hover:text-white font-bold text-sm flex items-center justify-center rounded-xl border border-rose-500/40 transition-all shadow-sm shrink-0 mb-0.5"
                              >
                                🗑️
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* Botón siempre visible: Justo debajo de las filas */}
                  <button
                    type="button"
                    onClick={agregarFilaReceta}
                    className="w-full py-2.5 px-4 bg-slate-800/90 hover:bg-slate-700 text-blue-400 hover:text-blue-300 border border-dashed border-blue-500/40 hover:border-blue-400 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-sm active:scale-[0.99]"
                  >
                    <span className="text-base leading-none font-black">+</span>
                    <span>Agregar otro insumo</span>
                  </button>
                </div>

                {/* Barra de Resumen Financiero dentro del modal */}
                <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-700 flex items-center justify-between flex-wrap gap-2 text-xs">
                  <div>
                    <span className="text-slate-400 block font-semibold">Costo Total Insumos:</span>
                    <strong className="text-amber-300 text-sm font-extrabold">
                      {formatPrice(costoTotalEstimadoModal)}
                    </strong>
                  </div>

                  <div>
                    <span className="text-slate-400 block font-semibold">Precio de Venta:</span>
                    <strong className="text-emerald-400 text-sm font-extrabold">
                      {formatPrice(Number(formPlatoPrecio) || 0)}
                    </strong>
                  </div>

                  <div>
                    <span className="text-slate-400 block font-semibold">Margen Bruto Estimado:</span>
                    <strong className="text-blue-400 text-sm font-extrabold">
                      {Number(formPlatoPrecio) > 0
                        ? `${Math.max(
                            0,
                            ((Number(formPlatoPrecio) - costoTotalEstimadoModal) /
                              Number(formPlatoPrecio)) *
                              100
                          ).toFixed(0)}% (${formatPrice(
                            Math.max(0, Number(formPlatoPrecio) - costoTotalEstimadoModal)
                          )})`
                        : '-'}
                    </strong>
                  </div>
                </div>
              </div>

              {/* Botones de acción del modal */}
              <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setModalPlatoAbierto(false)}
                  className="min-h-[44px] px-5 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={
                    guardandoPlato ||
                    !formPlatoNombre.trim() ||
                    !formPlatoCategoriaId ||
                    !formPlatoPrecio ||
                    isNaN(Number(formPlatoPrecio)) ||
                    Number(formPlatoPrecio) <= 0
                  }
                  className="min-h-[44px] px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-extrabold text-xs sm:text-sm rounded-xl transition-all shadow-lg shadow-emerald-600/30 disabled:bg-slate-700 disabled:text-slate-400 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {guardandoPlato ? (
                    <span>Guardando Plato y Receta...</span>
                  ) : (
                    <span>💾 Guardar Plato y Receta</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default Inventario
