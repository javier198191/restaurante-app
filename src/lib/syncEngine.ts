import { supabase } from './supabase'
import { getQueue, removeFromQueue } from './offlineQueue'

let isSyncing = false

/**
 * Recorre la cola de pedidos pendientes en IndexedDB e intenta enviarlos
 * a Supabase usando la función RPC idempotente 'crear_pedido_completo'.
 * 1. Lee la cola con getQueue().
 * 2. Para cada pedido, llama crear_pedido_completo.
 * 3. Si tiene éxito, lo borra con removeFromQueue().
 * 4. Si falla, lo mantiene en la cola y continúa con el siguiente sin romper el ciclo.
 */
export async function syncPendingOrders(): Promise<void> {
  if (isSyncing) return
  isSyncing = true

  try {
    const queue = await getQueue()
    if (queue.length === 0) return

    for (const pedido of queue) {
      try {
        const { data, error } = await supabase.rpc('crear_pedido_completo', {
          cliente_uuid: pedido.cliente_uuid,
          mesa_id: pedido.mesa_id,
          usuario_id: pedido.usuario_id,
          items: pedido.items,
        })

        if (error) {
          console.warn(
            `Error al sincronizar pedido ${pedido.cliente_uuid}: ${error.message}. Se reintentará en el próximo ciclo.`
          )
          continue
        }

        if (data) {
          await removeFromQueue(pedido.cliente_uuid)
          console.info(
            `Pedido ${pedido.cliente_uuid} sincronizado exitosamente (ID de pedido: ${data}).`
          )
        }
      } catch (itemError) {
        console.warn(
          `Fallo de conexión al sincronizar pedido ${pedido.cliente_uuid}. Se mantendrá en cola:`,
          itemError
        )
      }
    }
  } catch (err) {
    console.error('Error general en el motor de sincronización offline:', err)
  } finally {
    isSyncing = false
  }
}

/**
 * Registra los disparadores del motor de sincronización:
 * - Llamada inicial al arrancar.
 * - Evento 'online' del navegador.
 * - Intervalo de respaldo cada 30 segundos.
 * Devuelve un callback de limpieza para useEffect.
 */
export function initSyncEngine(): () => void {
  // Sincronizar al montar
  syncPendingOrders()

  // Listener para cuando el navegador detecta conexión
  const handleOnline = () => {
    syncPendingOrders()
  }
  window.addEventListener('online', handleOnline)

  // Respaldo periódico cada 30 segundos
  const intervalId = window.setInterval(() => {
    syncPendingOrders()
  }, 30000)

  return () => {
    window.removeEventListener('online', handleOnline)
    window.clearInterval(intervalId)
  }
}
