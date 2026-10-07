import { useEffect, useState, useCallback, useRef } from 'react'
import { openDB } from 'idb'
import { supabase } from '../lib/supabase'
import type { Producto, Categoria } from '../types/database'

const DB_NAME = 'restaurante_menu_db'
const DB_VERSION = 1
const STORE_NAME = 'menu_cache'

interface MenuData {
  productos: Producto[]
  categorias: Categoria[]
}

interface RawProductRow {
  id: number
  nombre: string
  precio: number | string
  categoria_id: number
  disponible: boolean
  categorias?: Categoria | null
  created_at?: string
}

// Cache global en memoria durante la sesión activa
let memoryCache: MenuData | null = null
let inFlightQuery: Promise<MenuData> | null = null

async function getDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    },
  })
}

async function readFromIndexedDB(): Promise<MenuData | null> {
  try {
    const db = await getDB()
    const cached = await db.get(STORE_NAME, 'menu')
    if (cached && Array.isArray(cached.productos) && Array.isArray(cached.categorias)) {
      return {
        productos: cached.productos,
        categorias: cached.categorias,
      }
    }
    return null
  } catch (err) {
    console.warn('Error leyendo menu_cache de IndexedDB:', err)
    return null
  }
}

async function writeToIndexedDB(data: MenuData): Promise<void> {
  try {
    const db = await getDB()
    await db.put(STORE_NAME, { ...data, cachedAt: new Date().toISOString() }, 'menu')
    await db.put(STORE_NAME, data.productos, 'productos')
    await db.put(STORE_NAME, data.categorias, 'categorias')
  } catch (err) {
    console.warn('Error escribiendo en menu_cache de IndexedDB:', err)
  }
}

async function fetchMenuFromSupabase(): Promise<MenuData> {
  const { data, error } = await supabase
    .from('productos')
    .select('*, categorias(*)')
    .eq('disponible', true)

  if (error) {
    throw error
  }

  const rawRows = (data as unknown as RawProductRow[]) || []

  // Mapeo seguro de productos
  const productos: Producto[] = rawRows.map((item) => ({
    id: item.id,
    nombre: item.nombre,
    precio: Number(item.precio),
    categoria_id: item.categoria_id,
    disponible: item.disponible,
    categorias: item.categorias || null,
    created_at: item.created_at,
  }))

  // Extraer categorías únicas del join
  const catMap = new Map<number, Categoria>()
  productos.forEach((p) => {
    if (p.categorias) {
      catMap.set(p.categorias.id, p.categorias)
    }
  })
  const categorias: Categoria[] = Array.from(catMap.values()).sort((a, b) => a.id - b.id)

  return { productos, categorias }
}

export interface UseMenuResult {
  productos: Producto[]
  categorias: Categoria[]
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
}

export function useMenu(): UseMenuResult {
  const [productos, setProductos] = useState<Producto[]>(() => (memoryCache ? memoryCache.productos : []))
  const [categorias, setCategorias] = useState<Categoria[]>(() => (memoryCache ? memoryCache.categorias : []))
  const [loading, setLoading] = useState<boolean>(() => !memoryCache)
  const [error, setError] = useState<string | null>(null)

  const isMountedRef = useRef(true)

  const executeMenuFetch = useCallback(async () => {
    let cachedFound = false

    // 1. En paralelo, intentar leer desde IndexedDB store "menu_cache"
    const readCachePromise = readFromIndexedDB().then((cached) => {
      if (cached && cached.productos.length > 0) {
        cachedFound = true
        if (isMountedRef.current && !memoryCache) {
          setProductos(cached.productos)
          setCategorias(cached.categorias)
          setLoading(false)
        }
      }
      return cached
    })

    // 2. En paralelo, hacer UNA sola consulta a Supabase
    if (!inFlightQuery) {
      inFlightQuery = fetchMenuFromSupabase()
    }

    try {
      const result = await inFlightQuery
      memoryCache = result

      if (isMountedRef.current) {
        setProductos(result.productos)
        setCategorias(result.categorias)
        setLoading(false)
        setError(null)
      }

      // Sobrescribir el cache en IndexedDB para modo offline
      await writeToIndexedDB(result)
    } catch (err: unknown) {
      console.warn('Fallo consulta a Supabase (posiblemente sin red):', err)
      const cached = await readCachePromise

      if (cached && cached.productos.length > 0) {
        // Si falla (sin red) y había cache, usa el cache sin mostrar error
        memoryCache = cached
        if (isMountedRef.current) {
          setProductos(cached.productos)
          setCategorias(cached.categorias)
          setLoading(false)
          setError(null)
        }
      } else if (!cachedFound) {
        // Si falla y no hay cache, expón un estado de error claro
        const message = err instanceof Error ? err.message : 'No se pudo cargar el menú y no hay datos guardados.'
        if (isMountedRef.current) {
          setError(message)
          setLoading(false)
        }
      }
    } finally {
      inFlightQuery = null
    }
  }, [])

  useEffect(() => {
    isMountedRef.current = true
    if (!memoryCache) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void executeMenuFetch()
    }
    return () => {
      isMountedRef.current = false
    }
  }, [executeMenuFetch])

  const refetch = useCallback(async () => {
    memoryCache = null
    inFlightQuery = null
    setLoading(true)
    setError(null)
    await executeMenuFetch()
  }, [executeMenuFetch])

  return { productos, categorias, loading, error, refetch }
}
