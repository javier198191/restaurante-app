import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!url || !key) {
  throw new Error(
    'Error: VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY deben estar definidas en las variables de entorno.'
  )
}

export const supabase = createClient<Database>(url, key)
