export interface Categoria {
  id: number
  nombre: string
  created_at?: string
}

export interface Producto {
  id: number
  nombre: string
  precio: number
  categoria_id: number
  disponible: boolean
  categorias?: Categoria | null
  created_at?: string
}

export interface Database {
  public: {
    Tables: {
      mesas: {
        Row: {
          id: number
          numero: string
          zona: string
          capacidad: number
          estado?: string
        }
        Insert: {
          id?: number
          numero: string
          zona: string
          capacidad: number
          estado?: string
        }
        Update: {
          id?: number
          numero?: string
          zona?: string
          capacidad?: number
          estado?: string
        }
      }
      categorias: {
        Row: Categoria
        Insert: Partial<Categoria>
        Update: Partial<Categoria>
      }
      productos: {
        Row: Producto
        Insert: Partial<Producto>
        Update: Partial<Producto>
      }
      pedidos: {
        Row: {
          id: number
          cliente_uuid?: string | null
          mesa_id: number
          usuario_id: string
          fecha_apertura?: string
          estado: string
        }
        Insert: {
          id?: number
          cliente_uuid?: string | null
          mesa_id: number
          usuario_id: string
          fecha_apertura?: string
          estado?: string
        }
        Update: {
          id?: number
          cliente_uuid?: string | null
          mesa_id?: number
          usuario_id?: string
          fecha_apertura?: string
          estado?: string
        }
      }
      detalle_pedido: {
        Row: {
          id: number
          pedido_id: number
          producto_id: number
          cantidad: number
          nota?: string | null
          impreso?: boolean
        }
        Insert: {
          id?: number
          pedido_id: number
          producto_id: number
          cantidad: number
          nota?: string | null
          impreso?: boolean
        }
        Update: {
          id?: number
          pedido_id?: number
          producto_id?: number
          cantidad?: number
          nota?: string | null
          impreso?: boolean
        }
      }
    }
  }
}
