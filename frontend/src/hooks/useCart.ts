import { useReducer, useMemo, useCallback } from 'react'
import type { Producto } from '../types/database'

export interface CartItem {
  producto_id: number
  cantidad: number
  nota?: string | null
}

type CartAction =
  | { type: 'ADD_ITEM'; producto_id: number }
  | { type: 'REMOVE_ITEM'; producto_id: number }
  | { type: 'SET_NOTA'; producto_id: number; nota: string }
  | { type: 'CLEAR_CART' }

function cartReducer(state: CartItem[], action: CartAction): CartItem[] {
  switch (action.type) {
    case 'ADD_ITEM': {
      const existingIndex = state.findIndex((item) => item.producto_id === action.producto_id)
      if (existingIndex > -1) {
        return state.map((item, index) =>
          index === existingIndex ? { ...item, cantidad: item.cantidad + 1 } : item
        )
      }
      return [...state, { producto_id: action.producto_id, cantidad: 1 }]
    }

    case 'REMOVE_ITEM': {
      return state
        .map((item) =>
          item.producto_id === action.producto_id
            ? { ...item, cantidad: item.cantidad - 1 }
            : item
        )
        .filter((item) => item.cantidad > 0)
    }

    case 'SET_NOTA': {
      return state.map((item) =>
        item.producto_id === action.producto_id
          ? { ...item, nota: action.nota }
          : item
      )
    }

    case 'CLEAR_CART':
      return []

    default:
      return state
  }
}

export interface UseCartResult {
  items: CartItem[]
  addItem: (producto_id: number) => void
  removeItem: (producto_id: number) => void
  setNota: (producto_id: number, texto: string) => void
  clearCart: () => void
  total: number
}

export function useCart(productos?: Producto[]): UseCartResult {
  const [items, dispatch] = useReducer(cartReducer, [])

  const addItem = useCallback((producto_id: number) => {
    dispatch({ type: 'ADD_ITEM', producto_id })
  }, [])

  const removeItem = useCallback((producto_id: number) => {
    dispatch({ type: 'REMOVE_ITEM', producto_id })
  }, [])

  const setNota = useCallback((producto_id: number, texto: string) => {
    dispatch({ type: 'SET_NOTA', producto_id, nota: texto })
  }, [])

  const clearCart = useCallback(() => {
    dispatch({ type: 'CLEAR_CART' })
  }, [])

  const total = useMemo(() => {
    if (!productos || productos.length === 0) return 0
    const priceMap = new Map<number, number>()
    productos.forEach((p) => priceMap.set(p.id, p.precio))

    return items.reduce((sum, item) => {
      const unitPrice = priceMap.get(item.producto_id) || 0
      return sum + unitPrice * item.cantidad
    }, 0)
  }, [items, productos])

  return {
    items,
    addItem,
    removeItem,
    setNota,
    clearCart,
    total,
  }
}
