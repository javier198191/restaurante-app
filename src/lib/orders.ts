import { supabase } from './supabase'
import { addToQueue, type OrderItem, type PedidoPendiente } from './offlineQueue'

export type SubmitOrderResult =
  | { success: true; pedidoId: number; pending?: false }
  | { success: false; pending: true; error?: string }

/**
 * Envía un pedido al backend atómicamente con soporte offline idempotente.
 * 1. Genera un cliente_uuid único con crypto.randomUUID().
 * 2. Intenta llamar la RPC 'crear_pedido_completo' en Supabase.
 * 3. Si tiene éxito, devuelve { success: true, pedidoId }.
 * 4. Si falla por red (catch), encola el pedido en IndexedDB y devuelve { success: false, pending: true }.
 */
export async function submitOrder(
  mesa_id: number,
  usuario_id: string,
  items: OrderItem[]
): Promise<SubmitOrderResult> {
  const cliente_uuid = crypto.randomUUID()
  const orderData: PedidoPendiente = {
    cliente_uuid,
    mesa_id,
    usuario_id,
    items,
  }

  // Obtener email del mesero desde la sesión actual
  let meseroEmail: string | null = null
  try {
    const { data: userData } = await supabase.auth.getUser()
    meseroEmail = userData?.user?.email ?? null
  } catch {
    // Si ocurre un error de red, intentar sesión en caché local
  }
  if (!meseroEmail) {
    const { data: sessionData } = await supabase.auth.getSession()
    meseroEmail = sessionData?.session?.user?.email ?? null
  }

  try {
    const { data, error } = await supabase.rpc('crear_pedido_completo', {
      p_cliente_uuid: cliente_uuid,
      p_mesa_id: mesa_id,
      p_usuario_id: usuario_id,
      p_items: items,
      p_mesero_nombre: meseroEmail,
    })

    if (error) {
      throw error
    }

    return {
      success: true,
      pedidoId: Number(data),
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.warn(
      'No se pudo completar el pedido en Supabase (posible falla de red). Guardando en cola local:',
      err
    )
    await addToQueue(orderData)
    return {
      success: false,
      pending: true,
      error: errorMsg,
    }
  }
}
