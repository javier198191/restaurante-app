import React from 'react'
import type { Categoria } from '../../types/database'

interface CategoryTabsProps {
  categorias: Categoria[]
  selectedCategoriaId: number | null
  onSelectCategoria: (id: number | null) => void
}

export const CategoryTabs: React.FC<CategoryTabsProps> = ({
  categorias,
  selectedCategoriaId,
  onSelectCategoria,
}) => {
  return (
    <div className="w-full overflow-x-auto py-2 px-1 scrollbar-none flex items-center gap-2">
      <button
        type="button"
        onClick={() => onSelectCategoria(null)}
        className={`min-h-[44px] px-5 py-2.5 rounded-xl font-semibold text-sm whitespace-nowrap transition-all duration-150 flex items-center justify-center shrink-0 border ${
          selectedCategoriaId === null
            ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-500/20'
            : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700 active:scale-95'
        }`}
      >
        🍽️ Todos
      </button>

      {categorias.map((cat) => {
        const isSelected = selectedCategoriaId === cat.id
        return (
          <button
            key={cat.id}
            type="button"
            onClick={() => onSelectCategoria(cat.id)}
            className={`min-h-[44px] px-5 py-2.5 rounded-xl font-semibold text-sm whitespace-nowrap transition-all duration-150 flex items-center justify-center shrink-0 border ${
              isSelected
                ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-500/20'
                : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700 active:scale-95'
            }`}
          >
            {cat.nombre}
          </button>
        )
      })}
    </div>
  )
}

export default CategoryTabs
