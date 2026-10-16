import React from 'react'
import type { Producto } from '../../types/database'

interface ProductCardProps {
  producto: Producto
  onAddToCart: (producto_id: number) => void
  cantidadEnCarrito?: number
}

function formatPrice(precio: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(precio)
}

export const ProductCard: React.FC<ProductCardProps> = ({
  producto,
  onAddToCart,
  cantidadEnCarrito = 0,
}) => {
  const isAgotado = producto.disponible === false

  const handleClick = () => {
    if (isAgotado) return
    onAddToCart(producto.id)
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isAgotado}
      aria-label={isAgotado ? `${producto.nombre} (Agotado)` : `Agregar ${producto.nombre} al pedido`}
      className={`relative w-full text-left p-4 rounded-2xl border transition-all duration-150 flex flex-col justify-between min-h-[105px] select-none ${
        isAgotado
          ? 'bg-slate-900/90 border-slate-800 text-slate-500 opacity-60 cursor-not-allowed'
          : cantidadEnCarrito > 0
            ? 'bg-slate-800/90 border-blue-500/80 shadow-lg shadow-blue-500/10 active:scale-[0.97]'
            : 'bg-slate-800 border-slate-700/80 hover:border-slate-600 shadow active:scale-[0.97]'
      }`}
    >
      {/* Badge de Agotado */}
      {isAgotado && (
        <span className="absolute top-2 right-2 flex items-center justify-center px-2 py-0.5 rounded-full bg-rose-950 border border-rose-800 text-rose-300 font-black text-[10px] tracking-wider uppercase shadow">
          Agotado
        </span>
      )}

      {/* Badge de cantidad si ya está en el carrito */}
      {!isAgotado && cantidadEnCarrito > 0 && (
        <span className="absolute top-2 right-2 flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded-full bg-blue-600 text-white font-bold text-xs shadow-md animate-in fade-in zoom-in duration-150">
          x{cantidadEnCarrito}
        </span>
      )}

      {/* Nombre del producto */}
      <div className="pr-6">
        <h3
          className={`font-semibold text-base leading-snug line-clamp-2 ${
            isAgotado ? 'text-slate-400 line-through' : 'text-slate-100'
          }`}
        >
          {producto.nombre}
        </h3>
        {producto.categorias?.nombre && (
          <span className="text-xs text-slate-400 mt-0.5 inline-block">
            {producto.categorias.nombre}
          </span>
        )}
      </div>

      {/* Precio y botón tácito visual */}
      <div className="mt-3 flex items-center justify-between">
        <span
          className={`font-bold text-base ${
            isAgotado ? 'text-slate-500' : 'text-emerald-400'
          }`}
        >
          {formatPrice(producto.precio)}
        </span>
        <span
          className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-lg leading-none border ${
            isAgotado
              ? 'bg-slate-800/60 text-slate-600 border-slate-700'
              : 'bg-blue-600/20 text-blue-400 border-blue-500/30'
          }`}
        >
          {isAgotado ? '✕' : '+'}
        </span>
      </div>
    </button>
  )
}

export default ProductCard
