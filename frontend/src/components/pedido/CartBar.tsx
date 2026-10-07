import React, { useState } from 'react'
import type { CartItem } from '../../hooks/useCart'
import type { Producto } from '../../types/database'

interface CartBarProps {
  items: CartItem[]
  productos: Producto[]
  total: number
  onAddItem: (producto_id: number) => void
  onRemoveItem: (producto_id: number) => void
  onSetNota: (producto_id: number, texto: string) => void
  onSubmitOrder: () => void
  submitting?: boolean
}

function formatPrice(precio: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(precio)
}

export const CartBar: React.FC<CartBarProps> = ({
  items,
  productos,
  total,
  onAddItem,
  onRemoveItem,
  onSetNota,
  onSubmitOrder,
  submitting = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(false)

  const totalItemsCount = items.reduce((sum, item) => sum + item.cantidad, 0)
  const productMap = new Map<number, Producto>()
  productos.forEach((p) => productMap.set(p.id, p))

  if (items.length === 0 && !isExpanded) {
    return null
  }

  return (
    <>
      {/* Fondo semitransparente al expandir */}
      {isExpanded && (
        <div
          onClick={() => setIsExpanded(false)}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 transition-opacity"
        />
      )}

      {/* Contenedor principal de la barra/modal del carrito */}
      <div
        className={`fixed bottom-0 inset-x-0 z-50 bg-slate-900 border-t border-slate-700 shadow-2xl transition-all duration-300 ease-in-out ${
          isExpanded ? 'max-h-[85vh] rounded-t-3xl flex flex-col' : 'rounded-none'
        }`}
      >
        {/* Cabecera / Barra colapsada */}
        <div className="p-3 sm:p-4 flex items-center justify-between gap-3 max-w-4xl mx-auto w-full">
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex-1 flex items-center justify-between text-left min-h-[44px] px-3 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700 active:scale-[0.99] transition-all"
          >
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-600 text-white font-bold text-sm">
                🛒
              </span>
              <div>
                <span className="font-bold text-slate-100 text-sm sm:text-base">
                  {totalItemsCount} {totalItemsCount === 1 ? 'item' : 'items'}
                </span>
                <span className="text-slate-400 mx-2">—</span>
                <span className="font-extrabold text-emerald-400 text-sm sm:text-base">
                  {formatPrice(total)}
                </span>
              </div>
            </div>

            <span className="text-xs font-semibold text-blue-400 flex items-center gap-1">
              {isExpanded ? 'Ocultar ▲' : 'Ver detalle ▼'}
            </span>
          </button>

          {!isExpanded && (
            <button
              type="button"
              onClick={onSubmitOrder}
              disabled={items.length === 0 || submitting}
              className="min-h-[44px] px-5 py-2.5 rounded-xl font-bold text-sm bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed transition-all shadow-md shadow-emerald-600/20 whitespace-nowrap"
            >
              {submitting ? 'Enviando...' : 'Enviar a cocina'}
            </button>
          )}
        </div>

        {/* Detalle expandido */}
        {isExpanded && (
          <div className="flex-1 overflow-y-auto px-4 pb-4 pt-1 max-w-4xl mx-auto w-full flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h2 className="text-lg font-bold text-slate-100">Detalle del Pedido</h2>
              <button
                type="button"
                onClick={() => setIsExpanded(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-800 text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            {items.length === 0 ? (
              <p className="text-center py-8 text-slate-400">El carrito está vacío</p>
            ) : (
              <div className="space-y-3">
                {items.map((item) => {
                  const prod = productMap.get(item.producto_id)
                  const nombre = prod?.nombre || `Producto #${item.producto_id}`
                  const precio = prod?.precio || 0
                  const subtotal = precio * item.cantidad

                  return (
                    <div
                      key={item.producto_id}
                      className="p-3 bg-slate-800/90 rounded-2xl border border-slate-700/70 flex flex-col gap-2.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex-1">
                          <h4 className="font-semibold text-slate-100 text-base leading-snug">
                            {nombre}
                          </h4>
                          <span className="text-xs text-slate-400">
                            {formatPrice(precio)} c/u — Subtotal: {formatPrice(subtotal)}
                          </span>
                        </div>

                        {/* Botones táctiles de +/- */}
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => onRemoveItem(item.producto_id)}
                            className="w-11 h-11 min-h-[44px] min-w-[44px] rounded-xl bg-slate-700 hover:bg-slate-600 active:scale-95 text-white font-bold text-lg flex items-center justify-center border border-slate-600"
                            aria-label={`Reducir cantidad de ${nombre}`}
                          >
                            –
                          </button>

                          <span className="font-bold text-slate-100 text-base min-w-[28px] text-center">
                            {item.cantidad}
                          </span>

                          <button
                            type="button"
                            onClick={() => onAddItem(item.producto_id)}
                            className="w-11 h-11 min-h-[44px] min-w-[44px] rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-bold text-lg flex items-center justify-center border border-blue-500"
                            aria-label={`Aumentar cantidad de ${nombre}`}
                          >
                            +
                          </button>
                        </div>
                      </div>

                      {/* Campo de notas por item */}
                      <div>
                        <input
                          type="text"
                          value={item.nota || ''}
                          onChange={(e) => onSetNota(item.producto_id, e.target.value)}
                          placeholder="Nota (ej: sin cebolla, término medio...)"
                          className="w-full text-xs sm:text-sm bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Resumen final y botón de envío */}
            <div className="pt-3 border-t border-slate-800 space-y-3 mt-auto">
              <div className="flex justify-between items-center text-slate-200">
                <span className="text-base font-medium">Total general:</span>
                <span className="text-xl font-extrabold text-emerald-400">
                  {formatPrice(total)}
                </span>
              </div>

              <button
                type="button"
                onClick={onSubmitOrder}
                disabled={items.length === 0 || submitting}
                className="w-full min-h-[52px] rounded-2xl font-bold text-base bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] text-white disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed transition-all shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <span>Enviando pedido a cocina...</span>
                ) : (
                  <span>🍽️ Enviar a cocina ({totalItemsCount} items)</span>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

export default CartBar
