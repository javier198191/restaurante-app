import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

const supabaseUrl = "https://iwjotfhdwlugquwyxmtd.supabase.co"
const supabaseKey = "sb_publishable_nNXzoeK26fLTJ7jo5XJUGw_BSd171qE"

export const supabase = createClient<Database>(supabaseUrl, supabaseKey)

