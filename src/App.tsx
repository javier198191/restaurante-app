import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { initSyncEngine } from './lib/syncEngine'
import { AuthProvider, useAuth } from './context/AuthContext'
import Login from './components/Login'
import MapaMesas from './screens/MapaMesas'
import ResumenMesa from './screens/ResumenMesa'
import TomaPedido from './screens/TomaPedido'
import Caja from './screens/Caja'

function MainContent() {
  const { user, role, loading } = useAuth()
  const [selectedView, setSelectedView] = useState<'mapa' | 'tomar-pedido' | 'caja' | 'resumen' | null>(null)
  const [mesaSeleccionada, setMesaSeleccionada] = useState<number>(1)

  // Vista por defecto: Mapa de Mesas para el mesero, Caja para el cajero
  const activeView = selectedView ?? (role === 'cajero' ? 'caja' : 'mapa')

  useEffect(() => {
    const cleanupSync = initSyncEngine()
    return () => cleanupSync()
  }, [])

  // Si loading es true, muestra un indicador de carga
  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-slate-900 text-slate-100 font-sans">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-slate-700 border-t-blue-500 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-lg font-medium">Cargando aplicación...</p>
        </div>
      </div>
    )
  }

  // Si no hay usuario autenticado, renderiza <Login/>
  if (!user) {
    return <Login />
  }

  // Si hay sesión activa:
  const handleCerrarSesion = async () => {
    await supabase.auth.signOut()
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans flex flex-col">
      {/* Barra de sesión del usuario con cambio de vista */}
      <header className="flex justify-between items-center flex-wrap gap-3 bg-slate-800 border-b border-slate-700 px-4 py-3 sticky top-0 z-30 shadow-md">
        <div className="flex items-center gap-4 flex-wrap">
          <div>
            <span className="text-xs sm:text-sm text-slate-400">Usuario: </span>
            <strong className="text-sm sm:text-base text-slate-100">{user.email}</strong>
          </div>
          <div>
            <span className="text-xs sm:text-sm text-slate-400">Rol: </span>
            <span className="inline-block px-2 py-0.5 rounded-md bg-slate-700 text-sky-400 text-xs font-bold">
              {role || 'Mesero'}
            </span>
          </div>

          {/* Selector de pantalla (Mapa de Mesas / Toma de pedidos / Caja) */}
          <div className="flex items-center bg-slate-900 p-1 rounded-xl border border-slate-700">
            <button
              type="button"
              onClick={() => setSelectedView('mapa')}
              className={`min-h-[36px] px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                activeView === 'mapa'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              🗺️ Mapa Mesas
            </button>
            <button
              type="button"
              onClick={() => setSelectedView('tomar-pedido')}
              className={`min-h-[36px] px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                activeView === 'tomar-pedido'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              🍽️ Toma de Pedidos
            </button>
            <button
              type="button"
              onClick={() => setSelectedView('caja')}
              className={`min-h-[36px] px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                activeView === 'caja'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              🖨️ Tablet Caja
            </button>
          </div>
        </div>

        <button
          onClick={handleCerrarSesion}
          className="min-h-[44px] bg-red-600 hover:bg-red-500 active:scale-95 text-white font-bold px-4 py-2 rounded-xl text-sm transition-all"
        >
          Cerrar Sesión
        </button>
      </header>

      {/* Pantalla activa */}
      <main className="flex-1 pb-16">
        {activeView === 'mapa' ? (
          <MapaMesas
            onSelectMesa={(mesaId, estado) => {
              setMesaSeleccionada(mesaId)
              if (estado === 'libre') {
                setSelectedView('tomar-pedido')
              } else {
                setSelectedView('resumen')
              }
            }}
          />
        ) : activeView === 'resumen' ? (
          <ResumenMesa
            mesaId={mesaSeleccionada}
            onVolver={() => setSelectedView('mapa')}
            onCobroExitoso={() => setSelectedView('mapa')}
            onAgregarProductos={(nuevoMesaId) => {
              if (nuevoMesaId !== undefined) {
                setMesaSeleccionada(nuevoMesaId)
              }
              setSelectedView('tomar-pedido')
            }}
          />
        ) : activeView === 'tomar-pedido' ? (
          <TomaPedido mesaIdInicial={mesaSeleccionada} />
        ) : (
          <Caja />
        )}
      </main>
    </div>
  )
}

// Envuelve la raíz con AuthProvider
export default function App() {
  return (
    <AuthProvider>
      <MainContent />
    </AuthProvider>
  )
}
