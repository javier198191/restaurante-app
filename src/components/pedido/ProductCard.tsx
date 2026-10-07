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
  const handleClick = () => {
    onAddToCart(producto.id)
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={`Agregar ${producto.nombre} al pedido`}
      className={`relative w-full text-left p-4 rounded-2xl border transition-all duration-150 flex flex-col justify-between min-h-[105px] select-none active:scale-[0.97] ${
        cantidadEnCarrito > 0
          ? 'bg-slate-800/90 border-blue-500/80 shadow-lg shadow-blue-500/10'
          : 'bg-slate-800 border-slate-700/80 hover:border-slate-600 shadow'
      }`}
    >
      {/* Badge de cantidad si ya está en el carrito */}
      {cantidadEnCarrito > 0 && (
        <span className="absolute top-2 right-2 flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded-full bg-blue-600 text-white font-bold text-xs shadow-md animate-in fade-in zoom-in duration-150">
          x{cantidadEnCarrito}
        </span>
      )}

      {/* Nombre del producto */}
      <div className="pr-6">
        <h3 className="font-semibold text-slate-100 text-base leading-snug line-clamp-2">
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
        <span className="font-bold text-emerald-400 text-base">
          {formatPrice(producto.precio)}
        </span>
        <span className="w-8 h-8 rounded-full bg-blue-600/20 text-blue-400 flex items-center justify-center font-bold text-lg leading-none border border-blue-500/30">
          +
        </span>
      </div>
    </button>
  )
}

export default ProductCard
