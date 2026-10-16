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
      insumos: {
        Row: Insumo
        Insert: {
          id?: number
          nombre: string
          unidad: string
          stock_actual?: number
          stock_minimo?: number
          costo_unitario?: number
          activo?: boolean
          created_at?: string
        }
        Update: {
          id?: number
          nombre?: string
          unidad?: string
          stock_actual?: number
          stock_minimo?: number
          costo_unitario?: number
          activo?: boolean
          created_at?: string
        }
        Relationships: []
      }
      receta: {
        Row: Receta
        Insert: {
          id?: number
          producto_id: number
          insumo_id: number
          cantidad: number
          created_at?: string
        }
        Update: {
          id?: number
          producto_id?: number
          insumo_id?: number
          cantidad?: number
          created_at?: string
        }
        Relationships: []
      }
      movimientos_inventario: {
        Row: MovimientoInventario
        Insert: {
          id?: number
          insumo_id: number
          tipo: string
          cantidad: number
          motivo?: string | null
          pedido_id?: number | null
          fecha?: string
        }
        Update: {
          id?: number
          insumo_id?: number
          tipo?: string
          cantidad?: number
          motivo?: string | null
          pedido_id?: number | null
          fecha?: string
        }
        Relationships: []
      }
    }
  }
}

export interface Insumo {
  id: number
  nombre: string
  unidad: 'porcion' | 'und' | 'g' | 'kg' | 'ml' | 'l' | string
  stock_actual: number
  stock_minimo: number
  costo_unitario: number
  activo: boolean
  created_at?: string
}

export interface Receta {
  id: number
  producto_id: number
  insumo_id: number
  cantidad: number
  created_at?: string
  insumos?: Insumo | null
  productos?: Producto | null
}

export interface MovimientoInventario {
  id: number
  insumo_id: number
  tipo: 'entrada' | 'merma' | 'consumo' | 'ajuste_positivo' | 'ajuste_negativo' | string
  cantidad: number
  motivo?: string | null
  pedido_id?: number | null
  fecha?: string
  insumos?: Insumo | null
}

