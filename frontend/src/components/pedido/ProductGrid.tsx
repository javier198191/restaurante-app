import React from 'react'
import type { Producto } from '../../types/database'
import type { CartItem } from '../../hooks/useCart'
import ProductCard from './ProductCard'

interface ProductGridProps {
  productos: Producto[]
  onAddToCart: (producto_id: number) => void
  cartItems?: CartItem[]
}

export const ProductGrid: React.FC<ProductGridProps> = ({
  productos,
  onAddToCart,
  cartItems = [],
}) => {
  // Mapa de conteo rápido para badge en tarjeta
  const countMap = new Map<number, number>()
  cartItems.forEach((item) => {
    countMap.set(item.producto_id, item.cantidad)
  })

  if (productos.length === 0) {
    return (
      <div className="w-full flex flex-col items-center justify-center py-16 px-4 text-center">
        <span className="text-4xl mb-3">🔍</span>
        <p className="text-lg font-medium text-slate-300">
          No se encontraron productos disponibles
        </p>
        <p className="text-sm text-slate-500 mt-1">
          Prueba cambiando la categoría o los términos de búsqueda
        </p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 pb-28">
      {productos.map((producto) => (
        <ProductCard
          key={producto.id}
          producto={producto}
          onAddToCart={onAddToCart}
          cantidadEnCarrito={countMap.get(producto.id) || 0}
        />
      ))}
    </div>
  )
}

export default ProductGrid
