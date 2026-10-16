import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Manejo de CORS para que el navegador no bloquee la petición
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    
    // Usamos el Service Role para tener permisos de administrador
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    // Extraer los datos enviados desde React
    const { email, password, role, nombre } = await req.json()

    // 1. Validar que quien llama a esta función sea realmente un Admin
    const authHeader = req.headers.get('Authorization')!
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)

    if (authError || user?.app_metadata?.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'No autorizado. Solo los administradores pueden crear empleados.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 2. Crear el usuario en Supabase Auth
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: email,
      password: password,
      email_confirm: true,
      user_metadata: {
        role: role,
        nombre: nombre
      },
      app_metadata: {
        role: role // Este es el que usa el RLS para dar permisos
      }
    })

    if (createError) throw createError

    return new Response(JSON.stringify({ success: true, user: newUser }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})