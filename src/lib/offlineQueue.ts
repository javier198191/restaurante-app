import { openDB } from 'idb'
import { useState, useEffect } from 'react'

export interface OrderItem {
  producto_id: number
  cantidad: number
  nota?: string | null
}

export interface PedidoPendiente {
  cliente_uuid: string
  mesa_id: number
  usuario_id: string
  items: OrderItem[]
  createdAt?: string
}

const DB_NAME = 'restaurante_offline_db'
const DB_VERSION = 1
const STORE_NAME = 'pedidos_pendientes'

let dbPromise: Promise<any> | null = null

function getDB(): Promise<any> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'cliente_uuid' })
        }
      },
    })
  }
  return dbPromise
}

type QueueListener = (count: number) => void
const listeners = new Set<QueueListener>()

async function notifyListeners(): Promise<void> {
  try {
    const count = await getQueueCount()
    listeners.forEach((listener) => listener(count))
  } catch (error) {
    console.error('Error al notificar observadores de la cola offline:', error)
  }
}

/**
 * Guarda el objeto completo del pedido en el object store 'pedidos_pendientes' usando cliente_uuid como key.
 */
export async function addToQueue(pedido: PedidoPendiente): Promise<void> {
  const db = await getDB()
  await db.put(STORE_NAME, {
    ...pedido,
    createdAt: pedido.createdAt || new Date().toISOString(),
  })
  await notifyListeners()
}

/**
 * Devuelve todos los pedidos pendientes almacenados en IndexedDB.
 */
export async function getQueue(): Promise<PedidoPendiente[]> {
  const db = await getDB()
  return db.getAll(STORE_NAME)
}

/**
 * Borra de IndexedDB un pedido ya sincronizado con Supabase.
 */
export async function removeFromQueue(cliente_uuid: string): Promise<void> {
  const db = await getDB()
  await db.delete(STORE_NAME, cliente_uuid)
  await notifyListeners()
}

/**
 * Devuelve el conteo de pedidos pendientes en la cola.
 */
export async function getQueueCount(): Promise<number> {
  const db = await getDB()
  return db.count(STORE_NAME)
}

/**
 * Hook de React que expone el número de pedidos pendientes en cola.
 * Se actualiza reactivamente cada vez que se agrega o remueve un pedido.
 */
export function usePendingCount(): number {
  const [count, setCount] = useState<number>(0)

  useEffect(() => {
    let isMounted = true

    getQueueCount()
      .then((c) => {
        if (isMounted) setCount(c)
      })
      .catch((err) => console.error('Error al obtener conteo inicial de pedidos pendientes:', err))

    const handleUpdate = (newCount: number) => {
      if (isMounted) {
        setCount(newCount)
      }
    }

    listeners.add(handleUpdate)

    return () => {
      isMounted = false
      listeners.delete(handleUpdate)
    }
  }, [])

  return count
}
