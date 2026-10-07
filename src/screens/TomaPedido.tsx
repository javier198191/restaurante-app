import React, { useState, useMemo } from 'react'
import { useMenu } from '../hooks/useMenu'
import { useCart } from '../hooks/useCart'
import { useAuth } from '../context/AuthContext'
import { submitOrder } from '../lib/orders'
import { usePendingCount } from '../lib/offlineQueue'

import CategoryTabs from '../components/pedido/CategoryTabs'
import SearchBar from '../components/pedido/SearchBar'
import ProductGrid from '../components/pedido/ProductGrid'
import CartBar from '../components/pedido/CartBar'

interface TomaPedidoProps {
  mesaIdInicial?: number | string
  mesaId?: number | string
}

interface NotificationState {
  type: 'success' | 'pending' | 'error'
  message: string
}

export const TomaPedido: React.FC<TomaPedidoProps> = ({
  mesaIdInicial,
  mesaId: propMesaId,
}) => {
  const { user } = useAuth()
  const { productos, categorias, loading, error, refetch } = useMenu()
  const { items, addItem, removeItem, setNota, clearCart, total } = useCart(productos)
  const pendingCount = usePendingCount()

  // 100% dependiente de la ruta o navegación (useParams / pathname / hash / props)
  const mesaId = useMemo<number>(() => {
    if (propMesaId !== undefined && propMesaId !== null) {
      return Number(propMesaId)
    }
    if (mesaIdInicial !== undefined && mesaIdInicial !== null) {
      return Number(mesaIdInicial)
    }
    if (typeof window !== 'undefined') {
      const pathMatch = window.location.pathname.match(/(?:tomar-pedido|mesa)\/(\w+)/)
      if (pathMatch) return Number(pathMatch[1])

      const hashMatch = window.location.hash.match(/(?:tomar-pedido|mesa)\/(\w+)/)
      if (hashMatch) return Number(hashMatch[1])

      const urlParams = new URLSearchParams(window.location.search)
      const queryId = urlParams.get('mesa_id') || urlParams.get('id')
      if (queryId) return Number(queryId)
    }
    return 1
  }, [propMesaId, mesaIdInicial])
  const [selectedCategoriaId, setSelectedCategoriaId] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [submitting, setSubmitting] = useState<boolean>(false)
  const [notification, setNotification] = useState<NotificationState | null>(null)

  // Filtrado 100% en memoria
  const productosFiltrados = useMemo(() => {
    return productos.filter((p) => {
      // Filtrar por categoría activa (si no es null/"Todos")
      if (selectedCategoriaId !== null && p.categoria_id !== selectedCategoriaId) {
        return false
      }
      // Filtrar por texto de búsqueda case-insensitive
      if (searchQuery.trim() !== '') {
        const query = searchQuery.toLowerCase().trim()
        return p.nombre.toLowerCase().includes(query)
      }
      return true
    })
  }, [productos, selectedCategoriaId, searchQuery])

  // Manejo de envío a cocina
  const handleEnviarCocina = async () => {
    if (items.length === 0) return

    if (!user?.id) {
      setNotification({
        type: 'error',
        message: 'No hay un usuario autenticado para registrar el pedido.',
      })
      return
    }

    setSubmitting(true)
    setNotification(null)

    try {
      const orderItems = items.map((item) => ({
        producto_id: item.producto_id,
        cantidad: item.cantidad,
        nota: item.nota || null,
      }))

      const res = await submitOrder(mesaId, user.id, orderItems)

      if (res.success) {
        clearCart()
        setNotification({
          type: 'success',
          message: `✅ Pedido #${res.pedidoId} enviado con éxito directo a cocina.`,
        })
      } else if (res.pending) {
        clearCart()
        setNotification({
          type: 'pending',
          message: '📦 Guardado, se enviará cuando haya señal.',
        })
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error inesperado al enviar el pedido'
      setNotification({
        type: 'error',
        message: `❌ ${message}`,
      })
    } finally {
      setSubmitting(false)
    }
  }

  // Indicador de carga simple
  if (loading && productos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center text-slate-100">
        <div className="w-12 h-12 border-4 border-slate-700 border-t-blue-500 rounded-full animate-spin mb-4" />
        <h3 className="text-xl font-bold">Cargando menú del restaurante...</h3>
        <p className="text-sm text-slate-400 mt-1">Preparando productos y categorías</p>
      </div>
    )
  }

  // Estado de error si no hay nada en cache
  if (error && productos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center max-w-md mx-auto">
        <div className="w-16 h-16 rounded-full bg-red-900/40 text-red-400 flex items-center justify-center text-3xl mb-4 border border-red-800">
          ⚠️
        </div>
        <h3 className="text-xl font-bold text-white mb-2">No se pudo cargar el menú</h3>
        <p className="text-sm text-slate-400 mb-6 leading-relaxed">
          {error}. Verifica la conexión a internet para descargar el menú por primera vez.
        </p>
        <button
          type="button"
          onClick={() => refetch()}
          className="min-h-[44px] px-6 py-2.5 rounded-xl font-bold text-sm bg-blue-600 hover:bg-blue-500 active:scale-95 text-white transition-all shadow-md shadow-blue-600/20"
        >
          🔄 Reintentar conexión
        </button>
      </div>
    )
  }

  return (
    <div className="w-full max-w-6xl mx-auto px-3 sm:px-6 py-4 flex flex-col gap-4 text-left">
      {/* Barra superior con identificación fija de la mesa (sin selector manual) y avisos offline */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Mesa:
          </span>
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-slate-800 border border-slate-700 text-white font-extrabold text-base shadow-sm">
            <span className="text-blue-400">🍽️</span>
            <span>Mesa #{mesaId}</span>
          </div>
        </div>

        {/* Indicador visible de pedidos pendientes de sincronizar */}
        {pendingCount > 0 && (
          <div className="flex items-center gap-2 bg-amber-500/20 border border-amber-500/40 text-amber-300 px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-bold animate-pulse">
            <span>📦</span>
            <span>{pendingCount} pedido{pendingCount > 1 ? 's' : ''} sincronizando...</span>
          </div>
        )}
      </div>

      {/* Notificación de envío */}
      {notification && (
        <div
          role="alert"
          className={`p-4 rounded-xl text-sm font-medium flex items-center justify-between gap-2 shadow-lg transition-all animate-in fade-in duration-200 ${
            notification.type === 'success'
              ? 'bg-emerald-950/80 border border-emerald-500 text-emerald-200'
              : notification.type === 'pending'
                ? 'bg-amber-950/80 border border-amber-500 text-amber-200'
                : 'bg-red-950/80 border border-red-500 text-red-200'
          }`}
        >
          <span>{notification.message}</span>
          <button
            type="button"
            onClick={() => setNotification(null)}
            className="text-xs px-2 py-1 rounded bg-black/30 hover:bg-black/50 text-white"
          >
            ✕
          </button>
        </div>
      )}

      {/* Buscador de productos */}
      <SearchBar searchQuery={searchQuery} onSearchChange={setSearchQuery} />

      {/* Selector deslizable de categorías */}
      <CategoryTabs
        categorias={categorias}
        selectedCategoriaId={selectedCategoriaId}
        onSelectCategoria={setSelectedCategoriaId}
      />

      {/* Conteo de productos visibles */}
      <div className="flex items-center justify-between text-xs text-slate-400 px-1">
        <span>
          Mostrando {productosFiltrados.length} de {productos.length} productos
        </span>
        {selectedCategoriaId !== null && (
          <button
            type="button"
            onClick={() => setSelectedCategoriaId(null)}
            className="text-blue-400 hover:underline"
          >
            Quitar filtro
          </button>
        )}
      </div>

      {/* Grid de productos */}
      <ProductGrid
        productos={productosFiltrados}
        onAddToCart={addItem}
        cartItems={items}
      />

      {/* Barra de carrito fija abajo */}
      <CartBar
        items={items}
        productos={productos}
        total={total}
        onAddItem={addItem}
        onRemoveItem={removeItem}
        onSetNota={setNota}
        onSubmitOrder={handleEnviarCocina}
        submitting={submitting}
      />
    </div>
  )
}

export default TomaPedido
