import { supabase } from './supabase'
import { addToQueue, type OrderItem, type PedidoPendiente } from './offlineQueue'

export type SubmitOrderResult =
  | { success: true; pedidoId: number; pending?: false }
  | { success: false; pending: true; error?: string }
  | { success: false; pending: false; cajaCerrada: true; error: string }

export interface CrearPedidoParams {
  cliente_uuid: string
  mesa_id: number
  usuario_id: string
  items: OrderItem[]
  mesero_nombre?: string | null
}

/**
 * Determina si un error de Supabase/Postgres corresponde a la falta de turno de caja abierto.
 */
export function isCajaCerradaError(err: unknown): boolean {
  if (!err) return false
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === 'object' && err !== null && 'message' in err
        ? String((err as { message: unknown }).message)
        : String(err)
  return /no hay turno de caja abierto/i.test(msg)
}

/**
 * Función centralizada para invocar la RPC 'crear_pedido_completo' en Supabase.
 * Es el único punto en todo el proyecto donde se llama a este RPC.
 */
export async function callCrearPedido(pedido: CrearPedidoParams) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return await (supabase.rpc as any)('crear_pedido_completo', {
    p_cliente_uuid: pedido.cliente_uuid,
    p_mesa_id: pedido.mesa_id,
    p_usuario_id: pedido.usuario_id,
    p_items: pedido.items,
    p_mesero_nombre: pedido.mesero_nombre ?? null,
  })
}

/**
 * Envía un pedido al backend atómicamente con soporte offline idempotente.
 * 1. Genera un cliente_uuid único con crypto.randomUUID().
 * 2. Intenta llamar la RPC 'crear_pedido_completo' mediante callCrearPedido().
 * 3. Si tiene éxito, devuelve { success: true, pedidoId }.
 * 4. Si la RPC responde que no hay turno de caja abierto, NO lo encola y devuelve { success: false, pending: false, cajaCerrada: true }.
 * 5. Si falla por red (catch), encola el pedido en IndexedDB y devuelve { success: false, pending: true }.
 */
export async function submitOrder(
  mesa_id: number,
  usuario_id: string,
  items: OrderItem[],
  mesero_nombre?: string | null
): Promise<SubmitOrderResult> {
  const cliente_uuid = crypto.randomUUID()

  // Obtener email del mesero desde la sesión actual si no se proporciona
  let meseroEmail: string | null = mesero_nombre ?? null
  if (!meseroEmail) {
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
  }

  const orderData: PedidoPendiente = {
    cliente_uuid,
    mesa_id,
    usuario_id,
    items,
    mesero_nombre: meseroEmail,
  }

  try {
    const { data, error } = await callCrearPedido(orderData)

    if (error) {
      throw error
    }

    return {
      success: true,
      pedidoId: Number(data),
    }
  } catch (err: unknown) {
    const errorMsg =
      err instanceof Error
        ? err.message
        : typeof err === 'object' && err !== null && 'message' in err
          ? String((err as { message: unknown }).message)
          : String(err)

    // Si la RPC responde con error de caja cerrada, capturar de inmediato y NO agregar a offlineQueue
    if (isCajaCerradaError(err)) {
      console.warn(
        'Rechazado por regla de negocio: No hay turno de caja abierto. No se agrega a la cola offline (offlineQueue):',
        errorMsg
      )
      return {
        success: false,
        pending: false,
        cajaCerrada: true,
        error: errorMsg,
      }
    }

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
