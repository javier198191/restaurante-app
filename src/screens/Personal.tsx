import React, { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export interface Empleado {
  id?: string
  email: string
  nombre?: string
  role?: string
  created_at?: string
  [key: string]: unknown
}

const Personal: React.FC = () => {
  const { role } = useAuth()

  // Estados de empleados
  const [empleados, setEmpleados] = useState<Empleado[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Estados del modal de nuevo empleado
  const [modalOpen, setModalOpen] = useState<boolean>(false)
  const [nombre, setNombre] = useState<string>('')
  const [email, setEmail] = useState<string>('')
  const [password, setPassword] = useState<string>('')
  const [empleadoRole, setEmpleadoRole] = useState<'mesero' | 'cajero' | 'admin'>('mesero')
  const [guardando, setGuardando] = useState<boolean>(false)
  const [modalError, setModalError] = useState<string | null>(null)

  // Cargar lista de empleados (desde usuarios_view o fallback seguro)
  const cargarEmpleados = useCallback(async () => {
    setLoading(true)
    setErrorMsg(null)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from('usuarios_view') as any).select('*')
      if (error) {
        console.warn('usuarios_view no disponible o sin registros:', error.message)
        // No mostramos error invasivo si la vista aún no está creada en Supabase
      } else if (data && Array.isArray(data)) {
        setEmpleados(data as Empleado[])
      }
    } catch (err: unknown) {
      console.warn('Fallo al consultar usuarios_view:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void cargarEmpleados()
  }, [cargarEmpleados])

  // Abrir modal reseteando formulario
  const handleAbrirModal = () => {
    setNombre('')
    setEmail('')
    setPassword('')
    setEmpleadoRole('mesero')
    setModalError(null)
    setModalOpen(true)
  }

  // Cerrar modal
  const handleCerrarModal = () => {
    if (!guardando) {
      setModalOpen(false)
      setModalError(null)
    }
  }

  // Guardar empleado invocando la Edge Function 'gestionar-empleado'
  const handleGuardarEmpleado = async (e: React.FormEvent) => {
    e.preventDefault()
    setModalError(null)

    const nombreLimpio = nombre.trim()
    const emailLimpio = email.trim()

    if (!nombreLimpio) {
      setModalError('El nombre es obligatorio.')
      return
    }

    if (!emailLimpio || !emailLimpio.includes('@')) {
      setModalError('Por favor ingresa un correo electrónico válido.')
      return
    }

    if (!password || password.length < 6) {
      setModalError('La contraseña debe tener mínimo 6 caracteres.')
      return
    }

    setGuardando(true)

    try {
      const { data, error } = await supabase.functions.invoke('gestionar-empleado', {
        body: {
          email: emailLimpio,
          password,
          role: empleadoRole,
          nombre: nombreLimpio,
        },
      })

      if (error) {
        throw error
      }

      // Si la Edge Function devuelve un error en el cuerpo
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resData = data as any
      if (resData?.error) {
        throw new Error(resData.error)
      }

      // Éxito: agregar al estado local para reflejo inmediato en UI
      const nuevoEmpleado: Empleado = {
        id: resData?.user?.id || String(Date.now()),
        email: emailLimpio,
        nombre: nombreLimpio,
        role: empleadoRole,
        created_at: new Date().toISOString(),
      }

      setEmpleados((prev) => [nuevoEmpleado, ...prev])
      setSuccessMsg(`Empleado "${nombreLimpio}" creado exitosamente con rol de ${empleadoRole}.`)
      setModalOpen(false)
      alert(`Empleado "${nombreLimpio}" registrado exitosamente.`)
    } catch (err: unknown) {
      console.error('Error al invocar gestionar-empleado:', err)
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
          ? err
          : 'Error desconocido al gestionar el empleado'
      setModalError(msg)
      alert(`Error al registrar empleado: ${msg}`)
    } finally {
      setGuardando(false)
    }
  }

  // Control de acceso: solo visible para rol admin
  if (role && role !== 'admin') {
    return (
      <div className="w-full max-w-xl mx-auto px-4 py-16 text-center">
        <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-6 sm:p-8 shadow-xl">
          <span className="text-4xl block mb-3">🚫</span>
          <h2 className="text-xl font-black text-white">Acceso Restringido</h2>
          <p className="text-sm text-slate-400 mt-2">
            El módulo de Gestión de Personal solo está disponible para usuarios con rol de administrador.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-5xl mx-auto px-4 py-6 text-left">
      {/* Mensajes de alerta generales */}
      {errorMsg && (
        <div
          role="alert"
          className="mb-6 p-4 rounded-xl bg-red-950/90 border border-red-600/60 text-red-100 text-sm font-semibold flex items-start justify-between shadow-lg"
        >
          <div className="flex items-center gap-3">
            <span className="text-xl">🚨</span>
            <p>{errorMsg}</p>
          </div>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="text-red-300 hover:text-white text-lg font-bold ml-4"
          >
            ✕
          </button>
        </div>
      )}

      {successMsg && (
        <div
          role="status"
          className="mb-6 p-4 rounded-xl bg-emerald-950/90 border border-emerald-600/60 text-emerald-100 text-sm font-semibold flex items-center justify-between shadow-lg animate-in fade-in"
        >
          <div className="flex items-center gap-3">
            <span className="text-xl">✅</span>
            <p>{successMsg}</p>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMsg(null)}
            className="text-emerald-300 hover:text-white text-lg font-bold ml-4"
          >
            ✕
          </button>
        </div>
      )}

      {/* Encabezado y Botón Grande de Acción */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight flex items-center gap-2">
            <span>👥</span> Gestión de Personal
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Administración de empleados, cajeros y meseros con permisos en el sistema
          </p>
        </div>

        <button
          type="button"
          onClick={handleAbrirModal}
          className="min-h-[48px] px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-bold text-sm sm:text-base shadow-lg shadow-blue-600/30 transition-all flex items-center justify-center gap-2 cursor-pointer self-start sm:self-center"
        >
          <span className="text-lg">➕</span>
          <span>Nuevo Empleado</span>
        </button>
      </div>

      {/* Lista o Tabla de Empleados */}
      <div className="mt-6">
        {loading ? (
          <div className="py-20 text-center">
            <div className="w-10 h-10 border-4 border-slate-700 border-t-blue-500 rounded-full animate-spin mx-auto mb-4" />
            <p className="text-slate-400 text-sm">Cargando personal registrado...</p>
          </div>
        ) : empleados.length === 0 ? (
          <div className="bg-slate-800/60 border border-slate-700/80 rounded-2xl p-10 text-center shadow-xl">
            <span className="text-5xl block mb-3">🧑‍🍳</span>
            <h3 className="text-lg font-black text-white">No hay empleados registrados</h3>
            <p className="text-slate-400 text-sm max-w-md mx-auto mt-1 mb-6">
              Aún no se han configurado empleados en el sistema. Agrega el primer mesero, cajero o
              administrador para asignarle acceso.
            </p>
            <button
              type="button"
              onClick={handleAbrirModal}
              className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-bold text-sm shadow-md transition-all inline-flex items-center gap-2"
            >
              <span>➕</span>
              <span>Crear primer empleado</span>
            </button>
          </div>
        ) : (
          <div className="bg-slate-800/60 border border-slate-700/80 rounded-2xl overflow-hidden shadow-xl">
            <div className="p-4 sm:p-5 border-b border-slate-700/80 flex items-center justify-between">
              <h3 className="text-lg font-black text-white flex items-center gap-2">
                <span>📋</span>
                <span>Lista de Empleados</span>
              </h3>
              <span className="px-2.5 py-0.5 rounded-full bg-slate-700 text-slate-300 text-xs font-bold">
                {empleados.length} usuario{empleados.length !== 1 ? 's' : ''}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-200">
                <thead className="bg-slate-900/60 text-xs uppercase tracking-wider text-slate-400 font-bold border-b border-slate-700">
                  <tr>
                    <th scope="col" className="px-5 py-3.5">Nombre</th>
                    <th scope="col" className="px-5 py-3.5">Correo Electrónico</th>
                    <th scope="col" className="px-5 py-3.5">Rol de Sistema</th>
                    <th scope="col" className="px-5 py-3.5 text-right">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {empleados.map((emp, index) => {
                    const empRole = (emp.role || 'mesero').toLowerCase()
                    const badgeStyles =
                      empRole === 'admin'
                        ? 'bg-purple-950 text-purple-400 border-purple-700/50'
                        : empRole === 'cajero'
                        ? 'bg-amber-950 text-amber-400 border-amber-700/50'
                        : 'bg-sky-950 text-sky-400 border-sky-700/50'

                    return (
                      <tr key={emp.id ?? index} className="hover:bg-slate-700/30 transition-colors">
                        <td className="px-5 py-4 font-bold text-white whitespace-nowrap">
                          <div className="flex items-center gap-2.5">
                            <span className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-black text-slate-200">
                              {(emp.nombre || emp.email || 'U')[0].toUpperCase()}
                            </span>
                            <span>{emp.nombre || 'Sin nombre'}</span>
                          </div>
                        </td>
                        <td className="px-5 py-4 text-slate-300 font-mono text-xs whitespace-nowrap">
                          {emp.email}
                        </td>
                        <td className="px-5 py-4 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wider border ${badgeStyles}`}
                          >
                            {empRole === 'admin'
                              ? '👑 Administrador'
                              : empRole === 'cajero'
                              ? '💰 Cajero'
                              : '🍽️ Mesero'}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-right whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-950/80 text-emerald-400 border border-emerald-800/40">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                            Activo
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Modal de Nuevo Empleado */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md bg-slate-800 border border-slate-700 rounded-3xl p-6 shadow-2xl relative text-left">
            <div className="flex items-center justify-between pb-4 border-b border-slate-700">
              <h3 className="text-lg font-black text-white flex items-center gap-2">
                <span>➕</span>
                <span>Registrar Nuevo Empleado</span>
              </h3>
              <button
                type="button"
                onClick={handleCerrarModal}
                disabled={guardando}
                className="text-slate-400 hover:text-white text-xl leading-none font-bold p-1 disabled:opacity-50"
              >
                ✕
              </button>
            </div>

            {/* Error específico dentro del modal */}
            {modalError && (
              <div className="mt-4 p-3 rounded-xl bg-red-950/80 border border-red-600/60 text-red-200 text-xs font-semibold flex items-center gap-2">
                <span>⚠️</span>
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={handleGuardarEmpleado} className="mt-4 space-y-4">
              {/* Campo Nombre */}
              <div>
                <label
                  htmlFor="emp-nombre"
                  className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5"
                >
                  Nombre Completo *
                </label>
                <input
                  id="emp-nombre"
                  type="text"
                  required
                  placeholder="Ej. Carlos Mendoza"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  disabled={guardando}
                  className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white placeholder-slate-500 font-medium text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all disabled:opacity-50"
                />
              </div>

              {/* Campo Email */}
              <div>
                <label
                  htmlFor="emp-email"
                  className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5"
                >
                  Correo Electrónico *
                </label>
                <input
                  id="emp-email"
                  type="email"
                  required
                  placeholder="carlos@restaurante.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={guardando}
                  className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white placeholder-slate-500 font-medium text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all disabled:opacity-50"
                />
              </div>

              {/* Campo Contraseña */}
              <div>
                <label
                  htmlFor="emp-password"
                  className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5"
                >
                  Contraseña (mínimo 6 caracteres) *
                </label>
                <input
                  id="emp-password"
                  type="password"
                  required
                  minLength={6}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={guardando}
                  className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white placeholder-slate-500 font-medium text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all disabled:opacity-50"
                />
                <span className="text-[11px] text-slate-400 mt-1 block">
                  El empleado usará esta contraseña para iniciar sesión en su terminal.
                </span>
              </div>

              {/* Campo Rol */}
              <div>
                <label
                  htmlFor="emp-rol"
                  className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5"
                >
                  Rol del Empleado *
                </label>
                <select
                  id="emp-rol"
                  value={empleadoRole}
                  onChange={(e) =>
                    setEmpleadoRole(e.target.value as 'mesero' | 'cajero' | 'admin')
                  }
                  disabled={guardando}
                  className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white font-medium text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all disabled:opacity-50 cursor-pointer"
                >
                  <option value="mesero">Mesero (Toma de pedidos y comandas)</option>
                  <option value="cajero">Cajero (Cobro de mesas y Control de Caja)</option>
                  <option value="admin">Administrador (Acceso total, auditoría y personal)</option>
                </select>
              </div>

              {/* Botones de acción */}
              <div className="flex gap-3 pt-3">
                <button
                  type="button"
                  onClick={handleCerrarModal}
                  disabled={guardando}
                  className="flex-1 min-h-[44px] py-2.5 px-4 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold text-sm transition-all disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardando}
                  className="flex-1 min-h-[44px] py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white font-bold text-sm shadow-lg shadow-blue-600/30 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {guardando ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Guardando...</span>
                    </>
                  ) : (
                    <span>Guardar Empleado</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default Personal
